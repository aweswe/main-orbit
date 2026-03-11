/**
 * workspace-context.ts
 *
 * Advanced Workspace Context Engine for Orbit
 * ─────────────────────────────────────────────
 * Strategy: AST Import Graph + Semantic Clustering + Tiered Compression
 *
 * Instead of byte-limit culling, we build a real dependency graph from
 * import/require statements, then assemble context in 3 tiers:
 *
 *   Tier 1 — Entry files (directly matched by prompt)         → FULL source
 *   Tier 2 — 1st-degree imports of Tier 1                     → Signatures only
 *   Tier 3 — Shared utils, types, config                      → Exports list only
 *
 * This gives the LLM a structurally coherent slice of the codebase
 * regardless of total project size (200+ files handled gracefully).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkspaceFile {
    path: string;           // relative path, e.g. "src/components/VideoPlayer.tsx"
    content: string;        // raw file content
    lastModified?: number;  // unix ms — used for change-aware delta
}

export interface WorkspaceContext {
    files: WorkspaceFile[];
}

export interface AssembledContext {
    /** Final string to inject into the LLM prompt */
    contextBlock: string;
    /** Metadata for debugging / UI display */
    meta: {
        tier1Files: string[];
        tier2Files: string[];
        tier3Files: string[];
        totalTokenEstimate: number;
        filesExcluded: number;
    };
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Max chars for the entire context block (reduced for Groq TPM 8000) */
const MAX_CONTEXT_CHARS = 30_000;

/** How recently a file must have been modified to get full content in Tier 2 */
const RECENT_MODIFIED_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/** Max import graph depth to traverse */
const MAX_GRAPH_DEPTH = 3;

// ─── Import Graph Builder ─────────────────────────────────────────────────────

/**
 * Extracts all local import paths from a file's source using regex-based
 * AST-lite parsing. Handles ESM imports, dynamic imports, and CommonJS require.
 *
 * Examples matched:
 *   import Foo from './foo'
 *   import { bar } from '../utils/bar'
 *   import type { Baz } from '../../types'
 *   const x = require('./config')
 *   const y = await import('./lazy')
 */
function extractImports(content: string): string[] {
    const imports: string[] = [];

    // ESM static imports: import ... from '...'
    const esmPattern = /import\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = esmPattern.exec(content)) !== null) {
        imports.push(m[1]);
    }

    // Dynamic imports: import('...')
    const dynamicPattern = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = dynamicPattern.exec(content)) !== null) {
        imports.push(m[1]);
    }

    // CommonJS: require('...')
    const cjsPattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = cjsPattern.exec(content)) !== null) {
        imports.push(m[1]);
    }

    // Return only local imports (starts with . or /)
    return imports.filter(p => p.startsWith('.') || p.startsWith('/'));
}

/**
 * Resolves a relative import path to a workspace file path.
 * Tries common extensions and index files.
 */
function resolveImport(
    importPath: string,
    fromFile: string,
    fileMap: Map<string, WorkspaceFile>
): string | null {
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', ''];
    const indexFiles = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'];

    // Build base directory from the importing file
    const fromDir = fromFile.includes('/')
        ? fromFile.substring(0, fromFile.lastIndexOf('/'))
        : '';

    // Resolve the raw path
    let resolved = importPath;
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
        resolved = resolvePath(fromDir, importPath);
    } else if (importPath.startsWith('/')) {
        resolved = importPath.slice(1); // strip leading slash
    }

    // Try exact match first, then with extensions, then as directory index
    for (const ext of extensions) {
        const candidate = resolved + ext;
        if (fileMap.has(candidate)) return candidate;
        // Also try without leading ./
        const normalized = candidate.replace(/^\.\//, '');
        if (fileMap.has(normalized)) return normalized;
    }

    // Try as directory/index.*
    for (const idx of indexFiles) {
        const candidate = resolved + '/' + idx;
        if (fileMap.has(candidate)) return candidate;
        const normalized = candidate.replace(/^\.\//, '');
        if (fileMap.has(normalized)) return normalized;
    }

    return null;
}

/** Simple relative path resolver without Node's `path` module */
function resolvePath(base: string, relative: string): string {
    const parts = base ? base.split('/') : [];
    const relParts = relative.split('/');

    for (const part of relParts) {
        if (part === '..') {
            parts.pop();
        } else if (part !== '.') {
            parts.push(part);
        }
    }

    return parts.join('/');
}

// AST Extraction Cache to boost generation context rebuilding speeds
const importASTCache = new Map<string, { content: string, imports: string[] }>();

/**
 * Builds a full import graph for the workspace.
 * Returns a Map: filePath → Set of filePaths it directly imports.
 */
function buildImportGraph(
    fileMap: Map<string, WorkspaceFile>
): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();

    for (const [path, file] of Array.from(fileMap.entries())) {
        let imports: string[];
        const cached = importASTCache.get(path);

        // ── CONTEXT GRAPH CACHE (Roadmap Item 6) ──
        // V8 string equality is extremely fast (O(1) if interned or identical pointers)
        if (cached && cached.content === file.content) {
            imports = cached.imports;
        } else {
            imports = extractImports(file.content);
            importASTCache.set(path, { content: file.content, imports });
        }

        const resolved = new Set<string>();

        for (const imp of imports) {
            const resolvedPath = resolveImport(imp, path, fileMap);
            if (resolvedPath) resolved.add(resolvedPath);
        }

        graph.set(path, resolved);
    }

    return graph;
}

