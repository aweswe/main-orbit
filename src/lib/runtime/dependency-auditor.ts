/**
 * dependency-auditor.ts
 *
 * Pre-Boot Dependency Auditor for Orbit
 * ─────────────────────────────────────
 * Runs AFTER all files are written but BEFORE `npm run dev`.
 * 
 * Problem it solves:
 *   The LLM generates import statements for packages (e.g. react-beautiful-dnd)
 *   but forgets to add them to package.json. Vite crashes. Auto-healer loops
 *   on the wrong file (the importer) instead of the real fix (npm install).
 *
 * What it does:
 *   1. Scans every .ts/.tsx/.js/.jsx file for bare module imports
 *   2. Reads package.json dependencies + devDependencies
 *   3. Finds imports that have NO entry in package.json
 *   4. Returns a structured result: { missing, patchedPackageJson, installCmd }
 *
 * Integration point in action-runner.ts:
 *   Call auditDependencies() after all files are written, before runShellAction('npm run dev').
 *   If missing packages found → patch package.json → run npm install → then dev server.
 *
 * Zero external dependencies. Pure TypeScript.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface MissingDependency {
    packageName: string;
    importedBy: string[];   // which files import this package
    suggestedVersion: string; // always "latest" — npm install will resolve it
}

export interface DependencyAuditResult {
    /** Packages used in code but missing from package.json */
    missing: MissingDependency[];
    /** Whether any missing deps were found */
    hasMissing: boolean;
    /** Updated package.json content with missing deps added (if any) */
    patchedPackageJson: string | null;
    /** Shell command to install missing deps */
    installCommand: string | null;
    /** Human-readable summary for terminal output */
    summary: string;
}

// ─── Known built-ins and virtual modules to never flag ─────────────────────────

const BUILTIN_MODULES = new Set([
    // Node built-ins
    'fs', 'path', 'os', 'url', 'http', 'https', 'crypto', 'stream', 'util',
    'events', 'buffer', 'child_process', 'net', 'tls', 'dns', 'zlib',
    'querystring', 'string_decoder', 'timers', 'assert', 'constants',
    // Vite virtual modules
    'virtual:', '/@', '/src',
    // Common aliases that aren't npm packages
    '@/', '~/',
]);

const VITE_SPECIAL_IMPORTS = new Set([
    'vite', 'vite/client', '?raw', '?url', '?worker',
]);

/** Packages that are always available in a Vite+React project without explicit install */
const IMPLICIT_DEPS = new Set([
    'react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime',
    '@types/react', '@types/react-dom',
]);

// ─── TypeScript Path Alias Detector ───────────────────────────────────────────

/**
 * Extracts configured path aliases from tsconfig.json or vite.config.ts.
 * Returns a set of alias prefixes like: new Set(['@/', '@/hooks', '~/', '#'])
 *
 * tsconfig paths example:
 *   { "paths": { "@/*": ["./src/*"], "~/*": ["./src/*"] } }
 *
 * If no config is found, falls back to the most common aliases used in practice.
 */
