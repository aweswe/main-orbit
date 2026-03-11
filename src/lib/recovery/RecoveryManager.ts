import { ProjectFile } from '@/types/chat';
import { ErrorDetector } from './ErrorDetector';
import { AutoFix, AutoFixSuggestion } from './AutoFix';
import { ActionRunner } from '../runtime/action-runner';

export interface RecoveryResult {
    recovered: boolean;
    message: string;
    appliedFix?: AutoFixSuggestion;
}

export class RecoveryManager {
    private maxRetries = 2;
    private retryCount = 0;

    async attemptRecovery(
        error: string,
        files: ProjectFile[],
        runner: ActionRunner
    ): Promise<RecoveryResult> {
        const errorType = ErrorDetector.detectErrorType(error);
        const suggestion = AutoFix.suggestFix(errorType, files);

        if (!suggestion) {
            return {
                recovered: false,
                message: 'No automatic fix found for this error type.'
            };
        }

        if (suggestion.requiresApproval) {
            return {
                recovered: false,
                message: `Fix available but requires manual approval: ${suggestion.description}`,
                appliedFix: suggestion
            };
        }

        if (this.retryCount >= this.maxRetries) {
            return {
                recovered: false,
                message: 'Maximum recovery retries exceeded.'
            };
        }

        this.retryCount++;

        try {
            console.log(`[RECOVERY] Attempting fix: ${suggestion.description} (Retry ${this.retryCount})`);

            if (suggestion.action === 'fix-syntax' && suggestion.file && suggestion.pattern && suggestion.replacement !== undefined) {
                const fileIndex = files.findIndex(f => f.path === suggestion.file);
                if (fileIndex !== -1) {
                    const originalContent = files[fileIndex].content;
                    const newContent = originalContent.replace(suggestion.pattern, suggestion.replacement);

                    if (newContent !== originalContent) {
                        files[fileIndex].content = newContent;
                        // Write the fixed file to WebContainer
                        await runner.writeFile(suggestion.file, newContent);
                        return { recovered: true, message: 'Syntax fix applied successfully.', appliedFix: suggestion };
                    }
                }
            }

            if (suggestion.action === 'retry-with-flags' && suggestion.newCommand) {
                // We'll let the ActionRunner handle the command execution
                // But we return success here to indicate we have a recovery path
                return { recovered: true, message: 'Retrying with optimized flags.', appliedFix: suggestion };
            }

            return { recovered: false, message: 'Recovery action logic not yet fully implemented.' };

        } catch (e) {
            console.error('[RECOVERY] Failed to apply fix:', e);
            return { recovered: false, message: `Recovery attempt failed: ${e instanceof Error ? e.message : String(e)}` };
        }
    }

    reset() {
        this.retryCount = 0;
    }
}
