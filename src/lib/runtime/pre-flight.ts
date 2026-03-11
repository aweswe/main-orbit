/**
 * pre-flight.ts
 *
 * Pre-Write Validation Gate for Orbit's ActionRunner
 * ────────────────────────────────────────────────────
 * Sits between "LLM streams a file action" and "writeFile() touches disk".
 *
 * Guarantees:
 *   1. JSX in .ts files → auto-renamed to .tsx (and all importers updated)
 *   2. Double-escaped regex (from JSON serialization) → sanitized
 *   3. Escaped template literals → unescaped
 *   4. useStore.ts / any .ts file with JSX fragments → catches the exact bug from logs
 *   5. All fixes are logged with structured reasons so you can see what the LLM got wrong
 *   6. Hallucinated imports (like lucide-react exports) are removed or renamed
 *
 * Zero external dependencies. Pure TypeScript.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export type FixSeverity = 'auto' | 'warn' | 'block';

export interface ValidationFix {
    rule: string;
    severity: FixSeverity;
    description: string;
    before?: string;
    after?: string;
}

export interface PreFlightResult {
    /** Possibly corrected file path (e.g. .ts → .tsx) */
    path: string;
    /** Sanitized file content */
    content: string;
    /** Whether this file is safe to write */
    ok: boolean;
    /** All fixes applied or blocking errors found */
    fixes: ValidationFix[];
    /** Blocking errors that require LLM retry */
    blockingErrors: string[];
}

export interface BatchPreFlightResult {
    files: PreFlightResult[];
    /** Path renames that occurred: old path → new path */
    renames: Map<string, string>;
    /** Any blocking errors across all files */
    hasBlockingErrors: boolean;
}

// ─── Rule Definitions ──────────────────────────────────────────────────────────

/**
 * Detects whether a file contains JSX syntax.
 * Conservative: only matches unambiguous JSX patterns.
 */