function extractConfiguredAliases(files: Array<{ path: string; content: string }>): Set<string> {
    const aliases = new Set<string>();

    // Always treat these as aliases — they're NEVER valid npm package names
    // because npm package names cannot contain @ followed by / without a scope
    // e.g. @/hooks is invalid as an npm package (@scope/name is valid, but @/name is not)
    aliases.add('@/');
    aliases.add('~/');
    aliases.add('#/');

    // Try to parse tsconfig.json paths
    const tsconfigFile = files.find(f =>
        f.path === 'tsconfig.json' ||
        f.path === 'tsconfig.base.json' ||
        f.path.endsWith('/tsconfig.json')
    );

    if (tsconfigFile) {
        try {
            // tsconfig may have comments — do a best-effort parse
            const cleaned = tsconfigFile.content
                .replace(/\/\/[^\n]*/g, '')   // strip // comments
                .replace(/\/\*[\s\S]*?\*\//g, ''); // strip /* */ comments
            const tsconfig = JSON.parse(cleaned);
            const paths = tsconfig?.compilerOptions?.paths ?? {};
            for (const aliasPattern of Object.keys(paths)) {
                // "@/*" → "@/" prefix, "~/*" → "~/" prefix
                const prefix = aliasPattern.replace(/\*.*$/, '');
                if (prefix) aliases.add(prefix);
            }
        } catch {
            // tsconfig parse failed, rely on defaults above
        }
    }

    // Try to parse vite.config.ts resolve.alias
    const viteConfig = files.find(f =>
        f.path === 'vite.config.ts' ||
        f.path === 'vite.config.js' ||
        f.path === 'vite.config.mts'
    );

    if (viteConfig) {
        // Regex-based: find alias: { '@': ..., '~': ... } patterns
        const aliasPattern = /['"](@[^'"\/]*)['"\s]*:/g;
        let m: RegExpExecArray | null;
        while ((m = aliasPattern.exec(viteConfig.content)) !== null) {
            aliases.add(m[1] + '/');
        }
    }

    return aliases;
}

/**
 * Returns true if this specifier is a TypeScript path alias (not an npm package).
 * Path aliases are configured in tsconfig.json compilerOptions.paths or vite.config resolve.alias.
 */
function isPathAlias(specifier: string, configuredAliases: Set<string>): boolean {
    for (const alias of configuredAliases) {
        if (specifier.startsWith(alias) || specifier === alias.replace(/\/$/, '')) {
            return true;
        }
    }

    // Hard rule: @/anything is ALWAYS an alias, never an npm package
    // npm scoped packages are @scope/name where scope doesn't contain /
    // So @/hooks, @/components, @/lib are always aliases
    if (/^@\//.test(specifier)) return true;

    return false;
}

/**
 * Returns true if this specifier should be ignored (not an npm package).
 */
function shouldIgnore(specifier: string, configuredAliases: Set<string>): boolean {
    if (specifier.startsWith('.') || specifier.startsWith('/')) return true;
    if (VITE_SPECIAL_IMPORTS.has(specifier)) return true;
    if (IMPLICIT_DEPS.has(specifier)) return true;
    if (isPathAlias(specifier, configuredAliases)) return true;
    for (const builtin of BUILTIN_MODULES) {
        if (specifier === builtin || specifier.startsWith(builtin + '/')) return true;
    }
    return false;
}

/**
 * Extracts all bare module import specifiers from a source file.
 * "Bare" = doesn't start with . or / (i.e., it's an npm package name).
 *
 * Handles:
 *   import foo from 'bar'
 *   import { x } from 'bar/subpath'
 *   import type { X } from 'bar'
 *   export { x } from 'bar'
 *   const x = require('bar')
 *   const x = await import('bar')
 */
function extractBareImports(content: string): string[] {
    const specifiers = new Set<string>();

    const patterns = [
        // ESM static: import ... from 'pkg'
        /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"./][^'"]*)['"]/g,
        // Dynamic: import('pkg')
        /import\s*\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g,
        // CommonJS: require('pkg')
        /require\s*\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g,
    ];

    for (const pattern of patterns) {
        let m: RegExpExecArray | null;
        // Reset lastIndex each time since we reuse patterns
        pattern.lastIndex = 0;
        while ((m = pattern.exec(content)) !== null) {
            specifiers.add(m[1]);
        }
    }

    return Array.from(specifiers);
}

/**
 * Normalizes an import specifier to its root package name.
 * 'react-router-dom/Link' → 'react-router-dom'
 * '@tanstack/react-query' → '@tanstack/react-query' (scoped, keep as-is)
 * '@radix-ui/react-dialog' → '@radix-ui/react-dialog' (scoped sub-package)
 */
function toPackageName(specifier: string): string {
    if (specifier.startsWith('@')) {
        // Scoped package: @scope/name or @scope/name/subpath
        const parts = specifier.split('/');
        return parts.slice(0, 2).join('/'); // '@scope/name'
    }
    // Unscoped: name or name/subpath
    return specifier.split('/')[0];
}

// ─── Version Resolution ────────────────────────────────────────────────────────

const KNOWN_COMPATIBLE_VERSIONS: Record<string, string> = {
    '@dnd-kit/core': '^5.0.2',
    '@dnd-kit/sortable': '^6.0.1',
    '@dnd-kit/utilities': '^3.2.1',
    '@dnd-kit/modifiers': '^6.0.0',
    '@radix-ui/react-dialog': '^1.0.5',
    '@radix-ui/react-dropdown-menu': '^2.0.6',
    '@radix-ui/react-select': '^2.0.0',
    '@radix-ui/react-tooltip': '^1.0.7',
    '@radix-ui/react-popover': '^1.0.7',
    '@radix-ui/react-checkbox': '^1.0.4',
    '@radix-ui/react-label': '^2.0.2',
    '@radix-ui/react-slot': '^1.0.2',
    '@radix-ui/react-separator': '^1.0.3',
    '@radix-ui/react-avatar': '^1.0.4',
    '@radix-ui/react-scroll-area': '^1.0.5',
    '@radix-ui/react-tabs': '^1.0.4',
    'recharts': '^2.10.0',
    'chart.js': '^4.4.0',
    // Pinned to v4 — LLM generates v4 syntax: useQuery(['key'], fn).
    // v5 changed to: useQuery({ queryKey, queryFn }) — breaking change.
    // Do NOT bump to v5 without updating the generation prompt.
    '@tanstack/react-query': '^4.36.1',
    '@tanstack/react-query-devtools': '^4.36.1',
    '@tanstack/react-table': '^8.10.0',
    'react-hook-form': '^7.48.0',
    'zod': '^3.22.0',
    '@hookform/resolvers': '^3.3.0',
    'zustand': '^4.4.0',
    'jotai': '^2.5.0',
    'immer': '^10.0.0',
    'clsx': '^2.0.0',
    'class-variance-authority': '^0.7.0',
    'tailwind-merge': '^2.0.0',
    'date-fns': '^3.0.0',
    'lucide-react': '^0.290.0',
    'framer-motion': '^10.16.0',
};

const PEER_DEP_GROUPS: Array<{ packages: string[]; note: string }> = [
    {
        packages: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
        note: '@dnd-kit/sortable@6 requires @dnd-kit/core@^5 — using core@^6 breaks it',
    },
];

/**
 * Version override table: if the LLM writes a wrong version into package.json,
 * detectPeerConflicts() will patch it to the correct one before npm install.
 */
const VERSION_OVERRIDES: Record<string, string> = {
    // LLM often writes ^5.x because it's the "latest" it knows of at generation time.
    // But we pin to v4 because v5 has a breaking API change the LLM doesn't know about.
    '@tanstack/react-query': '^4.36.1',
    '@tanstack/react-query-devtools': '^4.36.1',
    // dnd-kit peer constraint — core must be ^5 for sortable@6
    '@dnd-kit/core': '^5.0.2',
    '@dnd-kit/sortable': '^6.0.1',
    '@dnd-kit/utilities': '^3.2.1',
};

function getKnownVersion(pkgName: string): string {
    return KNOWN_COMPATIBLE_VERSIONS[pkgName] ?? 'latest';
}

/**
 * Detects and auto-fixes version conflicts + version overrides in package.json.
 * Returns { conflicts: string[], patched: string | null }
 *   - conflicts: human-readable list of what was changed
 *   - patched: updated package.json content (null if no changes needed)
 */
export function detectPeerConflicts(pkgContent: string): string[] {
    const conflicts: string[] = [];
    let pkg: PackageJson;
    try { pkg = JSON.parse(pkgContent); } catch { return []; }

    // Apply VERSION_OVERRIDES — silently patch any wrong version
    let changed = false;
    for (const [pkgName, correctVersion] of Object.entries(VERSION_OVERRIDES)) {
        for (const depSection of ['dependencies', 'devDependencies'] as const) {
            const current = pkg[depSection]?.[pkgName];
            if (current && current !== correctVersion) {
                pkg[depSection]![pkgName] = correctVersion;
                conflicts.push(
                    `version-override: ${pkgName} ${current} → ${correctVersion}`
                );
                changed = true;
            }
        }
    }

    // @dnd-kit/core@^6 + @dnd-kit/sortable@^6 peer conflict (belt-and-suspenders)
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (
        allDeps['@dnd-kit/core']?.startsWith('^6') &&
        allDeps['@dnd-kit/sortable']?.startsWith('^6')
    ) {
        conflicts.push(
            `@dnd-kit peer conflict: sortable@^6 requires core@^5. ` +
            `Fix: "@dnd-kit/core": "^5.0.2" with "@dnd-kit/sortable": "^6.0.1"`
        );
    }

    // Store patched content back if changed (callers that pass pkgContent by ref won't see this,
    // but action-runner reads the return value to know whether to rewrite package.json)
    if (changed) {
        // Mutate the string representation so callers can re-stringify
        (pkg as any).__patched = JSON.stringify(pkg, null, 2);
    }

    return conflicts;
}

/**
 * Like detectPeerConflicts but returns the patched package.json string too.
 * Use this in action-runner when writing package.json.
 */
export function patchPackageJsonVersions(pkgContent: string): {
    patched: string;
    changes: string[];
} {
    let pkg: PackageJson;
    try { pkg = JSON.parse(pkgContent); } catch { return { patched: pkgContent, changes: [] }; }

    const changes: string[] = [];

    for (const [pkgName, correctVersion] of Object.entries(VERSION_OVERRIDES)) {
        for (const depSection of ['dependencies', 'devDependencies'] as const) {
            const current = pkg[depSection]?.[pkgName];
            if (current && current !== correctVersion) {
                pkg[depSection]![pkgName] = correctVersion;
                changes.push(`${pkgName}: ${current} → ${correctVersion}`);
            }
        }
    }

    // dnd-kit peer fix
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (
        allDeps['@dnd-kit/core']?.startsWith('^6') &&
        allDeps['@dnd-kit/sortable']?.startsWith('^6')
    ) {
        if (pkg.dependencies?.['@dnd-kit/core']) pkg.dependencies['@dnd-kit/core'] = '^5.0.2';
        if (pkg.devDependencies?.['@dnd-kit/core']) pkg.devDependencies['@dnd-kit/core'] = '^5.0.2';
        changes.push('@dnd-kit/core: ^6.x → ^5.0.2 (peer constraint)');
    }

    return { patched: JSON.stringify(pkg, null, 2), changes };
}

// ─── Package.json Parser ───────────────────────────────────────────────────────

interface PackageJson {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    [key: string]: unknown;
}

function parsePackageJson(content: string): PackageJson | null {
    try {
        return JSON.parse(content);
    } catch {
        return null;
    }
}

function getAllDeclaredPackages(pkg: PackageJson): Set<string> {
    const declared = new Set<string>();
    const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
    };
    for (const name of Object.keys(allDeps)) {
        declared.add(name);
    }
    return declared;
}

