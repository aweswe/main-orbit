import "https://deno.land/x/xhr@0.1.0/mod.ts";
// @ts-ignore: Deno library
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// List of clear project types that don't need clarification
const CLEAR_PROJECT_TYPES = [
    'todo', 'to-do', 'task', 'note', 'notes', 'calculator', 'counter',
    'timer', 'clock', 'weather', 'blog', 'portfolio', 'landing',
    'form', 'login', 'signup', 'dashboard', 'chat', 'quiz', 'game'
];

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const { prompt }: { prompt: string } = await req.json();

        console.log(`[analyze-prompt] Analyzing: "${prompt}"`);

        // ✅ FAST PATH: Skip AI call for clear prompts
        const promptLower = prompt.toLowerCase();
        const hasProjectType = CLEAR_PROJECT_TYPES.some(type => promptLower.includes(type));
        const hasAppKeyword = promptLower.includes('app') || promptLower.includes('application') ||
            promptLower.includes('website') || promptLower.includes('page');
        const wordCount = prompt.trim().split(/\s+/).length;

        // If prompt is clear (has project type + app keyword, or is detailed enough)
        if ((hasProjectType && hasAppKeyword) || wordCount >= 8) {
            console.log(`[analyze-prompt] Clear prompt detected, skipping questions`);
            return new Response(
                JSON.stringify({
                    success: true,
                    analysis: {
                        isVague: false,
                        missingInfo: [],
                        assumptions: ['Modern UI with Tailwind CSS', 'Local state management'],
                        confidence: 90,
                        explanation: 'Prompt is clear enough to proceed with generation'
                    },
                    questions: [],
                    skipQuestions: true,  // ✅ KEY: Skip the questionnaire
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // For vague prompts, use AI analysis
        // @ts-ignore: Deno namespace
        const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY');
        if (!GROQ_API_KEY) {
            console.error('[analyze-prompt] GROQ_API_KEY not configured');
            // Return skip anyway to avoid blocking
            return new Response(
                JSON.stringify({
                    success: true,
                    analysis: { isVague: false, confidence: 80 },
                    questions: [],
                    skipQuestions: true,
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const ANALYZER_SYSTEM_PROMPT = `You are a requirements analyst. Analyze this user prompt for a web application.

IMPORTANT: Only return questions if the prompt is TRULY vague (e.g., just "app" or "website" with no purpose).
For prompts like "todo app", "weather app", "calculator" - these are CLEAR and need NO questions.

OUTPUT FORMAT (pure JSON):
{
  "isVague": boolean,
  "confidence": number (0-100),
  "explanation": "Brief explanation"
}

If confidence >= 70, the prompt is clear enough. Do NOT ask questions for common app types.`;

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'openai/gpt-oss-120b',
                messages: [
                    { role: 'system', content: ANALYZER_SYSTEM_PROMPT },
                    { role: 'user', content: `Analyze: "${prompt}"` },
                ],
                max_tokens: 512,
                temperature: 0.1,
                response_format: { type: "json_object" }
            }),
        });

        if (!response.ok) {
            console.error('[analyze-prompt] Groq API error, skipping questions');
            return new Response(
                JSON.stringify({
                    success: true,
                    analysis: { isVague: false, confidence: 80 },
                    questions: [],
                    skipQuestions: true,
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        let analysis = { isVague: false, confidence: 80, explanation: '' };
        try {
            analysis = JSON.parse(content);
        } catch (e) {
            console.error('[analyze-prompt] Failed to parse AI response');
        }

        // ✅ ALWAYS skip questions - let generation proceed
        const skipQuestions = true;  // Changed: Always skip

        console.log(`[analyze-prompt] Result: confidence=${analysis.confidence}, skipQuestions=${skipQuestions}`);

        return new Response(
            JSON.stringify({
                success: true,
                analysis,
                questions: [],  // No questions
                skipQuestions,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    } catch (error: unknown) {
        console.error('[analyze-prompt] Error:', error);
        // On error, just proceed with generation
        return new Response(
            JSON.stringify({
                success: true,
                analysis: { isVague: false, confidence: 80 },
                questions: [],
                skipQuestions: true,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