function containsJSX(content: string): boolean {
    // Match JSX fragments <> </> or component tags <ComponentName or </ComponentName
    const jsxPatterns = [
        /<>\s*<\//,                          // <>...</>
        /<>[^<]*</,                           // <> with children
        /return\s*\(\s*<[A-Z]/,             // return (<Component
        /return\s+<[A-Z]/,                   // return <Component
        /=>\s*\(\s*<[A-Z]/,                 // => (<Component
        /=>\s*<[A-Z]/,                       // => <Component
        /\(\s*<>[^]*?<\/>\s*\)/,            // (<>...</>)
        /<[A-Z][a-zA-Z]*[\s\/>]/,           // <Component or <Component/> or <Component >
        /React\.createElement/,              // explicit createElement (less common but valid)
    ];
    return jsxPatterns.some(p => p.test(content));
}

/**
 * Rule 1: JSX extension enforcement
 * .ts files containing JSX must be .tsx
 * .js files containing JSX must be .jsx
 */
function enforceExtension(path: string, content: string): {
    newPath: string;
    fix: ValidationFix | null;
} {
    const hasJSX = containsJSX(content);

    if (hasJSX && path.endsWith('.ts') && !path.endsWith('.d.ts')) {
        const newPath = path.slice(0, -3) + '.tsx';
        return {
            newPath,
            fix: {
                rule: 'jsx-extension',
                severity: 'auto',
                description: `Renamed ${path} → ${newPath} (file contains JSX but had .ts extension)`,
                before: path,
                after: newPath,
            },
        };
    }

    if (hasJSX && path.endsWith('.js')) {
        const newPath = path.slice(0, -3) + '.jsx';
        return {
            newPath,
            fix: {
                rule: 'jsx-extension',
                severity: 'auto',
                description: `Renamed ${path} → ${newPath} (file contains JSX but had .js extension)`,
                before: path,
                after: newPath,
            },
        };
    }

    return { newPath: path, fix: null };
}

/**
 * Rule 2: Double-escaped regex sanitization
 * When LLM output passes through JSON serialization, backslashes get doubled.
 * /\/tasks\// becomes /\\/tasks\\// in the written file — invalid regex.
 *
 * Pattern: inside regex literals /.../, \\ should be \ unless it's a true double-backslash.
 */
function sanitizeRegexEscapes(content: string, path: string): {
    content: string;
    fix: ValidationFix | null;
} {
    if (!/\.[jt]sx?$/.test(path)) return { content, fix: null };

    // Match regex literals: /pattern/flags
    // We look for the specific double-escape pattern that breaks things: /\\/
    const doubleEscapedRegex = /\/(?:[^/\n\\]|\\.)*\\\\\/(?:[^/\n\\]|\\.)*\//g;

    if (!doubleEscapedRegex.test(content)) return { content, fix: null };

    // Replace \\\/ with \/ inside regex literals
    // Strategy: find all regex literals and fix double-backslash-slash sequences
    let fixed = content;
    let fixCount = 0;

    // Replace \\/ (double-escaped forward slash in regex) with \/ 
    // This is the exact pattern from the logs: /\\/tasks\\//  →  /\/tasks\//
    fixed = fixed.replace(/(\/(?:[^/\n\\]|\\[^\\])*)\\\\\/((?:[^/\n\\]|\\[^\\])*\/)/g, (match, before, after) => {
        fixCount++;
        return before + '\\/' + after;
    });

    if (fixCount === 0) return { content, fix: null };

    return {
        content: fixed,
        fix: {
            rule: 'regex-double-escape',
            severity: 'auto',
            description: `Fixed ${fixCount} double-escaped regex pattern(s) — \\\\/ → \\/`,
            before: 'contains /\\\\/pattern\\\\/',
            after: 'contains /\\/pattern\\/',
        },
    };
}

/**
 * Rule 3: Escaped template literal sanitization
 * LLM sometimes outputs \\n, \\t inside template literals instead of actual newlines/tabs.
 * This only applies in template literal strings (between backticks).
 */
function sanitizeTemplateLiterals(content: string, path: string): {
    content: string;
    fix: ValidationFix | null;
} {
    if (!/\.[jt]sx?$/.test(path)) return { content, fix: null };

    // Only fix inside template literals — don't touch regular strings
    let fixCount = 0;
    const fixed = content.replace(/`[^`]*`/gs, (template) => {
        // Fix \\n → \n and \\t → \t inside template literals
        const cleaned = template
            .replace(/\\\\n/g, () => { fixCount++; return '\\n'; })
            .replace(/\\\\t/g, () => { fixCount++; return '\\t'; });
        return cleaned;
    });

    if (fixCount === 0) return { content, fix: null };

    return {
        content: fixed,
        fix: {
            rule: 'template-literal-escapes',
            severity: 'auto',
            description: `Fixed ${fixCount} double-escaped sequence(s) in template literals`,
        },
    };
}

/**
 * Rule 4: Detect JSX in wrong file extension (blocking variant)
 * If a .ts file has JSX AND the auto-rename would break known imports,
 * we still auto-fix but emit a warn so the importer-updater can run.
 */
function detectMismatchedTypes(content: string, path: string): ValidationFix | null {
    // Detect React component in a .ts file (without JSX, but with FC type annotation)
    const hasFCType = /:\s*(?:React\.)?(?:FC|FunctionComponent|ComponentType|ReactNode|ReactElement)/m.test(content);
    const isTS = path.endsWith('.ts');

    if (hasFCType && isTS && !containsJSX(content)) {
        return {
            rule: 'react-types-in-ts',
            severity: 'warn',
            description: `${path} uses React component types but has .ts extension. Consider renaming to .tsx.`,
        };
    }

    return null;
}

/**
 * Rule 5: Validate that JSON files are parseable
 */
function validateJSON(content: string, path: string): ValidationFix | null {
    if (!path.endsWith('.json')) return null;

    try {
        JSON.parse(content);
        return null;
    } catch (e: any) {
        return {
            rule: 'invalid-json',
            severity: 'block',
            description: `${path} contains invalid JSON: ${e.message}`,
        };
    }
}

/**
 * Rule 10: Sanitize package.json dependency names
 * LLM sometimes incorrectly adds sub-paths as package names (e.g., "zustand/middleware")
 */
function sanitizePackageJson(content: string, path: string): { content: string, fix: ValidationFix | null } {
    if (path !== 'package.json') return { content, fix: null };

    try {
        const pkg = JSON.parse(content);
        let fixCount = 0;
        const fixDetails: string[] = [];

        const sanitize = (deps: any) => {
            if (!deps) return;
            for (const key of Object.keys(deps)) {
                // If the key has a slash but isn't a scoped package (@scope/pkg)
                // OR if it's a known hallucination like zustand/middleware
                if ((key.includes('/') && !key.startsWith('@')) || key.includes('/middleware')) {
                    const baseName = key.split('/')[0];
                    if (baseName && baseName !== key) {
                        const version = deps[key];
                        delete deps[key];
                        // Only add if not already present
                        if (!deps[baseName]) {
                            deps[baseName] = version;
                        }
                        fixCount++;
                        fixDetails.push(`${key} → ${baseName}`);
                    }
                }
            }
        };

        sanitize(pkg.dependencies);
        sanitize(pkg.devDependencies);

        if (fixCount === 0) return { content, fix: null };

        return {
            content: JSON.stringify(pkg, null, 2),
            fix: {
                rule: 'package-name-sanitization',
                severity: 'auto',
                description: `Sanitized ${fixCount} invalid package name(s): ${fixDetails.join(', ')}`,
            }
        };
    } catch (e) {
        return { content, fix: null }; // validateJSON will catch actual parse errors
    }
}

/**
 * Rule 11: CSS @import ordering
 * Vite/PostCSS require @import to be at the very top.
 */
function fixCssImports(content: string, path: string): { content: string, fix: ValidationFix | null } {
    if (!path.endsWith('.css')) return { content, fix: null };

    const lines = content.split('\n');
    const importLines: string[] = [];
    const otherLines: string[] = [];
    let hasIssues = false;
    let firstNonImportIndex = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed.startsWith('@import')) {
            importLines.push(line);
            if (firstNonImportIndex !== -1) hasIssues = true; // Found an import after something else
        } else if (trimmed && !trimmed.startsWith('@charset') && !trimmed.startsWith('/*') && !trimmed.startsWith('//')) {
            otherLines.push(line);
            if (firstNonImportIndex === -1) firstNonImportIndex = i;
        } else {
            // Comments or empty lines
            otherLines.push(line);
        }
    }

    if (!hasIssues) return { content, fix: null };

    // Find first available spot (after charset if exists)
    let insertIndex = 0;
    if (otherLines.length > 0 && otherLines[0].trim().startsWith('@charset')) {
        insertIndex = 1;
    }

    const newOtherLines = [...otherLines];
    const newContent = [
        ...newOtherLines.slice(0, insertIndex),
        ...importLines,
        ...newOtherLines.slice(insertIndex)
    ].join('\n');

    return {
        content: newContent,
        fix: {
            rule: 'css-import-ordering',
            severity: 'auto',
            description: `Moved ${importLines.length} @import statement(s) to the top of ${path}`,
        }
    };
}

/**
 * Rule 12: Sanitize Vite config for HMR
 * WebContainer requires clientPort: 443 for HMR to work reliably across subdomains.
 */
function sanitizeViteConfig(content: string, path: string): { content: string, fix: ValidationFix | null } {
    if (!path.includes('vite.config.')) return { content, fix: null };

    // If it already mentions 443, we're probably good
    if (content.includes('clientPort: 443')) return { content, fix: null };

    // Check if we can inject it into a server block
    if (content.includes('server: {')) {
        // Look for hmr block
        if (content.includes('hmr: {')) {
            // Replace any existing port/config with correct one
            const newContent = content.replace(/hmr:\s*{[^}]*}/, 'hmr: { clientPort: 443 }');
            return {
                content: newContent,
                fix: { rule: 'vite-hmr-sanitize', severity: 'auto', description: `Updated HMR clientPort to 443 in ${path}` }
            };
        } else {
            // Inject hmr into server
            const newContent = content.replace('server: {', 'server: {\n    hmr: { clientPort: 443 },');
            return {
                content: newContent,
                fix: { rule: 'vite-hmr-sanitize', severity: 'auto', description: `Injected HMR config into ${path}` }
            };
        }
    } else if (content.includes('defineConfig({')) {
        // Inject server block
        const newContent = content.replace('defineConfig({', 'defineConfig({\n  server: { hmr: { clientPort: 443 } },');
        return {
            content: newContent,
            fix: { rule: 'vite-hmr-sanitize', severity: 'auto', description: `Added missing server.hmr config to ${path}` }
        };
    }

    return { content, fix: null };
}

/**
 * Rule 6: Detect obviously truncated files
 * LLM sometimes cuts off mid-generation. A file ending with a comment like
 * "// ... (truncated)" or incomplete braces is a blocking error.
 */
function detectTruncation(content: string, path: string): ValidationFix | null {
    if (!/\.[jt]sx?$/.test(path)) return null;

    const truncationSignals = [
        /\/\/\s*\.\.\.\s*\(truncated\)\s*$/m,
        /\/\/\s*\.\.\.\s*more\s*$/im,
        /\/\*\s*truncated\s*\*\/\s*$/m,
    ];

    if (truncationSignals.some(p => p.test(content.trim()))) {
        return {
            rule: 'truncated-file',
            severity: 'block',
            description: `${path} appears to be truncated by the LLM. Full file content required.`,
        };
    }

    return null;
}

// ─── Rule 7: Hallucinated Import Registry ─────────────────────────────────────

/**
 * Maps a package to:
 *   - validExports: set of actually exported names (subset used for fast checking)
 *   - commonHallucinations: map of fake name → correct replacement or null (remove)
 *
 * Strategy: we don't need exhaustive export lists. We only need to know the
 * WRONG things LLMs commonly import, and what to replace them with.
 */
interface PackageImportRules {
    /** Names that DO NOT exist in this package and should be fixed */
    hallucinations: Record<string, string | null>; // fake → replacement (null = remove)
    /** Short description of what the package actually provides */
    description: string;
}

const IMPORT_HALLUCINATION_REGISTRY: Record<string, PackageImportRules> = {
    'lucide-react': {
        description: 'icon library — only exports icon components (e.g. Home, Settings, User)',
        hallucinations: {
            // UI components confused with lucide icons
            'Card': null,           // shadcn/ui component, not a lucide icon
            'Button': null,         // shadcn/ui component
            'Badge': null,          // shadcn/ui component
            'Avatar': null,         // shadcn/ui component
            'Dialog': null,         // radix-ui component
            'Modal': null,          // not in lucide
            'Spinner': 'Loader2',   // correct icon name
            'Loader': 'Loader2',    // correct icon name
            'Close': 'X',           // correct icon name
            'Delete': 'Trash2',     // correct icon name
            'Remove': 'Trash2',     // correct icon name
            'Edit': 'Pencil',       // correct icon name
            'Add': 'Plus',          // correct icon name
            'Search': 'Search',     // this one actually exists — keep
            'Menu': 'Menu',         // this one actually exists — keep
            'More': 'MoreHorizontal', // correct icon name
            'MoreVertical': 'MoreVertical', // exists — keep
            'Arrow': 'ArrowRight',  // too vague
            'ArrowLeft': 'ArrowLeft', // exists — keep
            'ArrowRight': 'ArrowRight', // exists — keep
            'Check': 'Check',       // exists — keep
            'Cross': 'X',           // correct icon name
            'Info': 'Info',         // exists — keep
            'Warning': 'AlertTriangle', // correct icon name
            'Error': 'AlertCircle', // correct icon name
            'Success': 'CheckCircle', // correct icon name
            'Star': 'Star',         // exists — keep
            'Heart': 'Heart',       // exists — keep
            'Eye': 'Eye',           // exists — keep
            'EyeOff': 'EyeOff',    // exists — keep
            'Lock': 'Lock',         // exists — keep
            'Unlock': 'Unlock',     // exists — keep
            'Copy': 'Copy',         // exists — keep
            'Download': 'Download', // exists — keep
            'Upload': 'Upload',     // exists — keep
            'Refresh': 'RefreshCw', // correct icon name
            'Reload': 'RefreshCw',  // correct icon name
            'Calendar': 'Calendar', // exists — keep
            'Clock': 'Clock',       // exists — keep
            'User': 'User',         // exists — keep
            'Users': 'Users',       // exists — keep
            'Settings': 'Settings', // exists — keep
            'Filter': 'Filter',     // exists — keep
            'Sort': 'ArrowUpDown',  // correct icon name
            'Chart': 'BarChart2',   // correct icon name
            'Graph': 'LineChart',   // correct icon name
            'Analytics': 'BarChart2', // correct icon name
            'Dashboard': 'LayoutDashboard', // correct icon name
            'Home': 'Home',         // exists — keep
            'Back': 'ArrowLeft',    // correct icon name
            'Forward': 'ArrowRight', // correct icon name
            'Folder': 'Folder',     // exists — keep
            'File': 'File',         // exists — keep
            'Notification': 'Bell', // correct icon name
            'Bell': 'Bell',         // exists — keep
            'Flag': 'Flag',         // exists — keep
            'Tag': 'Tag',           // exists — keep
            'Link': 'Link',         // exists — keep
            'ExternalLink': 'ExternalLink', // exists — keep
            'Maximize': 'Maximize2', // correct icon name
            'Minimize': 'Minimize2', // correct icon name
            'Grid': 'Grid3X3',      // correct icon name
            'List': 'List',         // exists — keep
            'KanbanSquare': 'KanbanSquare', // exists — keep
            'LogOut': 'LogOut',     // exists — keep
            'LogIn': 'LogIn',       // exists — keep
            'Plus': 'Plus',         // exists — keep
            'Minus': 'Minus',       // exists — keep
            'X': 'X',               // exists — keep
            'ChevronDown': 'ChevronDown', // exists — keep
            'ChevronUp': 'ChevronUp', // exists — keep
            'ChevronLeft': 'ChevronLeft', // exists — keep
            'ChevronRight': 'ChevronRight', // exists — keep
            // Brand icons (removed from lucide-react)
            'Netflix': 'Film',
            'Twitter': 'MessageCircle',
            'Facebook': 'Share2',
            'Google': 'Search',
            'Apple': 'Command',
            'Github': 'Code2',
            'GitHub': 'Code2',
            'Linkedin': 'Briefcase',
            'LinkedIn': 'Briefcase',
            'Instagram': 'Camera',
            'Youtube': 'Video',
            'YouTube': 'Video',
            'Twitch': 'MonitorPlay',
            'Discord': 'MessageSquare',
            'Slack': 'Hash',
        },
    },

    'react-router-dom': {
        description: 'routing library — exports Link, NavLink, useNavigate, useParams, Outlet, etc.',
        hallucinations: {
            'Switch': null,       // renamed to Routes in v6
            'Redirect': null,     // replaced by Navigate in v6 — remove and warn
        },
    },

    '@tanstack/react-query': {
        description: 'data fetching — exports useQuery, useMutation, QueryClient, QueryClientProvider',
        hallucinations: {
            'useQueryClient': 'useQueryClient', // this actually exists — keep
            'QueryCache': 'QueryCache',         // exists — keep
        },
    },
};

/**
 * Checks a file's import statements against the hallucination registry.
 * For each hallucinated import found:
 *   - If replacement exists: rename the import
 *   - If replacement is null: remove just that named import from the import statement
 *
 * Returns updated content + list of fixes applied.
 */
function fixHallucinatedImports(content: string, path: string): {
    content: string;
    fixes: ValidationFix[];
} {
    if (!/\.[jt]sx?$/.test(path)) return { content, fixes: [] };

    const fixes: ValidationFix[] = [];
    let updatedContent = content;

    // Match: import { Foo, Bar, Baz } from 'package'
    // Also: import DefaultExport, { Foo, Bar } from 'package'
    const importStatementPattern = /import\s+(type\s+)?(\{[^}]+\}|[^{}\n]+)\s+from\s+['"]([^'"]+)['"]/g;

    let match: RegExpExecArray | null;
    const replacements: Array<{ original: string; replacement: string }> = [];

    importStatementPattern.lastIndex = 0;
    while ((match = importStatementPattern.exec(content)) !== null) {
        const fullStatement = match[0];
        const typeKeyword = match[1] ?? '';
        const importClause = match[2];
        const packageName = match[3];

        // Only check bare package imports (not local paths)
        if (packageName.startsWith('.') || packageName.startsWith('/')) continue;

        // Get root package name for scoped packages
        const rootPkg = packageName.startsWith('@')
            ? packageName.split('/').slice(0, 2).join('/')
            : packageName.split('/')[0];

        const rules = IMPORT_HALLUCINATION_REGISTRY[rootPkg];
        if (!rules) continue;

        // Only process named imports: { Foo, Bar }
        if (!importClause.trim().startsWith('{')) continue;

        const namedImportsStr = importClause.replace(/[{}]/g, '').trim();
        const namedImports = namedImportsStr.split(',').map(s => s.trim()).filter(Boolean);

        let modified = false;
        const newImports: string[] = [];
        const fixDescriptions: string[] = [];

        for (const imp of namedImports) {
            // Handle aliased imports: "Foo as Bar"
            const parts = imp.split(/\s+as\s+/);
            const importedName = parts[0].trim();
            const alias = parts[1]?.trim();

            if (importedName in rules.hallucinations) {
                const replacement = rules.hallucinations[importedName];

                if (replacement === null || replacement === importedName) {
                    // replacement === importedName means it's VALID — keep as-is
                    if (replacement !== null) {
                        newImports.push(imp); // valid export, keep
                    } else {
                        // null = remove this import
                        modified = true;
                        fixDescriptions.push(`removed '${importedName}' (does not exist in ${rootPkg})`);
                    }
                } else {
                    // Rename to the correct export
                    modified = true;
                    // If no alias exists, we MUST create one so the JSX using the old name still works
                    const effectiveAlias = alias || importedName;
                    const newImp = `${replacement} as ${effectiveAlias}`;
                    newImports.push(newImp);
                    fixDescriptions.push(`'${importedName}' → '${replacement}' (aliased as ${effectiveAlias})`);
                }
            } else {
                newImports.push(imp); // not in hallucination list, keep as-is
            }
        }

        if (modified) {
            let newStatement: string;
            if (newImports.length === 0) {
                // All named imports were removed — remove the entire statement
                newStatement = '';
                fixDescriptions.push(`(entire import statement removed)`);
            } else {
                newStatement = `import ${typeKeyword}{ ${newImports.join(', ')} } from '${packageName}'`;
            }

            replacements.push({ original: fullStatement, replacement: newStatement });
            fixes.push({
                rule: 'hallucinated-import',
                severity: 'auto',
                description: `Fixed hallucinated imports from '${rootPkg}': ${fixDescriptions.join('; ')}`,
                before: fullStatement,
                after: newStatement || '(removed)',
            });
        }
    }

    // Apply all replacements
    for (const { original, replacement } of replacements) {
        updatedContent = updatedContent.replace(original, replacement);
    }

    // Clean up blank lines left by removed imports
    if (replacements.some(r => r.replacement === '')) {
        updatedContent = updatedContent.replace(/\n\n\n+/g, '\n\n');
    }

    return { content: updatedContent, fixes };
}

// ── Roadmap 3: Automated Asset Sourcing ───────────────────────────────────
/**
 * Automatically detects generic LLM image placeholders and replaces them with
 * stock photography from Picsum.
 */
function validateImagePlaceholders(content: string, path: string): { content: string, fix: ValidationFix | null } {
    if (!/\.[jt]sx?$/.test(path)) return { content, fix: null };

    let fixCount = 0;
    // Match src="placeholder", src="...", src="/image.jpg", src="https://via.placeholder.com", imgur, pravatar, etc.
    const genericSrcRegex = /(src\s*=\s*["'])(?:\.\.\.|placeholder[^"']*|https?:\/\/via\.placeholder\.com[^"']*|https?:\/\/picsum\.photos[^"']*|https?:\/\/unsplash\.it[^"']*|https?:\/\/i\.pravatar\.cc[^"']*|https?:\/\/(?:i\.)?imgur\.com[^"']*|\/?image\.jpg|\/?img\.(?:jpg|png)|#)["']/gi;

    // Beautiful, generic Unsplash photos that send Cross-Origin-Resource-Policy: cross-origin
    // This is required to bypass WebContainer's strict COEP constraints.
    const unsplashIds = [
        '1682687221038-1115de237d15', '1498050108023-c5249f4df085', '1461749280684-dccba630e2f6',
        '1517694712202-14dd9538aa97', '1515879218367-8466d910aaa4', '1525547710557-80247495a973',
        '1488590528505-98d2b59198d7', '1551033406-e911e9b42274', '1542831371-29b0f74f9713',
        '1504639725597-78f6ec6b5383', '1555066931-4365d14bab8c', '1498050108023-c5249f4df085',
        '1449033332823-825f771f2008', '1501785888041-af3ef285b470', '1519389950473-47ba0277781c',
        '1494438639946-1ebd1d20bf85', '1516117172878-fd2c41e4a759', '1506744626772-277133ceaf75',
        '1470071131384-001b85755b36', '1522770179533-24471fcdba45', '1682687220742-aba13b6e50ba',
        '1540206395-68808572332f', '1618005182384-a83a8bd57fbe', '1600269452121-4b24fc0b06b1',
        '1587502537147-1473f32bd723', '1501854140801-50d01698950b', '1469474968028-56623f02e42e'
    ];

    const fixed = content.replace(genericSrcRegex, (match, prefix) => {
        fixCount++;
        const id = unsplashIds[Math.floor(Math.random() * unsplashIds.length)];
        return `${prefix}https://images.unsplash.com/photo-${id}?w=800&q=80"`;
    });

    if (fixCount === 0) return { content, fix: null };

    return {
        content: fixed,
        fix: {
            rule: 'automated-asset-sourcing',
            severity: 'auto',
            description: `Sourced ${fixCount} stock image(s) to replace generic placeholders.`
        }
    };
}

