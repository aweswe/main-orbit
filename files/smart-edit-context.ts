/**
 * smart-edit-context.ts
 *
 * Context assembler for Smart Edit (prompt-based code editing)
 * ─────────────────────────────────────────────────────────────
 * The current editCodeLocal() sends ONE file to the LLM.
 * Problem: editing TaskCard.tsx without knowing the Task type definition
 * or that BoardColumn.tsx renders it causes cascading breakage.
 *
 * This module builds a bidirectional context slice:
 *   - The target file (full source)
 *   - Files it imports (type definitions, hooks, utils)      → signatures
 *   - Files that import IT (components that render it)       → signatures
 *   - Recently modified files in the same directory          → full source
 *
 * Then assembles a single context string to inject into editCodeLocal().
 *
 * Usage in useChat.ts / llm.ts:
 *   import { buildSmartEditContext } from './smart-edit-context';
 *
 *   const { contextBlock, affectedFiles } = buildSmartEditContext(
 *     targetFilePath,
 *     allWorkspaceFiles,
 *     userPrompt
 *   );
 *   // Pass contextBlock into editCodeLocal prompt
 *   // affectedFiles tells you which other files may need updating
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface WorkspaceFileEntry {
  path: string;
  content: string;
  lastModified?: number;
}

export interface SmartEditContext {
  /** Full context block to inject into the LLM edit prompt */
  contextBlock: string;
  /** The target file's path */
  targetPath: string;
  /** Files that import the target (callers — may need updating too) */
  callerFiles: string[];
  /** Files the target imports (dependencies) */
  dependencyFiles: string[];
  /** Estimated token count */
  tokenEstimate: number;
}

// ─── Import Graph (reused from workspace-context logic) ────────────────────────

function extractLocalImports(content: string): string[] {
  const imports: string[] = [];
  const patterns = [
    /import\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const p of patterns) {
    let m: RegExpExecArray | null;
    p.lastIndex = 0;
    while ((m = p.exec(content)) !== null) {
      if (m[1].startsWith('.') || m[1].startsWith('/')) imports.push(m[1]);
    }
  }
  return imports;
}

