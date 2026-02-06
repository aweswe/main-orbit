// lib/generateWithValidation.ts
// Frontend wrapper that validates generated code and auto-retries on errors

interface GeneratedFile {
    path: string;
    content: string;
    type: string;
}

interface ValidationError {
    file: string;
    line: number;
    column: number;
    message: string;
}

/**
 * Generates a file with automatic validation and retry on syntax errors
 */
export async function generateFileWithValidation(
    filePlan: any,
    context: any,
    maxAttempts = 3
): Promise<GeneratedFile> {

    let lastError: ValidationError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`🔧 Generating ${filePlan.path} (attempt ${attempt}/${maxAttempts})...`);

        try {
            // Call your Edge Function
            const response = await fetch('/api/generate-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filePlan,
                    sharedProject: context.sharedProject,
                    contextFiles: context.contextFiles,
                    prompt: context.originalPrompt,
                }),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Generation failed');
            }

            const { code } = await response.json();

            // ✅ STEP 1: Validate the generated code
            const validation = validateGeneratedCode(code, filePlan);

            if (!validation.isValid) {
                console.warn(`⚠️ Generated code has issues:`, validation.errors);
                lastError = validation.errors[0];

                // If this isn't the last attempt, add error context and retry
                if (attempt < maxAttempts) {
                    console.log(`🔄 Retrying with error context...`);

                    // Add previous error to context so AI can fix it
                    context.previousError = {
                        attempt,
                        errors: validation.errors,
                        partialCode: code,
                    };

                    continue; // Retry
                }
            }

            // ✅ STEP 2: If valid or max attempts reached, return
            console.log(`✅ Successfully generated ${filePlan.path}`);

            return {
                path: filePlan.path,
                content: code,
                type: filePlan.type,
            };

        } catch (error: any) {
            console.error(`❌ Attempt ${attempt} failed:`, error.message);

            if (attempt === maxAttempts) {
                throw new Error(
                    `Failed to generate ${filePlan.path} after ${maxAttempts} attempts. ` +
                    `Last error: ${lastError?.message || error.message}`
                );
            }
        }
    }

    throw new Error(`Failed to generate ${filePlan.path}`);
}

/**
 * Validates generated TypeScript/React code
 */
function validateGeneratedCode(
    code: string,
    filePlan: any
): { isValid: boolean; errors: ValidationError[] } {

    const errors: ValidationError[] = [];

    // ✅ CHECK 1: Code is not empty
    if (!code || code.trim().length === 0) {
        errors.push({
            file: filePlan.path,
            line: 0,
            column: 0,
            message: 'Generated code is empty',
        });
        return { isValid: false, errors };
    }

    // ✅ CHECK 2: Brackets are balanced
    const brackets = {
        '{': (code.match(/{/g) || []).length,
        '}': (code.match(/}/g) || []).length,
        '(': (code.match(/\(/g) || []).length,
        ')': (code.match(/\)/g) || []).length,
        '[': (code.match(/\[/g) || []).length,
        ']': (code.match(/\]/g) || []).length,
    };

    if (brackets['{'] !== brackets['}']) {
        errors.push({
            file: filePlan.path,
            line: findLineWithUnbalancedBracket(code, '{', '}'),
            column: 0,
            message: `Unbalanced curly braces: ${brackets['{']} open, ${brackets['}']} close`,
        });
    }

    if (brackets['('] !== brackets[')']) {
        errors.push({
            file: filePlan.path,
            line: findLineWithUnbalancedBracket(code, '(', ')'),
            column: 0,
            message: `Unbalanced parentheses: ${brackets['(']} open, ${brackets[')']} close`,
        });
    }

    if (brackets['['] !== brackets[']']) {
        errors.push({
            file: filePlan.path,
            line: findLineWithUnbalancedBracket(code, '[', ']'),
            column: 0,
            message: `Unbalanced square brackets: ${brackets['[']} open, ${brackets[']']} close`,
        });
    }

    // ✅ CHECK 3: Has required exports
    for (const exportName of filePlan.exports || []) {
        const exportPatterns = [
            `export const ${exportName}`,
            `export function ${exportName}`,
            `export interface ${exportName}`,
            `export type ${exportName}`,
            `export class ${exportName}`,
            `export { ${exportName}`,
        ];

        const hasExport = exportPatterns.some(pattern => code.includes(pattern));

        if (!hasExport) {
            errors.push({
                file: filePlan.path,
                line: 0,
                column: 0,
                message: `Missing required export: ${exportName}`,
            });
        }
    }

    // ✅ CHECK 4: No incomplete code markers
    const incompleteMarkers = [
        '// ...',
        '// rest of code',
        '// TODO',
        '...',
    ];

    for (const marker of incompleteMarkers) {
        if (code.includes(marker)) {
            const line = code.split('\n').findIndex(l => l.includes(marker)) + 1;
            errors.push({
                file: filePlan.path,
                line,
                column: 0,
                message: `Code contains incomplete marker: "${marker}"`,
            });
        }
    }

    // ✅ CHECK 5: For React components, ensure return statement
    if (filePlan.type === 'component' && !code.includes('return')) {
        errors.push({
            file: filePlan.path,
            line: 0,
            column: 0,
            message: 'React component missing return statement',
        });
    }

    return {
        isValid: errors.length === 0,
        errors,
    };
}

/**
 * Find the line number where brackets become unbalanced
 */
function findLineWithUnbalancedBracket(
    code: string,
    openChar: string,
    closeChar: string
): number {
    const lines = code.split('\n');
    let balance = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        for (const char of line) {
            if (char === openChar) balance++;
            if (char === closeChar) balance--;

            if (balance < 0) {
                return i + 1; // Return 1-indexed line number
            }
        }
    }

    // Find last line with open bracket
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].includes(openChar)) {
            return i + 1;
        }
    }

    return lines.length;
}

/**
 * Batch generate multiple files with validation
 */
export async function generateMultipleFilesWithValidation(
    filePlans: any[],
    context: any,
    onProgress?: (current: number, total: number, file: string) => void
): Promise<GeneratedFile[]> {

    const generatedFiles: GeneratedFile[] = [];

    for (let i = 0; i < filePlans.length; i++) {
        const filePlan = filePlans[i];

        // Update progress
        onProgress?.(i + 1, filePlans.length, filePlan.path);

        // Generate with validation
        const file = await generateFileWithValidation(filePlan, {
            ...context,
            contextFiles: generatedFiles, // Pass previously generated files
        });

        generatedFiles.push(file);

        // Small delay to prevent rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    return generatedFiles;
}
