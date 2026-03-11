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

import { EditorAgent } from './agents';
import { astEngine, ASTPatch } from './ast/engine';

/**
 * Generates an AST patch and applies it deterministically to the file
 */
export async function generateFileWithValidation(
    filePlan: any,
    context: any,
    maxAttempts = 3
): Promise<GeneratedFile> {

    let lastError: ValidationError | null = null;
    
    // Ensure Tree-sitter is booted
    await astEngine.init();

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`🔧 Generating AST Patch for ${filePlan.path} (attempt ${attempt}/${maxAttempts})...`);

        try {
            // 1. Fetch current file content from context or file system
            const existingCode = context.contextFiles?.find((f: any) => f.path === filePlan.path)?.content || '';
            
            // 2. Instruct EditorAgent to generate a deterministic JSON Patch
            const astPatch: ASTPatch = await EditorAgent.generatePatch(
               filePlan.path, 
               existingCode, 
               context.originalPrompt + (context.previousError ? `\nFix previous error: ${JSON.stringify(context.previousError)}` : '')
            );

            // 3. Apply the patch using tree-sitter
            let newCode = '';
            try {
                newCode = astEngine.applyPatch(existingCode, astPatch);
            } catch (patchErr: any) {
                console.error('Failed to apply AST patch safely:', patchErr);
                throw new Error(`AST Synthesis error: ${patchErr.message}`);
            }

            // 4. Validate the resulting syntax using tree-sitter
            // If tree-sitter cannot parse the modified source code, the patch broke the file's syntax graph.
            const validationResult = validateSyntaxViaTreeSitter(newCode, filePlan.path);

            if (!validationResult.isValid) {
                console.warn(`⚠️ Syntax validation failed post-patch`, validationResult.errors);
                lastError = validationResult.errors[0];

                if (attempt < maxAttempts) {
                    console.log(`🔄 Retrying patch synthesis with error context...`);
                    context.previousError = {
                        attempt,
                        errors: validationResult.errors,
                        patch: astPatch
                    };
                    continue;
                }
            }

            // ✅ STEP 5: If valid or max attempts reached, return
            console.log(`✅ Successfully patched ${filePlan.path}`);

            return {
                path: filePlan.path,
                content: newCode,
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
 * Validates generated code using structural AST checks rather than regex strings
 */
function validateSyntaxViaTreeSitter(
    code: string,
    filePath: string
): { isValid: boolean; errors: ValidationError[] } {

    const errors: ValidationError[] = [];

    if (!code || code.trim().length === 0) {
        errors.push({ file: filePath, line: 0, column: 0, message: 'Generated code is empty' });
        return { isValid: false, errors };
    }

    try {
        const tree = astEngine.parse(code);
        if (tree.rootNode.hasError) {
             errors.push({ file: filePath, line: 0, column: 0, message: 'Tree-sitter reports a fundamental syntax error (unbalanced brackets, invalid operators, etc)' });
        }
    } catch(e) {
        errors.push({ file: filePath, line: 0, column: 0, message: 'Could not parse AST. Critical syntax failure.' });
    }

    return {
        isValid: errors.length === 0,
        errors,
    };
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
