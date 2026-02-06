/**
 * Utility to canonicalize imports in generated code.
 * Fixes relative import paths for Sandpack compatibility.
 * 
 * Problem: Generated code has deep relative paths like '../../../shared/types'
 * Solution: Convert to correct relative paths based on actual file locations
 */

/**
 * Calculate the correct relative path from one file to another
 */
function getRelativePath(fromFile: string, toFile: string): string {
    // Normalize paths (remove leading /)
    const from = fromFile.replace(/^\//, '').split('/');
    const to = toFile.replace(/^\//, '').split('/');

    // Remove filename from source path to get directory
    from.pop();

    // Find common prefix
    let commonPrefixLength = 0;
    while (
        commonPrefixLength < from.length &&
        commonPrefixLength < to.length &&
        from[commonPrefixLength] === to[commonPrefixLength]
    ) {
        commonPrefixLength++;
    }

    // Calculate steps up from source directory
    const stepsUp = from.length - commonPrefixLength;

    // Build relative path
    const relativeParts: string[] = [];
    for (let i = 0; i < stepsUp; i++) {
        relativeParts.push('..');
    }

    // Add remaining path to target
    for (let i = commonPrefixLength; i < to.length; i++) {
        relativeParts.push(to[i]);
    }

    // Join and ensure it starts with ./ or ../
    const result = relativeParts.join('/');
    return result.startsWith('.') ? result : `./${result}`;
}

/**
 * Get the target file path from an import statement
 */
function resolveImportTarget(importPath: string): string {
    // Map common import patterns to actual file paths
    const pathMappings: Record<string, string> = {
        'shared/types': '/shared/types.ts',
        'hooks/useTodos': '/hooks/useTodos.ts',
        'store/TodoContext': '/store/TodoContext.tsx',
        'services/localStorageService': '/services/localStorageService.ts',
        'util/classNames': '/util/classNames.ts',
        'util/animationUtil': '/util/animationUtil.ts',
        'components/Button': '/components/Button.tsx',
        'components/Card': '/components/Card.tsx',
        'components/TodoItem': '/components/TodoItem.tsx',
        'components/TodoList': '/components/TodoList.tsx',
        'components/AddTodoForm': '/components/AddTodoForm.tsx',
    };

    // Strip leading ./ or ../ chains
    const cleanPath = importPath.replace(/^(\.\.?\/)+/, '');

    // Check if we have a mapping
    for (const [pattern, target] of Object.entries(pathMappings)) {
        if (cleanPath === pattern || cleanPath.startsWith(pattern)) {
            return target;
        }
    }

    // Return as-is if no mapping found (for external packages)
    return '';
}

export function canonicalizeImports(code: string, currentPath: string): string {
    let fixedCode = code;

    // Match all relative imports
    const importRegex = /from\s+['"](\.\.[\/\w.-]+|\.\/[\/\w.-]+)['"]/g;

    fixedCode = fixedCode.replace(importRegex, (match, importPath) => {
        // Try to resolve the import target
        const targetPath = resolveImportTarget(importPath);

        if (targetPath) {
            // Calculate correct relative path
            // Remove .ts/.tsx extension for import
            const targetWithoutExt = targetPath.replace(/\.(ts|tsx)$/, '');
            const correctPath = getRelativePath(currentPath, targetWithoutExt);
            console.log(`🔧 [IMPORT-FIX] ${currentPath}: "${importPath}" → "${correctPath}"`);
            return `from '${correctPath}'`;
        }

        // If can't resolve, just clean up the path
        // Convert ../../../X to ./X
        const cleanPath = importPath.replace(/^(\.\.\/)+/, './');
        if (cleanPath !== importPath) {
            console.log(`🔧 [IMPORT-FIX] ${currentPath}: "${importPath}" → "${cleanPath}"`);
            return `from '${cleanPath}'`;
        }

        return match;
    });

    return fixedCode;
}

/**
 * Fix imports for all files in the project.
 */
export function canonicalizeAllImports(files: { path: string; content: string }[]): { path: string; content: string }[] {
    return files.map(file => ({
        ...file,
        content: canonicalizeImports(file.content, file.path)
    }));
}