// ─── Core Auditor ──────────────────────────────────────────────────────────────

/**
 * Audit dependencies across all project files.
 *
 * @param files - array of { path, content } for ALL project files
 * @returns structured audit result with missing deps + auto-patch
 */
export function auditDependencies(
    files: Array<{ path: string; content: string }>
): DependencyAuditResult {

    // Find package.json
    const pkgFile = files.find(f => f.path === 'package.json' || f.path.endsWith('/package.json'));
    if (!pkgFile) {
        return {
            missing: [],
            hasMissing: false,
            patchedPackageJson: null,
            installCommand: null,
            summary: '⚠️  dependency-auditor: No package.json found, skipping audit.',
        };
    }

    const pkg = parsePackageJson(pkgFile.content);
    if (!pkg) {
        return {
            missing: [],
            hasMissing: false,
            patchedPackageJson: null,
            installCommand: null,
            summary: '⚠️  dependency-auditor: Could not parse package.json, skipping audit.',
        };
    }

    const declared = getAllDeclaredPackages(pkg);

    // Extract path aliases from tsconfig/vite.config BEFORE scanning imports
    const configuredAliases = extractConfiguredAliases(files);

    // Scan all source files for imports
    const importsByPackage = new Map<string, string[]>(); // pkgName → [files importing it]

    for (const file of files) {
        if (!/\.[jt]sx?$/.test(file.path)) continue;
        if (file.path.includes('node_modules')) continue;
        if (file.path.includes('.config.')) continue; // vite.config.ts etc usually handled

        const rawImports = extractBareImports(file.content);

        for (const specifier of rawImports) {
            if (shouldIgnore(specifier, configuredAliases)) continue;

            const pkgName = toPackageName(specifier);
            if (!pkgName) continue;

            if (!importsByPackage.has(pkgName)) {
                importsByPackage.set(pkgName, []);
            }
            importsByPackage.get(pkgName)!.push(file.path);
        }
    }

    // Find missing packages (used but not in package.json)
    const missing: MissingDependency[] = [];

    for (const [pkgName, importedBy] of importsByPackage) {
        if (!declared.has(pkgName)) {
            missing.push({
                packageName: pkgName,
                importedBy: [...new Set(importedBy)], // dedupe
                suggestedVersion: 'latest',
            });
        }
    }

    if (missing.length === 0) {
        return {
            missing: [],
            hasMissing: false,
            patchedPackageJson: null,
            installCommand: null,
            summary: '✅ dependency-auditor: All imports resolved against package.json.',
        };
    }

    // Build patched package.json with missing deps added
    const patchedPkg: PackageJson = { ...pkg };
    if (!patchedPkg.dependencies) patchedPkg.dependencies = {};

    for (const dep of missing) {
        patchedPkg.dependencies[dep.packageName] = getKnownVersion(dep.packageName);
    }

    const patchedPackageJson = JSON.stringify(patchedPkg, null, 2);
    const installCommand = `npm install ${missing.map(d => d.packageName).join(' ')}`;

    const lines = [
        `⚠️  dependency-auditor: Found ${missing.length} missing package(s):`,
        ...missing.map(d =>
            `   📦 ${d.packageName} (imported by: ${d.importedBy.join(', ')})`
        ),
        `   → Auto-patching package.json and running: ${installCommand}`,
    ];

    return {
        missing,
        hasMissing: true,
        patchedPackageJson,
        installCommand,
        summary: lines.join('\n'),
    };
}

