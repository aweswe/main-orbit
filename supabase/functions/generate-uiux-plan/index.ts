// @ts-ignore: Deno library
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
// @ts-ignore: Deno library
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// @ts-ignore: Deno namespace
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY');

interface GenerateUIUXPlanRequest {
    requirements: any;
    originalPrompt: string;
    projectId: string;
}

const UIUX_PLAN_PROMPT = `You are a UI/UX designer. Create a detailed UI/UX plan based on user requirements.

ORIGINAL USER REQUEST: "{originalPrompt}"

USER REQUIREMENTS:
{requirements}

Create a comprehensive UI/UX plan that includes layout structure, component breakdown, color scheme, and interactions.

Return ONLY valid JSON (no markdown, no explanation):
{
  "appType": "dashboard|form|landing|admin|ecommerce|social|etc",
  "layout": {
    "structure": "sidebar|topnav|split|fullwidth",
    "sections": [
      { "name": "header", "purpose": "..." },
      { "name": "main", "purpose": "..." },
      { "name": "footer", "purpose": "..." }
    ]
  },
  "components": [
    {
      "name": "ComponentName",
      "purpose": "What it does",
      "dataNeeded": "What data it displays/manages",
      "placement": "Where it appears in the layout"
    }
  ],
  "colorScheme": {
    "primary": "#hex",
    "secondary": "#hex",
    "style": "modern|minimal|vibrant|professional"
  },
  "interactions": [
    { "action": "user action", "result": "what happens" }
  ]
}

GUIDELINES:
1. **Layout Structure**:
   - sidebar: For apps with navigation and multiple sections
   - topnav: For simple apps with few pages
   - split: For apps with two distinct areas (e.g., email client)
   - fullwidth: For single-page, focused apps

2. **Component Design**:
   - Create reusable UI components (Button, Card, Input, etc.)
   - Create feature-specific components (Dashboard, UserProfile, etc.)
   - Keep components focused and single-purpose

3. **Color Scheme**:
   - Modern: Blues, grays, clean
   - Minimal: Blacks, whites, one accent
   - Vibrant: Multiple bright colors
   - Professional: Navy, grays, subtle accents

4. **Data Flow**:
   - Clearly specify what data each component needs
   - Consider where data comes from (API, user input, state)

EXAMPLE 1 (Dashboard):
{
  "appType": "dashboard",
  "layout": {
    "structure": "sidebar",
    "sections": [
      { "name": "sidebar", "purpose": "Navigation and filters" },
      { "name": "header", "purpose": "Page title and user menu" },
      { "name": "stats", "purpose": "Key metrics overview" },
      { "name": "charts", "purpose": "Detailed visualizations" }
    ]
  },
  "components": [
    {
      "name": "StatCard",
      "purpose": "Display single metric with trend",
      "dataNeeded": "value, label, percentage change, icon",
      "placement": "stats section, 4-column grid"
    },
    {
      "name": "LineChart",
      "purpose": "Show data over time",
      "dataNeeded": "time series array with date/value pairs",
      "placement": "charts section, full width"
    }
  ],
  "colorScheme": {
    "primary": "#2563eb",
    "secondary": "#64748b",
    "style": "professional"
  },
  "interactions": [
    { "action": "click stat card", "result": "filter chart to show that metric's details" },
    { "action": "change date range", "result": "update all charts and metrics" }
  ]
}

Now create the UI/UX plan:`;

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
            },
        });
    }

    try {
        const { requirements, originalPrompt, projectId }: GenerateUIUXPlanRequest =
            await req.json();

        const startTime = Date.now();

        // Build prompt
        const prompt = UIUX_PLAN_PROMPT.replace('{originalPrompt}', originalPrompt).replace(
            '{requirements}',
            JSON.stringify(requirements, null, 2)
        );

        // Call Groq API (using the model specified by user)
        const response = await fetch(`https://api.groq.com/openai/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${GROQ_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'openai/gpt-oss-120b',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a UI/UX designer. Return only valid JSON, no markdown.',
                    },
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                temperature: 0.5,
                max_tokens: 2000,
                response_format: { type: "json_object" }
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Groq API error:', errorText);
            throw new Error(`Groq API error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;

        // Parse JSON response
        let uiuxPlan;
        try {
            uiuxPlan = JSON.parse(content);
        } catch (e) {
            console.error('Failed to parse UI/UX plan:', content);
            throw new Error('Invalid JSON response from AI');
        }

        // Log to database (optional, depends on if the tables exist yet)
        // For now we just return the result
        /*
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_ANON_KEY') ?? ''
        );
    
        await supabase.from('generation_logs').insert({
          project_id: projectId,
          phase: 'plan',
          status: 'completed',
          data: { uiuxPlan },
          duration_ms: Date.now() - startTime,
        });
        */

        return new Response(JSON.stringify({ uiuxPlan }), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });
    } catch (error: any) {
        console.error('Error in generate-uiux-plan:', error);

        return new Response(
            JSON.stringify({ error: error.message }),
            {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
            }
        );
    }
});
