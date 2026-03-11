import "https://deno.land/x/xhr@0.1.0/mod.ts";
// @ts-ignore: Deno library
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EDITOR_SYSTEM_PROMPT = `You are a surgical code editor. You make precise, minimal changes to existing code.

CRITICAL RULES:
1. Output ONLY valid JSON with patches
2. Use EXACT search strings - copy character-by-character from the existing code
3. Keep patches SMALL and FOCUSED - change only what's needed
4. Include enough context in search strings to be unique (at least one full line)
5. NEVER output code blocks, only JSON

OUTPUT FORMAT (pure JSON, no markdown):
{
  "explanation": "Brief description of what was changed",
  "patches": [
    {
      "file": "App.tsx",
      "operation": "replace",
      "search": "exact multi-line string to find",
      "replace": "replacement string"
    }
  ]
}

SEARCH STRING RULES:
- Must be EXACTLY as it appears in the code (including whitespace)
- Include enough context to be unique
- For className changes, include the full element opening tag
- For text changes, include surrounding JSX

EXAMPLE for changing button color from blue to black:
{
  "explanation": "Changed button color from blue to black",
  "patches": [
    {
      "file": "App.tsx",
      "operation": "replace",
      "search": "className=\"bg-blue-500 text-white",
      "replace": "className=\"bg-black text-white"
    }
  ]
}

OPERATIONS:
- "replace": Find search and replace with replace value
- "insert": Insert replace value after search string
- "delete": Remove the search string entirely`;

interface CodePatch {
    file: string;
    operation: 'replace' | 'insert' | 'delete';
    search: string;
    replace?: string;
}

interface EditorResponse {
    explanation: string;
    patches: CodePatch[];
}

interface RequestBody {
    prompt: string;
    currentCode: string;
    filename?: string;
}

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const { prompt, currentCode, filename = 'App.tsx' }: RequestBody = await req.json();

        // @ts-ignore: Deno namespace
        const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY');
        if (!GROQ_API_KEY) {
            throw new Error('GROQ_API_KEY not configured');
        }

        if (!currentCode) {
            throw new Error('No code provided to edit');
        }

        // Truncate code if too long to fit in context
        // Llama 3 has 128k context, but let's be safe with 30k chars
        const maxCodeLength = 30000;
        const truncatedCode = currentCode.length > maxCodeLength
            ? currentCode.substring(0, maxCodeLength) + '\n// ... (truncated)'
            : currentCode;

        const userMessage = `Current code in ${filename || 'file'}:
\`\`\`tsx
${truncatedCode}
\`\`\`

USER REQUEST: ${prompt}

Remember: Output ONLY valid JSON. Use EXACT search strings from the code above.`;

        console.log(`Edit request for ${filename}: ${prompt.substring(0, 100)}...`);

        // Using Llama 3.3 for best instruction following
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    { role: 'system', content: EDITOR_SYSTEM_PROMPT },
                    { role: 'user', content: userMessage },
                ],
                max_tokens: 4096,
                temperature: 0.1,
                response_format: { type: "json_object" } // Force JSON mode
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Groq API error:', errorText);
            throw new Error(`Groq API error: ${response.status}`);
        }

        const data = await response.json();
        let content = data.choices?.[0]?.message?.content;

        if (!content) {
            throw new Error('No content in AI response');
        }

        // Clean up response if needed (JSON mode usually handles it)
        content = content.trim();
        if (content.startsWith('```')) {
            content = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }

        // Parse the JSON response
        let editorResponse: EditorResponse;
        try {
            editorResponse = JSON.parse(content);
        } catch (parseError) {
            console.error('Failed to parse editor response:', content);
            throw new Error('Failed to parse editor response as JSON');
        }

        if (!editorResponse.patches || !Array.isArray(editorResponse.patches)) {
            // Sometimes it returns just the object if single patch? strict mode should prevent this
            // But let's check
            console.error('Invalid response structure:', editorResponse);
            throw new Error('Invalid response: missing patches array');
        }

        // Apply patches
        let updatedCode = currentCode;
        const appliedPatches: string[] = [];
        const errors: string[] = [];

        // Sort patches reverse order? No, usually they are independent or sequential.
        // Sequential application is standard.

        for (const patch of editorResponse.patches) {
            if (!patch.search) {
                errors.push('Patch missing search string');
                continue;
            }

            // Normalize whitespace for matching (basic)
            const normalizedSearch = patch.search.replace(/\r\n/g, '\n');
            const normalizedCode = updatedCode.replace(/\r\n/g, '\n');

            if (!normalizedCode.includes(normalizedSearch)) {
                // Fuzzy match attempt: try trimming
                const trimmedSearch = normalizedSearch.trim();
                if (normalizedCode.includes(trimmedSearch)) {
                    // Use trimmed
                    // But we need to be careful about replacing
                    // For now, fail safely or try best effort
                    errors.push(`Search string not found (exact match failed): "${patch.search.substring(0, 50)}..."`);
                    continue;
                }

                errors.push(`Search string not found: "${patch.search.substring(0, 50)}..."`);
                continue;
            }

            // Count occurrences
            const occurrences = normalizedCode.split(normalizedSearch).length - 1;
            if (occurrences > 1) {
                // Warning but proceed with first
                errors.push(`Multiple matches (${occurrences}) for: "${patch.search.substring(0, 40)}..." - applying first`);
            }

            switch (patch.operation) {
                case 'replace':
                    updatedCode = updatedCode.replace(patch.search, patch.replace || '');
                    appliedPatches.push(`Replaced: "${patch.search.substring(0, 30)}..."`);
                    break;
                case 'insert':
                    updatedCode = updatedCode.replace(patch.search, patch.search + (patch.replace || ''));
                    appliedPatches.push(`Inserted after: "${patch.search.substring(0, 30)}..."`);
                    break;
                case 'delete':
                    updatedCode = updatedCode.replace(patch.search, '');
                    appliedPatches.push(`Deleted: "${patch.search.substring(0, 30)}..."`);
                    break;
            }
        }

        console.log(`Applied ${appliedPatches.length} patches, ${errors.length} errors`);

        // If no patches applied and we have errors, it's a failure
        if (appliedPatches.length === 0 && errors.length > 0) {
            throw new Error(`Patch failed: ${errors.join('; ')}`);
        }

        // If no patches and NO errors (e.g. empty patches array), maybe AI thinks code is fine?
        if (appliedPatches.length === 0) {
            console.log("AI decided no changes needed");
        }

        return new Response(
            JSON.stringify({
                success: true,
                explanation: editorResponse.explanation,
                code: updatedCode,
                patches: editorResponse.patches,
                appliedPatches,
                errors,
            }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
        );
    } catch (error: unknown) {
        console.error('Error in edit-code:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return new Response(
            JSON.stringify({
                success: false,
                error: errorMessage,
            }),
            {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
        );
    }
});