function resolvePath(base: string, relative: string): string {
  const parts = base ? base.split('/') : [];
  for (const part of relative.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

function resolveImport(
  importPath: string,
  fromFile: string,
  fileMap: Map<string, WorkspaceFileEntry>
): string | null {
  const fromDir = fromFile.includes('/')
    ? fromFile.substring(0, fromFile.lastIndexOf('/'))
    : '';

  let resolved = resolvePath(fromDir, importPath);
  const exts = ['.ts', '.tsx', '.js', '.jsx', ''];
  const indexes = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'];

  for (const ext of exts) {
    if (fileMap.has(resolved + ext)) return resolved + ext;
    const n = (resolved + ext).replace(/^\.\//, '');
    if (fileMap.has(n)) return n;
  }
  for (const idx of indexes) {
    const c = resolved + '/' + idx;
    if (fileMap.has(c)) return c;
  }
  return null;
}

// ─── Signature Extractor ───────────────────────────────────────────────────────

function extractSignatures(content: string, filePath: string): string {
  const lines = content.split('\n');
  const out: string[] = [`// ${filePath} — signatures`];
  let inBlock = false;
  let depth = 0;

  for (const line of lines) {
    const t = line.trim();
    const isSig =
      /^export\s+(default\s+)?(function|class|const|let|var|interface|type|enum)/.test(t) ||
      /^export\s*\{/.test(t) ||
      /^\/\//.test(t);

    if (isSig && !inBlock) {
      if (/\{/.test(t)) {
        out.push(t.split('{')[0].trim() + ' { ... }');
        const o = (t.match(/\{/g) ?? []).length;
        const c = (t.match(/\}/g) ?? []).length;
        if (o > c) { inBlock = true; depth = o - c; }
      } else {
        out.push(t);
      }
    } else if (inBlock) {
      const o = (t.match(/\{/g) ?? []).length;
      const c = (t.match(/\}/g) ?? []).length;
      depth += o - c;
      if (depth <= 0) { inBlock = false; depth = 0; }
    }
  }
  return out.join('\n');
}

// ─── Core Context Builder ──────────────────────────────────────────────────────

const MAX_EDIT_CONTEXT_CHARS = 40_000; // tighter limit for edits vs generation
const RECENT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export function buildSmartEditContext(
  targetPath: string,
  allFiles: WorkspaceFileEntry[],
  prompt: string
): SmartEditContext {
  const now = Date.now();
  const fileMap = new Map(allFiles.map(f => [f.path, f]));
  const targetFile = fileMap.get(targetPath);

  if (!targetFile) {
    return {
      contextBlock: `// File not found: ${targetPath}`,
      targetPath,
      callerFiles: [],
      dependencyFiles: [],
      tokenEstimate: 0,
    };
  }

  // ── Build forward graph: what does targetFile import? ─────────────────────
  const directImports = extractLocalImports(targetFile.content)
    .map(imp => resolveImport(imp, targetPath, fileMap))
    .filter((p): p is string => p !== null);

  // ── Build reverse graph: what files import targetFile? ────────────────────
  const targetBase = targetPath.replace(/\.[jt]sx?$/, '');
  const callers: string[] = [];

  for (const [path, file] of fileMap) {
    if (path === targetPath) continue;
    const imports = extractLocalImports(file.content)
      .map(imp => resolveImport(imp, path, fileMap))
      .filter((p): p is string => p !== null);
    if (imports.includes(targetPath) || imports.some(p => p.replace(/\.[jt]sx?$/, '') === targetBase)) {
      callers.push(path);
    }
  }

  // ── Score dependencies for relevance ─────────────────────────────────────
  const promptLower = prompt.toLowerCase();

  function relevanceScore(path: string): number {
    let score = 0;
    const name = path.split('/').pop()?.replace(/\.[jt]sx?$/, '').toLowerCase() ?? '';
    if (promptLower.includes(name)) score += 200;
    // Type files and stores are always highly relevant for edits
    if (path.includes('store') || path.includes('Store')) score += 150;
    if (path.includes('types') || path.includes('type')) score += 100;
    if (path.includes('hook') || path.includes('Hook')) score += 80;
    // Recently modified files are likely part of the current work
    const f = fileMap.get(path);
    if (f?.lastModified && now - f.lastModified < RECENT_WINDOW_MS) score += 120;
    return score;
  }

  const scoredDeps = directImports
    .map(p => ({ path: p, score: relevanceScore(p) }))
    .sort((a, b) => b.score - a.score);

  const scoredCallers = callers
    .map(p => ({ path: p, score: relevanceScore(p) }))
    .sort((a, b) => b.score - a.score);

  // ── Assemble context block ─────────────────────────────────────────────────
  const sections: string[] = [];
  let totalChars = 0;

  const add = (content: string): boolean => {
    if (totalChars + content.length > MAX_EDIT_CONTEXT_CHARS) return false;
    sections.push(content);
    totalChars += content.length;
    return true;
  };

  // Target file always goes in full
  add([
    '// ═══════════════════════════════════════════',
    `// TARGET FILE (editing this): ${targetPath}`,
    '// ═══════════════════════════════════════════',
    targetFile.content,
  ].join('\n'));

  // Dependencies (what target imports) — most relevant first
  if (scoredDeps.length > 0) {
    add('\n// ═══════════════════════════════════════════');
    add(`// DEPENDENCIES (imported by ${targetPath.split('/').pop()})`);
    add('// ═══════════════════════════════════════════\n');

    for (const { path } of scoredDeps) {
      const dep = fileMap.get(path);
      if (!dep) continue;
      const isRecent = dep.lastModified && now - dep.lastModified < RECENT_WINDOW_MS;
      const content = isRecent ? dep.content : extractSignatures(dep.content, path);
      if (!add(`// FILE: ${path}\n${content}\n`)) break;
    }
  }

  // Callers (what imports target) — show as signatures so LLM knows interface
  if (scoredCallers.length > 0) {
    add('\n// ═══════════════════════════════════════════');
    add(`// CALLERS (components that use ${targetPath.split('/').pop()})`);
    add('// ═══════════════════════════════════════════\n');

    for (const { path } of scoredCallers.slice(0, 4)) { // max 4 callers
      const caller = fileMap.get(path);
      if (!caller) continue;
      if (!add(`// FILE: ${path}\n${extractSignatures(caller.content, path)}\n`)) break;
    }
  }

  // ── Edit instructions header ───────────────────────────────────────────────
  const header = [
    `You are making a surgical edit to: ${targetPath}`,
    ``,
    `USER REQUEST: ${prompt}`,
    ``,
    `RULES:`,
    `1. Only modify ${targetPath.split('/').pop()} unless the edit REQUIRES changing a dependency`,
    `2. If you change a type/interface, note which callers will need updating`,
    `3. Keep all existing functionality — only add/change what the user asked for`,
    `4. Output a JSON patch as per the editor format`,
    ``,
    `WORKSPACE CONTEXT:`,
  ].join('\n');

  const contextBlock = header + '\n\n' + sections.join('\n');

  return {
    contextBlock,
    targetPath,
    callerFiles: callers,
    dependencyFiles: directImports,
    tokenEstimate: Math.ceil(contextBlock.length / 4),
  };
}

// ─── llm.ts Integration Patch ─────────────────────────────────────────────────

/**
 * Drop-in replacement for the editCodeLocal userMessage construction.
 *
 * BEFORE (in llm.ts):
 *   const userMessage = `Current code in ${filename}:\n\`\`\`tsx\n${truncatedCode}\n\`\`\`\n\nUSER REQUEST: ${prompt}`;
 *
 * AFTER:
 *   import { buildEditPrompt } from './smart-edit-context';
 *   const userMessage = buildEditPrompt(prompt, filename, currentCode, allWorkspaceFiles);
 */
export function buildEditPrompt(
  prompt: string,
  targetPath: string,
  targetContent: string,
  allFiles: WorkspaceFileEntry[]
): string {
  // If allFiles is empty or just the target, fall back to old behavior
  if (allFiles.length <= 1) {
    return `Current code in ${targetPath}:\n\`\`\`tsx\n${targetContent}\n\`\`\`\n\nUSER REQUEST: ${prompt}\n\nRemember: Output ONLY valid JSON. Use EXACT search strings from the code above.`;
  }

  const { contextBlock } = buildSmartEditContext(targetPath, allFiles, prompt);

  return [
    contextBlock,
    '',
    'Remember: Output ONLY valid JSON patches. Use EXACT search strings from the TARGET FILE above.',
    'Do NOT include patches for files other than the target unless absolutely required.',
  ].join('\n');
}