/**
 * Traverses the import graph starting from seed files, up to maxDepth.
 * Returns a Map: filePath → depth (0 = seed / Tier 1)
 */
function traverseGraph(
    seeds: string[],
    graph: Map<string, Set<string>>,
    maxDepth: number
): Map<string, number> {
    const visited = new Map<string, number>();
    const queue: Array<{ path: string; depth: number }> = seeds.map(s => ({
        path: s,
        depth: 0,
    }));

    while (queue.length > 0) {
        const { path, depth } = queue.shift()!;
        if (visited.has(path)) continue;
        visited.set(path, depth);

        if (depth < maxDepth) {
            const imports = graph.get(path) ?? new Set();
            for (const imp of imports) {
                if (!visited.has(imp)) {
                    queue.push({ path: imp, depth: depth + 1 });
                }
            }
        }
    }

    return visited;
}

// ─── File Scoring / Entry Point Detection ────────────────────────────────────

/**
 * Scores each file against the user prompt to find Tier 1 entry points.
 *
 * Scoring factors:
 *   +500  Filename terms appear in prompt (case-insensitive)
 *   +300  Directory/feature name appears in prompt
 *   +200  File is a known config/entry file (package.json, tsconfig, etc.)
 *   +100  File was recently modified
 *   +50   File path contains a keyword from the prompt
 */
function scoreFiles(
    files: WorkspaceFile[],
    prompt: string,
    now: number = Date.now()
): Array<{ file: WorkspaceFile; score: number }> {
    const promptLower = prompt.toLowerCase();

    // Extract meaningful words from the prompt (ignore stop words)
    const stopWords = new Set([
        'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or',
        'is', 'it', 'this', 'that', 'with', 'be', 'as', 'by', 'from', 'update',
        'fix', 'add', 'create', 'make', 'change', 'edit', 'modify', 'build',
        'implement', 'i', 'me', 'my', 'can', 'should', 'need', 'want', 'please',
    ]);

    const promptWords = promptLower
        .split(/\W+/)
        .filter(w => w.length > 2 && !stopWords.has(w));

    const knownEntryFiles = new Set([
        'package.json', 'tsconfig.json', 'vite.config.ts', 'next.config.js',
        'next.config.ts', 'tailwind.config.js', 'tailwind.config.ts',
        'app.tsx', 'app.ts', 'index.tsx', 'index.ts', 'main.tsx', 'main.ts',
        '.env', '.env.local',
    ]);

    return files.map(file => {
        let score = 0;
        const pathLower = file.path.toLowerCase();
        const fileName = pathLower.split('/').pop() ?? pathLower;
        const fileNameNoExt = fileName.replace(/\.[^.]+$/, '');
        const dirSegments = pathLower.split('/').slice(0, -1);

        // Check filename match against prompt words
        for (const word of promptWords) {
            if (fileNameNoExt.includes(word)) score += 500;
            else if (pathLower.includes(word)) score += 50;
        }

        // Check directory/feature name match
        for (const word of promptWords) {
            if (dirSegments.some(seg => seg.includes(word))) score += 300;
        }

        // Known config / entry point files always score high when prompt
        // mentions configuration, setup, dependencies etc.
        if (knownEntryFiles.has(fileName)) {
            const configWords = ['config', 'setup', 'install', 'depend', 'package', 'build', 'deploy'];
            if (configWords.some(cw => promptLower.includes(cw))) score += 200;
        }

        // Recently modified files are likely the ones being worked on
        if (file.lastModified && now - file.lastModified < RECENT_MODIFIED_WINDOW_MS) {
            score += 100;
        }

        return { file, score };
    });
}

