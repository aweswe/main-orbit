import "https://deno.land/x/xhr@0.1.0/mod.ts";
// @ts-ignore: Deno library
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are a Principal Software Architect. Your job is to design a complete, full-stack application structure.
You have access to a "WebContainer" environment, which is a full Node.js runtime in the browser.

CAPABILITIES:
1.  **Full Stack**: You can build Backend servers (Express, Hono, Node.js), Scripts, and Frontend (React/Vite).
2.  **NPM Packages**: You can use ANY npm package.
3.  **Terminal Access**: The user can run commands.

CRITICAL RULES:
1.  **Structure**: Plan a highly modular structure. Separating concerns is vital.
2.  **Backend**: If the user needs a backend, create a \`server/\` directory with \`index.ts\` (using Express or Hono is recommended).
3.  **Dependencies**: You MUST list all necessary NPM packages in a \`dependencies\` array in the JSON.
4.  **Types**: Always create a \`shared/types.ts\` for common interfaces.
5.  **Entrypoint**: For the frontend, \`src/App.tsx\` is the root.

**MANDATORY SCAFFOLDING FILES** (MUST always be included at highest priority):
Your file plan MUST ALWAYS include these files FIRST, in this exact order:
1. \`package.json\` (priority: 1) - REQUIRED. Must include "scripts": {"dev": "vite"} and all dependencies.
2. \`index.html\` (priority: 2) - REQUIRED. HTML entry point with \`<div id="root">\` and \`<script type="module" src="/src/main.tsx">\`.
3. \`vite.config.ts\` (priority: 3) - REQUIRED. Vite configuration with React plugin and @ alias.
4. \`src/main.tsx\` (priority: 4) - REQUIRED. React entry point that renders App to #root.
5. \`tailwind.config.js\` (priority: 5) - Include if using Tailwind CSS.
6. \`postcss.config.js\` (priority: 6) - Include if using Tailwind CSS.

FAILURE TO INCLUDE package.json, index.html, vite.config.ts, and src/main.tsx WILL BREAK THE APPLICATION.

JSON SCHEMA:
Return EXACTLY this JSON format:
{
  "thought": "Brief architectural reasoning on why you chose this stack/structure...",
  "sharedProject": {
    "name": "Project Name",
    "description": "Description",
    "theme": { ... },
    "techStack": {
      "framework": "React (Vite)",
      "backend": "Node.js (Optional)",
      "db": "Supabase or In-Memory (Optional)"
    }
  },
  "dependencies": ["react", "react-dom", "@vitejs/plugin-react", "vite", "tailwindcss", "lucide-react"],
  "files": [
    {
      "path": "package.json",
      "type": "config",
      "purpose": "NPM package configuration with dependencies and scripts",
      "priority": 1
    },
    {
      "path": "index.html",
      "type": "html",
      "purpose": "HTML entry point",
      "priority": 2
    },
    {
      "path": "vite.config.ts",
      "type": "config",
      "purpose": "Vite bundler configuration",
      "priority": 3
    },
    {
      "path": "src/main.tsx",
      "type": "entry",
      "purpose": "React application entry point",
      "priority": 4
    },
    {
      "path": "src/App.tsx",
      "type": "component",
      "purpose": "Root frontend component",
      "priority": 10
    }
  ]
}`;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, requirements } = await req.json();

    console.log('[plan-project] Starting project planning...');
    console.log('[plan-project] Prompt:', prompt?.substring(0, 100) + '...');

    // @ts-ignore: Deno namespace
    const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY');

    if (!GROQ_API_KEY) {
      console.error('[plan-project] GROQ_API_KEY not configured');
      throw new Error('GROQ_API_KEY not configured');
    }

    const userContext = `
      USER PROMPT: ${prompt}
      CLARIFIED REQUIREMENTS: ${JSON.stringify(requirements, null, 2)}
    `;

    console.log('[plan-project] Calling Groq API...');

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
          { role: 'user', content: userContext }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[plan-project] Groq API error:', response.status, errorText);
      throw new Error(`Groq API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('[plan-project] Groq response received');

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.error('[plan-project] No content in response:', data);
      throw new Error('No content in AI response');
    }

    const plan = JSON.parse(content);

    console.log('[plan-project] Success! Files planned:', plan.files?.map((f: any) => f.path));

    return new Response(JSON.stringify({ success: true, plan }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[plan-project] Error:', error.message);
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