// ─── Core Validator ────────────────────────────────────────────────────────────

/**
 * Run all validation rules against a single file.
 * Returns the (possibly fixed) path + content, plus a structured report.
 */
export function validateFile(path: string, content: string): PreFlightResult {
    const fixes: ValidationFix[] = [];
    const blockingErrors: string[] = [];

    let currentPath = path;
    let currentContent = content;

    // ── Rule 1: Extension enforcement (modifies path) ─────────────────────────
    const { newPath, fix: extFix } = enforceExtension(currentPath, currentContent);
    if (extFix) {
        currentPath = newPath;
        fixes.push(extFix);
    }

    // ── Rule 2: Regex double-escape ───────────────────────────────────────────
    const { content: regexFixed, fix: regexFix } = sanitizeRegexEscapes(currentContent, currentPath);
    if (regexFix) {
        currentContent = regexFixed;
        fixes.push(regexFix);
    }

    // ── Rule 3: Template literal escapes ─────────────────────────────────────
    const { content: templateFixed, fix: templateFix } = sanitizeTemplateLiterals(currentContent, currentPath);
    if (templateFix) {
        currentContent = templateFixed;
        fixes.push(templateFix);
    }

    // ── Rule 4: Mismatched React types ────────────────────────────────────────
    const typeFix = detectMismatchedTypes(currentContent, currentPath);
    if (typeFix) fixes.push(typeFix);

    // ── Rule 5: JSON validity ─────────────────────────────────────────────────
    const jsonFix = validateJSON(currentContent, currentPath);
    if (jsonFix) {
        fixes.push(jsonFix);
        if (jsonFix.severity === 'block') blockingErrors.push(jsonFix.description);
    }

    // ── Rule 6: Truncation detection ─────────────────────────────────────────
    const truncFix = detectTruncation(currentContent, currentPath);
    if (truncFix) {
        fixes.push(truncFix);
        if (truncFix.severity === 'block') blockingErrors.push(truncFix.description);
    }

    // ── Rule 7: Hallucinated named imports ────────────────────────────────────
    const { content: importFixed, fixes: importFixes } = fixHallucinatedImports(currentContent, currentPath);
    if (importFixes.length > 0) {
        currentContent = importFixed;
        fixes.push(...importFixes);
    }

    // ── Rule 8: Automated Asset Sourcing ──────────────────────────────────────
    const customImgFix = validateImagePlaceholders(currentContent, currentPath);
    if (customImgFix.fix) {
        currentContent = customImgFix.content;
        fixes.push(customImgFix.fix);
    }

    // ── Rule 9: Package.json sanitization ─────────────────────────────────────
    const pkgFix = sanitizePackageJson(currentContent, currentPath);
    if (pkgFix.fix) {
        currentContent = pkgFix.content;
        fixes.push(pkgFix.fix);
    }

    // ── Rule 11: CSS Import Ordering ──────────────────────────────────────────
    const cssFix = fixCssImports(currentContent, currentPath);
    if (cssFix.fix) {
        currentContent = cssFix.content;
        fixes.push(cssFix.fix);
    }

    // ── Rule 12: Vite HMR Sanitization ────────────────────────────────────────
    const viteFix = sanitizeViteConfig(currentContent, currentPath);
    if (viteFix.fix) {
        currentContent = viteFix.content;
        fixes.push(viteFix.fix);
    }

    return {
        path: currentPath,
        content: currentContent,
        ok: blockingErrors.length === 0,
        fixes,
        blockingErrors,
    };
}