// ─── Content Compressors ──────────────────────────────────────────────────────

/**
 * Extracts function/class/const signatures from TypeScript/JavaScript source.
 * Used for Tier 2 files — gives the LLM the shape of the file without full impl.
 *
 * Extracts:
 *   - export function/const/class/interface/type declarations
 *   - Top-level function declarations
 *   - Named exports
 */
function extractSignatures(content: string, filePath: string): string {
    const lines = content.split('\n');
    const signatures: string[] = [`// ${filePath} — signatures only`];
    let inBlock = false;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Capture export statements and top-level declarations
        const isSignatureLine =
            /^export\s+(default\s+)?(function|class|const|let|var|interface|type|enum|abstract)/.test(trimmed) ||
            /^export\s*\{/.test(trimmed) ||
            /^(function|class)\s+\w+/.test(trimmed) ||
            /^\/\//.test(trimmed) || // preserve comments for context
            /^\/\*/.test(trimmed);

        if (isSignatureLine && !inBlock) {
            // For function/class bodies, just show the signature line
            if (/\{/.test(trimmed)) {
                const signaturePart = trimmed.split('{')[0].trim();
                signatures.push(signaturePart + ' { ... }');

                // If the block opens and closes on the same line (e.g. type = {}), fine
                const opens = (trimmed.match(/\{/g) ?? []).length;
                const closes = (trimmed.match(/\}/g) ?? []).length;
                if (opens > closes) {
                    inBlock = true;
                    braceDepth = opens - closes;
                }
            } else {
                signatures.push(trimmed);
            }
        } else if (inBlock) {
            // Track brace depth to know when the block ends
            const opens = (trimmed.match(/\{/g) ?? []).length;
            const closes = (trimmed.match(/\}/g) ?? []).length;
            braceDepth += opens - closes;
            if (braceDepth <= 0) {
                inBlock = false;
                braceDepth = 0;
            }
        }
    }

    return signatures.join('\n');
}

/**
 * Extracts only the named exports from a file.
 * Used for Tier 3 files — gives the LLM just the public API surface.
 */
function extractExports(content: string, filePath: string): string {
    const exports: string[] = [`// ${filePath} — exports only`];
    const exportPattern = /^export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/gm;

    let m: RegExpExecArray | null;
    while ((m = exportPattern.exec(content)) !== null) {
        exports.push(`// export: ${m[1]}`);
    }

    // Also capture re-exports: export { foo, bar } from '...'
    const reExportPattern = /^export\s*\{([^}]+)\}/gm;
    while ((m = reExportPattern.exec(content)) !== null) {
        const names = m[1].split(',').map(n => n.trim().split(/\s+as\s+/).pop()!.trim());
        names.forEach(n => exports.push(`// re-export: ${n}`));
    }

    return exports.length > 1 ? exports.join('\n') : `// ${filePath} — no named exports found`;
}

// ─── Tier Classification ──────────────────────────────────────────────────────

/** Files always shown in full regardless of tier (config/env critical files) */
const ALWAYS_FULL_FILES = new Set([
    'package.json',
    'tsconfig.json',
    'tsconfig.base.json',
    '.env',
    '.env.local',
    '.env.example',
]);

/**
 * Files that are always Tier 3 (utility noise if shown in full).
 * These are shown as exports-only unless they're a direct entry point.
 */
function isTier3ByDefault(path: string): boolean {
    const lower = path.toLowerCase();
    return (
        lower.includes('/node_modules/') ||
        lower.endsWith('.d.ts') ||
        lower.endsWith('.test.ts') ||
        lower.endsWith('.test.tsx') ||
        lower.endsWith('.spec.ts') ||
        lower.endsWith('.spec.tsx') ||
        lower.endsWith('.stories.tsx') ||
        lower.endsWith('.stories.ts')
    );
}

