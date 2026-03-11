// supabase/functions/generate-project-file/index.ts
// @ts-ignore: Deno library
import "https://deno.land/x/xhr@0.1.0/mod.ts";
// @ts-ignore: Deno library
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are a Senior Full-Stack Engineer. Your task is to generate the code for a SPECIFIC file as part of a larger project.

CRITICAL INSTRUCTIONS:
1. ONLY generate code for the requested file.
2. Use the provided "Project Context" and "Shared Types" to ensure consistency.
3. Use Tailwind CSS for all styling.
4. Follow the provided imports and exports strictly.
5. If the file is a React component, use functional components and hooks.
6. Ensure the code is production-ready, beautiful, and self-contained within its module boundaries.
7. ALL brackets, braces, and parentheses MUST be properly CLOSED.
8. Code must be COMPLETE - NO truncation, NO "// rest of code" comments, NO placeholders.

OUTPUT FORMAT:
Return your response in this EXACT format:
EXPLANATION:
[Brief description of what this file does]

\`\`\`tsx
[Your COMPLETE code here - ensure all brackets are closed]
\`\`\`
`;

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    try {
        const {
            filePlan,
            sharedProject,
            contextFiles = [],
            prompt,
            previousError
        } = await req.json();

        // @ts-ignore: Deno namespace
        const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY');

        if (!GROQ_API_KEY) {
            throw new Error('GROQ_API_KEY not configured');
        }

        let combinedContext = `
ORIGINAL PROMPT: ${prompt}
PROJECT IDENTITY: ${JSON.stringify(sharedProject, null, 2)}

FILE TO GENERATE:
Path: ${filePlan.path}
Type: ${filePlan.type}
Purpose: ${filePlan.purpose}
Dependencies: ${filePlan.dependencies.join(', ')}
Expected Exports: ${filePlan.exports.join(', ')}

EXISTING CONTEXT FILES:
${contextFiles.map((f: any) => `--- FILE: ${f.path} ---\n${f.content}\n`).join('\n')}

IMPORTANT: Generate COMPLETE code. Ensure ALL brackets are balanced and closed.
`;

        // Add previous error context if retrying
        if (previousError) {
            combinedContext += `\n\nPREVIOUS ATTEMPT HAD ERRORS:\n${previousError.errors.map((e: any) => `- ${e.message || e}`).join('\n')}\n\nPlease fix these issues and generate COMPLETE code.`;
        }

        let attempt = 0;
        let code = null;
        let content = null;
        let lastError = null;

        // Retry up to 2 times if code is incomplete
        while (attempt < 2 && !code) {
            attempt++;

            console.log(`Attempt ${attempt} to generate ${filePlan.path}...`);

            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'openai/gpt-oss-120b',
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user', content: combinedContext }
                    ],
                    temperature: 0.1,
                    max_tokens: 8000, // ✅ INCREASED to prevent truncation
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`Groq API error (${response.status}): ${JSON.stringify(errorData)}`);
            }

            const data = await response.json();
            content = data.choices[0].message.content;

            // Extract code - try to get the LAST code block (most complete)
            const codeBlocks = content.matchAll(/```(?:tsx?|jsx?|javascript|typescript)?\n([\s\S]*?)```/g);
            const allBlocks = Array.from(codeBlocks);

            if (allBlocks.length === 0) {
                lastError = "AI did not return code in proper format";
                console.error('No code block found in response:', content.substring(0, 200));
                continue;
            }

            // Use the longest code block (most likely to be complete)
            const extractedCode = allBlocks
                .map(m => m[1].trim())
                .reduce((a, b) => a.length > b.length ? a : b);

            if (!extractedCode) {
                lastError = "Extracted code is empty";
                continue;
            }

            // ✅ Validate code completeness
            const validation = validateCode(extractedCode, filePlan);

            if (!validation.isValid) {
                lastError = validation.errors.join(', ');
                console.error(`Generated code failed validation:`, validation.errors);

                // If this is attempt 1, try again with error context
                if (attempt === 1) {
                    combinedContext += `\n\nPREVIOUS ATTEMPT HAD ERRORS: ${validation.errors.join(', ')}\nPlease fix these issues and ensure ALL brackets are properly closed.`;
                    continue;
                }
            }

            code = extractedCode;
        }

        if (!code) {
            throw new Error(`Failed to generate valid code after ${attempt} attempts. Last error: ${lastError}`);
        }

        console.log(`✅ Successfully generated ${filePlan.path} (${code.split('\n').length} lines, attempt ${attempt})`);

        return new Response(JSON.stringify({
            success: true,
            code,
            content,
            linesOfCode: code.split('\n').length,
            attempts: attempt
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

    } catch (error: any) {
        console.error('Error in generate-project-file:', error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message,
            stack: error.stack
        }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});

// Code validation function
function validateCode(code: string, filePlan: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check 1: Code is not empty
    if (!code || code.trim().length === 0) {
        errors.push('Generated code is empty');
        return { isValid: false, errors };
    }

    // Check 2: Brackets are balanced
    const openCurly = (code.match(/{/g) || []).length;
    const closeCurly = (code.match(/}/g) || []).length;
    const openParen = (code.match(/\(/g) || []).length;
    const closeParen = (code.match(/\)/g) || []).length;
    const openSquare = (code.match(/\[/g) || []).length;
    const closeSquare = (code.match(/\]/g) || []).length;

    if (openCurly !== closeCurly) {
        errors.push(`Unbalanced curly braces: ${openCurly} open, ${closeCurly} close`);
    }
    if (openParen !== closeParen) {
        errors.push(`Unbalanced parentheses: ${openParen} open, ${closeParen} close`);
    }
    if (openSquare !== closeSquare) {
        errors.push(`Unbalanced square brackets: ${openSquare} open, ${closeSquare} close`);
    }

    // Check 3: Has expected exports
    for (const exportName of filePlan.exports || []) {
        const hasExport =
            code.includes(`export const ${exportName}`) ||
            code.includes(`export function ${exportName}`) ||
            code.includes(`export interface ${exportName}`) ||
            code.includes(`export type ${exportName}`) ||
            code.includes(`export class ${exportName}`) ||
            code.includes(`export { ${exportName}`) ||
            code.includes(`export default ${exportName}`) ||
            code.includes(`export default function ${exportName}`);

        if (!hasExport) {
            errors.push(`Missing required export: ${exportName}`);
        }
    }

    // Check 4: Code doesn't end with incomplete comment
    const trimmed = code.trim();
    if (trimmed.endsWith('//') || trimmed.endsWith('/*') || trimmed.endsWith(',')) {
        errors.push('Code ends abruptly (incomplete)');
    }

    // Check 5: No incomplete placeholders
    const incompletePlaceholders = ['// ...', '// rest', '// TODO:', '/* ... */'];
    for (const placeholder of incompletePlaceholders) {
        if (code.includes(placeholder)) {
            errors.push(`Code contains placeholder: ${placeholder}`);
        }
    }

    // Check 6: For React components, ensure return statement
    if (filePlan.type === 'component') {
        if (!code.includes('return (') && !code.includes('return <') && !code.includes('return null')) {
            errors.push('React component missing return statement');
        }
    }

    return {
        isValid: errors.length === 0,
        errors
    };
}
