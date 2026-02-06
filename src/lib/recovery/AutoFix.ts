import { ProjectFile } from '@/types/chat';
import { ErrorType } from './ErrorDetector';

export interface AutoFixSuggestion {
    type: 'auto-fix' | 'manual-fix';
    description: string;
    action: 'fix-syntax' | 'modify-package-json' | 'retry-with-flags' | 'manual-intervention';
    file?: string;
    pattern?: RegExp;
    replacement?: string;
    requiresApproval: boolean;
    newCommand?: string;
}

export class AutoFix {
    static suggestFix(
        error: ErrorType,
        files: ProjectFile[]
    ): AutoFixSuggestion | null {
        switch (error.type) {
            case 'template-literal-escape-error':
                return this.suggestTemplateLiteralFix(error, files);

            case 'peer-dependency-error':
            case 'npm-version-conflict':
                return {
                    type: 'auto-fix',
                    description: 'Dependency conflict detected. Retrying with --legacy-peer-deps.',
                    action: 'retry-with-flags',
                    newCommand: 'npm install --legacy-peer-deps',
                    requiresApproval: false
                };

            case 'syntax-error':
                // For general syntax errors, we might need a more complex fix or Multi-Agent fallback
                // But for now, let's see if it's a known simple syntax regression
                return {
                    type: 'manual-fix',
                    description: `Syntax error in ${error.file || 'unknown file'}. User intervention or Multi-Agent analysis recommended.`,
                    action: 'manual-intervention',
                    file: error.file,
                    requiresApproval: true
                };

            case 'esm-cjs-conflict':
                return this.suggestESMConversion(error, files);

            case 'missing-import':
                return {
                    type: 'auto-fix',
                    description: `Missing import detected. Check if "${error.file || 'module'}" needs to be installed or imported correctly.`,
                    action: 'modify-package-json',
                    file: error.file,
                    requiresApproval: true
                };

            case 'circular-dependency':
                return {
                    type: 'manual-fix',
                    description: `Circular dependency detected in ${error.file || 'project'}. Requires architectural refactoring.`,
                    action: 'manual-intervention',
                    file: error.file,
                    requiresApproval: true
                };

            case 'css-syntax':
                return {
                    type: 'auto-fix',
                    description: `CSS syntax error in ${error.file || 'stylesheet'}. Check Tailwind directives and CSS rules.`,
                    action: 'fix-syntax',
                    file: error.file || 'src/index.css',
                    requiresApproval: false
                };

            default:
                return null;
        }
    }

    private static suggestESMConversion(
        error: ErrorType,
        files: ProjectFile[]
    ): AutoFixSuggestion | null {
        const filePath = error.file || 'postcss.config.js';
        const file = files.find(f => f.path === filePath || f.path.endsWith(filePath));

        if (!file) return null;

        return {
            type: 'auto-fix',
            description: `Converting ${filePath} from CommonJS to ES Module.`,
            action: 'fix-syntax',
            file: file.path,
            pattern: /module\.exports\s*=\s*/g,
            replacement: 'export default ',
            requiresApproval: false
        };
    }

    private static suggestTemplateLiteralFix(
        error: ErrorType,
        files: ProjectFile[]
    ): AutoFixSuggestion | null {
        if (!error.file) return null;

        const file = files.find(f => f.path === error.file || f.path.endsWith(error.file));
        if (!file) return null;

        // Pattern to fix: \${ -> ${ and \` -> `
        return {
            type: 'auto-fix',
            description: 'Fixing improperly escaped template literal syntax.',
            action: 'fix-syntax',
            file: file.path,
            pattern: /\\?(\$\{|`)/g,
            replacement: '$1', // Use capture group to restore the character without the backslash
            requiresApproval: false
        };
    }
}
