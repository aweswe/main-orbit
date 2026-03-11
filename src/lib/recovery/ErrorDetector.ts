import { ProjectFile } from '@/types/chat';

export type ErrorTypeCategory =
    | 'npm-version-conflict'
    | 'peer-dependency-error'
    | 'syntax-error'
    | 'template-literal-escape-error'
    | 'dev-server-hang'
    | 'missing-dependency'
    | 'esm-cjs-conflict'
    | 'unknown';

export interface ErrorType {
    type: ErrorTypeCategory;
    file?: string;
    line?: number;
    message: string;
    suggestedFix?: string;
}

export class ErrorDetector {
    static detectErrorType(error: string): ErrorType {
        const errorLower = error.toLowerCase();

        // Template literal escaping error
        if (error.includes('Expecting Unicode escape sequence') ||
            error.includes('Unexpected character') ||
            error.includes('Invalid escape sequence')) {
            return {
                type: 'template-literal-escape-error',
                file: this.extractFilePath(error),
                line: this.extractLineNumber(error),
                message: error,
                suggestedFix: 'Remove backslashes before ${} in template literals'
            };
        }

        // NPM Version Conflicts
        if (errorLower.includes('npm err! code eresolve') ||
            errorLower.includes('resolving dependencies') ||
            errorLower.includes('conflict')) {
            return {
                type: 'npm-version-conflict',
                message: error,
                suggestedFix: 'Try running with --legacy-peer-deps or updating package.json'
            };
        }

        // Peer Dependency Errors
        if (errorLower.includes('peer dependency') ||
            errorLower.includes('is not compatible with')) {
            return {
                type: 'peer-dependency-error',
                message: error,
                suggestedFix: 'Use --legacy-peer-deps'
            };
        }

        // Syntax Errors (Vite/Babel)
        if (error.includes('SyntaxError') || errorLower.includes('unexpected token')) {
            return {
                type: 'syntax-error',
                file: this.extractFilePath(error),
                line: this.extractLineNumber(error),
                message: error,
                suggestedFix: 'Fix malformed JSX or TypeScript syntax'
            };
        }

        // Command not found / Missing dependency
        if (errorLower.includes('command not found') || errorLower.includes('not recognized as an internal')) {
            return {
                type: 'missing-dependency',
                message: error,
                suggestedFix: 'Ensure npm install was successful'
            };
        }

        // ESM / CJS Conflict
        if (error.includes('ReferenceError: module is not defined') ||
            error.includes('module is not defined in ES module scope')) {
            return {
                type: 'esm-cjs-conflict',
                file: this.extractFilePath(error) || 'postcss.config.js',
                message: error,
                suggestedFix: 'Rename to .cjs or change to export default'
            };
        }

        return {
            type: 'unknown',
            message: error
        };
    }

    private static extractFilePath(error: string): string | undefined {
        // Matches patterns like "src/App.tsx:10:5" or "c:/path/to/file.tsx"
        const match = error.match(/([a-zA-Z]:[\\/][^:]+|[a-zA-Z0-9.\-_/]+\.(tsx|ts|jsx|js|css))/);
        return match ? match[1] : undefined;
    }

    private static extractLineNumber(error: string): number | undefined {
        const match = error.match(/:(\d+):/);
        return match ? parseInt(match[1], 10) : undefined;
    }
}