/**
 * Run pre-flight validation across all files in a batch.
 * Also updates import paths in other files when a file gets renamed (.ts → .tsx).
 */
export function validateBatch(files: Array<{ path: string; content: string }>): BatchPreFlightResult {
    // Phase 1: validate each file individually
    const results: PreFlightResult[] = files.map(f => validateFile(f.path, f.content));

    // Phase 2: build rename map (old path → new path)
    const renames = new Map<string, string>();
    for (let i = 0; i < files.length; i++) {
        if (results[i].path !== files[i].path) {
            renames.set(files[i].path, results[i].path);
        }
    }

    // Phase 3: update imports in all files to reflect renames
    if (renames.size > 0) {
        for (const result of results) {
            if (!/\.[jt]sx?$/.test(result.path)) continue;

            let updatedContent = result.content;
            let importFixed = false;

            for (const [oldPath, newPath] of renames) {
                // Convert absolute paths to relative import-style paths for matching
                const oldName = oldPath.replace(/^src\//, '').replace(/\.[jt]sx?$/, '');
                const newName = newPath.replace(/^src\//, '').replace(/\.[jt]sx?$/, '');

                if (oldName === newName) continue;

                // Match import statements referencing the old path
                const importPattern = new RegExp(
                    `(from\\s+['"])([^'"]*${escapeRegExp(oldName)})(['"])`,
                    'g'
                );

                const fixed = updatedContent.replace(importPattern, (_, from, importPath, quote) => {
                    importFixed = true;
                    return `${from}${importPath.replace(oldName, newName)}${quote}`;
                });

                if (fixed !== updatedContent) {
                    updatedContent = fixed;
                }
            }

            if (importFixed) {
                result.content = updatedContent;
                result.fixes.push({
                    rule: 'import-path-update',
                    severity: 'auto',
                    description: `Updated import paths to reflect file renames`,
                });
            }
        }
    }

    return {
        files: results,
        renames,
        hasBlockingErrors: results.some(r => !r.ok),
    };
}

// ─── Structured Logger ─────────────────────────────────────────────────────────

/**
 * Formats pre-flight results into a human-readable log block.
 * Feed this to onOutput so it appears in Orbit's terminal panel.
 */
export function formatPreFlightLog(results: PreFlightResult[]): string {
    const lines: string[] = [];
    let totalFixes = 0;
    let totalBlocking = 0;

    for (const r of results) {
        const autoFixes = r.fixes.filter(f => f.severity === 'auto');
        const warnings = r.fixes.filter(f => f.severity === 'warn');
        const blocking = r.fixes.filter(f => f.severity === 'block');

        totalFixes += autoFixes.length;
        totalBlocking += blocking.length;

        if (r.fixes.length === 0) continue; // clean file, no noise

        lines.push(`\n🔍 pre-flight: ${r.path}`);
        for (const fix of autoFixes) lines.push(`  ✅ auto-fixed [${fix.rule}]: ${fix.description}`);
        for (const fix of warnings) lines.push(`  ⚠️  warning  [${fix.rule}]: ${fix.description}`);
        for (const fix of blocking) lines.push(`  ❌ blocked  [${fix.rule}]: ${fix.description}`);
    }

    if (lines.length === 0) return '';

    const summary = totalBlocking > 0
        ? `❌ Pre-flight: ${totalFixes} auto-fixed, ${totalBlocking} blocking error(s)`
        : `✅ Pre-flight: ${totalFixes} issue(s) auto-fixed, all files clean`;

    return [summary, ...lines].join('\n') + '\n';
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