// ─── Main Context Assembler ───────────────────────────────────────────────────

/**
 * Builds the optimal context block for the LLM given a prompt and workspace.
 *
 * Algorithm:
 *   1. Score all files against the prompt → find Tier 1 entry points
 *   2. Build import graph across entire workspace
 *   3. Traverse graph from Tier 1 seeds to find Tier 2 and Tier 3 files
 *   4. Assemble context with compression per tier, respecting MAX_CONTEXT_CHARS
 *   5. Return structured context block + metadata
 */
export function assembleContext(
    prompt: string,
    workspace: WorkspaceContext,
    options: {
        maxContextChars?: number;
        tier1Threshold?: number;  // min score to be considered Tier 1
        maxTier1Files?: number;
        maxTier2Files?: number;
        maxTier3Files?: number;
        recentModifiedWindowMs?: number;
        debug?: boolean;
    } = {}
): AssembledContext {
    const {
        maxContextChars = MAX_CONTEXT_CHARS,
        tier1Threshold = 100,
        maxTier1Files = 5,
        maxTier2Files = 12,
        maxTier3Files = 20,
        recentModifiedWindowMs = RECENT_MODIFIED_WINDOW_MS,
    } = options;

    const now = Date.now();
    const files = workspace.files;

    if (files.length === 0) {
        return {
            contextBlock: '// No workspace files available.',
            meta: { tier1Files: [], tier2Files: [], tier3Files: [], totalTokenEstimate: 0, filesExcluded: 0 },
        };
    }

    // ── Step 1: Build file map ─────────────────────────────────────────────────
    const fileMap = new Map<string, WorkspaceFile>();
    for (const f of files) {
        fileMap.set(f.path, f);
    }

    // ── Step 2: Score files for Tier 1 entry points ───────────────────────────
    const scored = scoreFiles(files, prompt, now);
    scored.sort((a, b) => b.score - a.score);

    const tier1Candidates = scored
        .filter(s => s.score >= tier1Threshold)
        .slice(0, maxTier1Files)
        .map(s => s.file.path);

    // If nothing scored above threshold, take the top 3 by score
    const tier1Seeds = tier1Candidates.length > 0
        ? tier1Candidates
        : scored.slice(0, 3).map(s => s.file.path);

    // ── Step 3: Build import graph + traverse ─────────────────────────────────
    const importGraph = buildImportGraph(fileMap);
    const graphDepths = traverseGraph(tier1Seeds, importGraph, MAX_GRAPH_DEPTH);

    // Classify files into tiers based on graph depth
    const tier1Files: string[] = [];
    const tier2Files: string[] = [];
    const tier3Files: string[] = [];

    for (const [path, depth] of graphDepths) {
        if (isTier3ByDefault(path)) {
            tier3Files.push(path);
        } else if (depth === 0) {
            tier1Files.push(path);
        } else if (depth === 1) {
            tier2Files.push(path);
        } else {
            tier3Files.push(path);
        }
    }

    // Limit tier 2 and 3 to avoid bloat
    const finalTier2 = tier2Files.slice(0, maxTier2Files);
    const finalTier3 = tier3Files.slice(0, maxTier3Files);
    const filesExcluded =
        (tier2Files.length - finalTier2.length) +
        (tier3Files.length - finalTier3.length) +
        (files.length - graphDepths.size);

    // ── Step 4: Assemble context block ────────────────────────────────────────
    const sections: string[] = [];
    let totalChars = 0;

    const addSection = (header: string, content: string): boolean => {
        const chunk = `${header}\n${content}\n`;
        if (totalChars + chunk.length > maxContextChars) return false;
        sections.push(chunk);
        totalChars += chunk.length;
        return true;
    };

    // ── Tier 1: Full source ────────────────────────────────────────────────────
    sections.push('// ═══════════════════════════════════════════');
    sections.push('// TIER 1 — Primary files (full source)');
    sections.push('// ═══════════════════════════════════════════\n');

    for (const path of tier1Files) {
        const file = fileMap.get(path)!;
        const isRecent = file.lastModified
            ? now - file.lastModified < recentModifiedWindowMs
            : false;
        const recentTag = isRecent ? ' [recently modified]' : '';

        const fileName = path.split('/').pop() ?? path;
        const forceFullFile = ALWAYS_FULL_FILES.has(fileName);

        const content = forceFullFile || isRecent || depth(path, graphDepths) === 0
            ? file.content
            : file.content;  // Tier 1 always gets full content

        if (!addSection(`// FILE: ${path}${recentTag}`, content)) break;
    }

    // ── Tier 2: Signatures only (unless recently modified) ────────────────────
    if (finalTier2.length > 0) {
        sections.push('\n// ═══════════════════════════════════════════');
        sections.push('// TIER 2 — Imported dependencies (signatures)');
        sections.push('// ═══════════════════════════════════════════\n');

        for (const path of finalTier2) {
            const file = fileMap.get(path)!;
            const isRecent = file.lastModified
                ? now - file.lastModified < recentModifiedWindowMs
                : false;

            const fileName = path.split('/').pop() ?? path;
            const forceFullFile = ALWAYS_FULL_FILES.has(fileName);

            let content: string;
            if (forceFullFile) {
                content = file.content;
            } else if (isRecent) {
                // Recently modified Tier 2 files get full content
                content = file.content + ' // [recently modified — full source]';
            } else {
                content = extractSignatures(file.content, path);
            }

            if (!addSection(`// FILE: ${path}`, content)) break;
        }
    }

    // ── Tier 3: Exports only ───────────────────────────────────────────────────
    if (finalTier3.length > 0) {
        sections.push('\n// ═══════════════════════════════════════════');
        sections.push('// TIER 3 — Transitive dependencies (exports only)');
        sections.push('// ═══════════════════════════════════════════\n');

        for (const path of finalTier3) {
            const file = fileMap.get(path)!;
            const fileName = path.split('/').pop() ?? path;
            const forceFullFile = ALWAYS_FULL_FILES.has(fileName);

            const content = forceFullFile
                ? file.content
                : extractExports(file.content, path);

            if (!addSection('', content)) break;
        }
    }

    // ── Summary footer ─────────────────────────────────────────────────────────
    sections.push(`\n// Context: ${tier1Files.length} primary + ${finalTier2.length} dependency + ${finalTier3.length} type files`);
    if (filesExcluded > 0) {
        sections.push(`// ${filesExcluded} files excluded (unrelated to prompt)`);
    }

    const contextBlock = sections.join('\n');

    return {
        contextBlock,
        meta: {
            tier1Files,
            tier2Files: finalTier2,
            tier3Files: finalTier3,
            totalTokenEstimate: Math.ceil(contextBlock.length / 4), // rough 4 chars/token
            filesExcluded,
        },
    };
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function depth(path: string, graphDepths: Map<string, number>): number {
    return graphDepths.get(path) ?? 999;
}

// ─── Convenience Builder ──────────────────────────────────────────────────────

/**
 * Drop-in replacement for the old workspace-context system.
 *
 * Usage:
 *   import { buildWorkspaceContext } from './workspace-context';
 *
 *   const ctx = buildWorkspaceContext(prompt, workspaceFiles);
 *   // inject ctx.contextBlock into your LLM prompt
 *   // check ctx.meta for debugging info
 */
export function buildWorkspaceContext(
    prompt: string,
    files: WorkspaceFile[],
    options?: Parameters<typeof assembleContext>[2]
): AssembledContext {
    return assembleContext(prompt, { files }, options);
}

// ─── Debug Utility ────────────────────────────────────────────────────────────

/**
 * Pretty-prints context assembly metadata for debugging.
 * Call this in development to verify the right files are being selected.
 */
export function debugContext(meta: AssembledContext['meta']): void {
    console.group('[WorkspaceContext] Assembly Report');
    console.log(`Tier 1 (full):        ${meta.tier1Files.join(', ') || 'none'}`);
    console.log(`Tier 2 (signatures):  ${meta.tier2Files.join(', ') || 'none'}`);
    console.log(`Tier 3 (exports):     ${meta.tier3Files.join(', ') || 'none'}`);
    console.log(`~Token estimate:      ${meta.totalTokenEstimate.toLocaleString()}`);
    console.log(`Files excluded:       ${meta.filesExcluded}`);
    console.groupEnd();
}
