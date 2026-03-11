// supabase/functions/validate-code/index.ts
// @ts-ignore: Deno library
import "https://deno.land/x/xhr@0.1.0/mod.ts";
// @ts-ignore: Deno library
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are a Static Code Analyzer and TypeScript compiler. Your job is to find syntax errors, logically missing imports, and type inconsistencies in the provided code.

RULES:
1. Be extremely strict about syntax.
2. Check if all used components/utils in the code are imported.
3. Check for export default in React components.
4. Check for Tailwind CSS class syntax.
5. Identify "Warnings" (non-breaking issues) vs "Errors" (breaking issues).
6. Check for balanced brackets, braces, and parentheses.
7. Check for incomplete code (missing return statements, unterminated strings, etc.)

JSON OUTPUT FORMAT:
{
  "valid": true/false,
  "errors": ["Error message 1", "Error message 2"],
  "warnings": ["Warning message 1"]
}
`;

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    try {
        const { code, filename } = await req.json();

        // ✅ FIRST: Do local syntax validation (fast, no API call needed)
        const localValidation = validateCodeLocally(code, filename);

        if (!localValidation.valid && localValidation.errors.length > 0) {
            // If we found obvious errors locally, return immediately
            console.log(`Local validation failed for ${filename}:`, localValidation.errors);
            return new Response(JSON.stringify(localValidation), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // ✅ THEN: Use AI for deeper analysis
        // @ts-ignore: Deno namespace
        const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY');

        if (!GROQ_API_KEY) {
            // If no API key, return local validation result
            return new Response(JSON.stringify(localValidation), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        try {
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
                        { role: 'user', content: `Analyze this file: ${filename}\n\nCODE:\n${code}` }
                    ],
                    response_format: { type: "json_object" },
                    temperature: 0,
                }),
            });

            if (!response.ok) {
                console.warn(`Groq API error (${response.status}), falling back to local validation`);
                return new Response(JSON.stringify(localValidation), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }

            const data = await response.json();
            const result = JSON.parse(data.choices[0].message.content);

            // Merge local and AI validation results
            const mergedResult = {
                valid: localValidation.valid && (result.valid ?? true),
                errors: [...localValidation.errors, ...(result.errors || [])],
                warnings: [...localValidation.warnings, ...(result.warnings || [])],
            };

            return new Response(JSON.stringify(mergedResult), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        } catch (apiError: any) {
            console.warn('AI validation failed, using local validation:', apiError.message);
            return new Response(JSON.stringify(localValidation), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

    } catch (error: any) {
        console.error('Error in validate-code:', error);
        // ✅ IMPORTANT: On error, return INVALID (not valid) so issues are caught
        return new Response(JSON.stringify({
            valid: false,
            errors: [`Validation error: ${error.message}`],
            warnings: []
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});

// ✅ NEW: Local validation function (fast, no API call)
function validateCodeLocally(code: string, filename: string): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!code || code.trim().length === 0) {
        errors.push('Code is empty');
        return { valid: false, errors, warnings };
    }

    // Check 1: Brackets are balanced
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

    // Check 2: Code doesn't end abruptly
    const trimmed = code.trim();
    if (trimmed.endsWith('//') || trimmed.endsWith('/*')) {
        errors.push('Code ends with incomplete comment');
    }
    if (trimmed.endsWith(',') && !trimmed.endsWith('],') && !trimmed.endsWith('},')) {
        warnings.push('Code might be truncated (ends with comma)');
    }

    // Check 3: Check for common incomplete patterns
    if (code.includes('// ...') || code.includes('// rest of')) {
        errors.push('Code contains placeholder comments indicating incomplete code');
    }

    // Check 4: For TSX/JSX files, check for return statement in components
    if ((filename.endsWith('.tsx') || filename.endsWith('.jsx')) &&
        (code.includes('export default') || code.includes('export const')) &&
        code.includes('React') || code.includes('useState') || code.includes('useEffect')) {
        if (!code.includes('return (') && !code.includes('return <') && !code.includes('return null')) {
            warnings.push('React component may be missing return statement');
        }
    }

    // Check 5: String literals are closed
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comments
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

        // Count quotes (simple check - won't catch all edge cases)
        const singleQuotes = (line.match(/'/g) || []).length;
        const doubleQuotes = (line.match(/"/g) || []).length;
        const backticks = (line.match(/`/g) || []).length;

        // Template literals might span multiple lines, so only warn on single/double quotes
        if (singleQuotes % 2 !== 0 && !line.includes('`')) {
            warnings.push(`Line ${i + 1}: Possible unclosed single quote`);
        }
        if (doubleQuotes % 2 !== 0 && !line.includes('`')) {
            warnings.push(`Line ${i + 1}: Possible unclosed double quote`);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}
