/**
 * generate-app Edge Function
 * 
 * TWO-STEP GENERATION PIPELINE:
 * 1. Architect (Qwen): Planning & Normalization
 * 2. Builder (GPT-120B): Code Generation (Strict Artifact Format)
 */

import "https://deno.land/x/xhr@0.1.0/mod.ts";
// @ts-ignore: Deno library
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- STEP 1: ARCHITECT (QWEN) ---

const REASONING_PROMPT = `You are a Senior Software Architect.
Target Environment: WebContainer (In-browser Node.js)
Target Stack: Vite + React (TypeScript + Tailwind)

YOUR TASK:
Analyze the user request and normalize it to our system constraints.

CONSTRAINTS:
1. FRAMEWORK: ONLY Vite + React. Convert Next.js, Remix, Gatsby, etc. to Vite.
2. LIBRARIES:
   - UI: shadcn/ui + Tailwind
   - Icons: Lucide React
   - Animation: Framer Motion
   - State: Zustand
3. FALLBACK RULE: If a requested library is NOT in our supported list (e.g., react-slick, d3), DO NOT use it. Instead, instruct the coding model to implementation the functionality manually using PURE TYPESCRIPT/REACT.

OUTPUT FORMAT:
Provide a concise architectural analysis within <analysis> tags. Mention if you are converting from another framework.`;

async function getReasoningPlan(prompt: string, apiKey: string) {
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen/qwen3-32b',
        messages: [
          { role: 'system', content: REASONING_PROMPT },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      return { error: `[Architect Delay] API Error ${response.status}` };
    }

    const data = await response.json();
    return { content: data.choices?.[0]?.message?.content || null };
  } catch (error: any) {
    return { error: `[Architect Delay] Network Error: ${error.message}` };
  }
}

// --- STEP 2: BUILDER (GPT-120B) ---

const SYSTEM_PROMPT = `You are Orbit, an expert AI assistant and exceptional senior software developer.
You create complete, production-ready web applications.

<webcontainer_constraints>
You are operating in WebContainer - an in-browser Node.js runtime.

AVAILABLE:
- Node.js 18+ with full API
- npm/pnpm/yarn (any package manager)
- Vite, Express, Hono, Fastify (any npm package)
- WebAssembly, libsql, better-sqlite3-wasm
- Supabase client for remote DB

MANDATORY LIBRARIES (Always include in package.json):
- lucide-react (Icons)
- zustand (State Management)
- framer-motion (Animations)
- clsx, tailwind-merge (Styling Utils)
- uuid, date-fns (Utilities)

ALWAYS use Vite for frontend projects.
</webcontainer_constraints>

<output_format>
Wrap your ENTIRE response in <orbitArtifact> tags containing <orbitAction> elements.

Action Types:
1. type="file" path="path/to/file" - Creates/overwrites a file
2. type="shell" - Runs a shell command

CRITICAL ORDER (LEVEL 0):
1. package.json FIRST (with ALL dependencies listed)
2. npm install (ONCE, after package.json)
3. index.html (MANDATORY entry point for Vite - MUST be in the root)
4. Config files (vite.config.ts, tailwind.config.js, etc.)
5. Source files (src/main.tsx, src/App.tsx, components, etc.)
6. npm run dev LAST (starts the server)

RULES:
- MANDATORY: You MUST generate a root index.html file. If missing, the app will 404.
- TSCONFIG MANDATORY: You MUST generate a tsconfig.json in the root with {"compilerOptions": {"jsx": "react-jsx"}}. This is critical for React 18+.
- DATA-FIRST RENDERING: Ensure the initial state/data (at least 6 items) is rendered SYNCHRONOUSLY. Do not wait for scroll events or complex hooks for the initial view.
- COMPONENT INTEGRATION: Every file you generate in the components folder MUST be imported and used in a Page or the main App.tsx. No "dead" files.
- STYLING: Use Tailwind CSS ONLY. Ensure the index.html includes the link to the main css file.
- CSS IMPORTS: All @import statements (e.g., for Google Fonts) MUST be at the very top of the .css file, before any other rules or comments.
- NO CSS CIRCULARITY: DO NOT @apply a class to itself (e.g., .font-heading { @apply font-heading; } is FORBIDDEN).
- IMPORT ALIASES: ALWAYS use the "@/ " alias for all internal imports (e.g., "@/utils/cn", "@/components/Button"). NEVER use deep relative paths like "../../../utils/cn".
- Put ALL dependencies in package.json before npm install
- File content must be COMPLETE - no placeholders or "// rest of code..."
- Use 2 spaces for indentation
- Use TypeScript and Tailwind CSS
- Include "type": "module" in package.json
- Use ES Module syntax (export default) for ALL config files.
</output_format>

<code_quality>
- Use functional React components with hooks
- Implement proper TypeScript types
- Use Tailwind CSS for all styling (no inline styles)
- Create modular, reusable components
- Handle loading and error states
- Add proper accessibility attributes
</code_quality>

EXAMPLE OUTPUT:
<orbitArtifact id="counter-app" title="Counter Application">
  <orbitAction type="file" path="package.json">
{
  "name": "counter-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0"
  }
}
  </orbitAction>

  <orbitAction type="shell">npm install</orbitAction>

  <orbitAction type="file" path="src/App.tsx">
import { useState } from 'react';

export default function App() {
  const [count, setCount] = useState(0);
  
  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-center text-white">
        <h1 className="text-4xl font-bold mb-8">{count}</h1>
      </div>
    </div>
  );
}
  </orbitAction>

  <orbitAction type="shell">npm run dev</orbitAction>
</orbitArtifact>

DO NOT include any text outside the orbitArtifact tags.
DO NOT use markdown code blocks.
Generate COMPLETE, WORKING code.`;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt, stream = true, uiuxPlan } = await req.json();

    // @ts-ignore: Deno namespace
    const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY');
    if (!GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY not configured');
    }

    console.log('[generate-app] Starting Two-Step Generation...');

    // STEP 1: REASONING (Architect)
    const reasoningResult = await getReasoningPlan(prompt, GROQ_API_KEY);
    const reasoningAnalysis = reasoningResult.content || reasoningResult.error || 'Follow standard Vite layout.';

    console.log('[generate-app] Architect Analysis ready.');

    // STEP 2: CODING (Builder)
    let userMessage = `
<analysis>
${reasoningAnalysis}
</analysis>

Create this application: ${prompt}
`;

    if (uiuxPlan) {
      userMessage = `<design_context>${JSON.stringify(uiuxPlan.designSystem)}</design_context>` + userMessage;
    }

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
          { role: 'user', content: userMessage }
        ],
        stream: stream,
        temperature: 0.1,
        max_tokens: 16000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${errorText}`);
    }

    if (stream) {
      console.log('[generate-app] Streaming response...');
      return new Response(response.body, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } else {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) throw new Error('No content in AI response');

      return new Response(JSON.stringify({
        success: true,
        content,
        analysis: reasoningAnalysis
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

  } catch (error: any) {
    console.error('[generate-app] Error:', error.message);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