// ─── Integration Helper ────────────────────────────────────────────────────────

/**
 * Convenience function to run the audit and apply fixes in one call.
 * Returns the list of actions that were taken (for logging).
 *
 * Usage in ActionRunner (before `npm run dev`):
 *
 *   const fix = await applyDependencyFixes(allWrittenFiles, {
 *     writeFile: (path, content) => this.writeFile(path, content),
 *     runInstall: (cmd) => this.runShellAction(cmd, signal),
 *     onOutput: this.callbacks.onOutput,
 *   });
 */
export async function applyDependencyFixes(
    files: Array<{ path: string; content: string }>,
    hooks: {
        writeFile: (path: string, content: string) => Promise<void>;
        runInstall: (command: string) => Promise<number>;
        onOutput?: (msg: string) => void;
    }
): Promise<{ fixed: boolean; packagesInstalled: string[] }> {
    const result = auditDependencies(files);

    hooks.onOutput?.('\n' + result.summary + '\n');

    if (!result.hasMissing || !result.patchedPackageJson || !result.installCommand) {
        return { fixed: false, packagesInstalled: [] };
    }

    // Step 1: Patch package.json
    const pkgPath = files.find(f =>
        f.path === 'package.json' || f.path.endsWith('/package.json')
    )?.path ?? 'package.json';

    await hooks.writeFile(pkgPath, result.patchedPackageJson);
    hooks.onOutput?.(`✅ Patched ${pkgPath} with missing dependencies\n`);

    // Step 2: Install missing packages
    hooks.onOutput?.(`📦 Installing missing packages...\n`);
    const exitCode = await hooks.runInstall(result.installCommand);

    if (exitCode !== 0) {
        hooks.onOutput?.(`❌ Failed to install missing packages (exit code ${exitCode})\n`);
        return { fixed: false, packagesInstalled: [] };
    }

    hooks.onOutput?.(`✅ Missing packages installed successfully\n`);
    return {
        fixed: true,
        packagesInstalled: result.missing.map(d => d.packageName),
    };
}
