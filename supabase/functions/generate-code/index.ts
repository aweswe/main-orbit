// supabase/functions/generate-code/index.ts
// @ts-ignore: Deno library
import "https://deno.land/x/xhr@0.1.0/mod.ts";
// @ts-ignore: Deno library
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are a Senior Full-Stack Engineer. Your task is to generate COMPLETE, VALID, PRODUCTION-READY code for a specific file.

============================================
CRITICAL LIBRARY CONSTRAINTS
============================================
You MUST ONLY use these supported libraries:

STYLING: Tailwind CSS ONLY
- Use utility classes: flex, grid, p-4, text-lg, bg-primary, etc.
- NO styled-components, Emotion, Sass, or CSS-in-JS

UI COMPONENTS: shadcn/ui patterns ONLY
- Use Radix primitives + Tailwind
- NO Material UI (@mui), Chakra UI, Ant Design, Bootstrap

ICONS: Lucide React ONLY
- import { IconName } from 'lucide-react'
- NO FontAwesome, Heroicons, React Icons

ANIMATION: Framer Motion + Tailwind Animate ONLY
- import { motion } from 'framer-motion'
- NO GSAP, React Spring, Anime.js

STATE: React useState, Zustand, TanStack Query
- NO Redux, MobX, Recoil

CHARTS: Recharts ONLY
- NO Chart.js, D3, Nivo, Victory

If the design plan includes component styles, USE THEM EXACTLY.
============================================

CRITICAL RULES:
1. Generate ONLY the code for the requested file
2. Use provided shared types and context files for consistency
3. Use Tailwind CSS for ALL styling - apply provided componentStyles if available
4. Use functional components with TypeScript
5. Follow React best practices and hooks patterns
6. Ensure ALL brackets, braces, and parentheses are CLOSED
7. Code must be COMPLETE - no truncation or "// rest of code" comments
8. Apply premium design: rounded corners, shadows, hover effects, transitions

IMPORT RULES:
- Shared types: import { Type } from '@/shared/types'
- Components: import { Component } from '@/components/...'
- Hooks: import { useHook } from '@/hooks/...'
- Utils: import { util } from '@/utils/...'

OUTPUT FORMAT (STRICT):
Return ONLY the code wrapped in a TypeScript code block:

\`\`\`typescript
// Your complete code here
\`\`\`

NO explanations, NO markdown outside the code block, NO incomplete code.`;

// Blocked imports that should trigger re-prompting
const BLOCKED_IMPORTS = [
  '@mui/', '@material-ui/', '@chakra-ui/', 'antd', 'ant-design',
  'styled-components', '@emotion/', 'sass', 'less',
  'react-icons', '@fortawesome', '@heroicons/',
  'gsap', 'react-spring', 'animejs', 'anime.js',
  'redux', 'mobx', 'recoil',
  'chart.js', 'react-chartjs', 'd3', '@nivo/', 'victory'
];

function detectBlockedImports(code: string): string[] {
  const found: string[] = [];
  for (const blocked of BLOCKED_IMPORTS) {
    if (code.includes(`from '${blocked}`) || code.includes(`from "${blocked}`)) {
      found.push(blocked);
    }
  }
  return found;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

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

    // Build context for the AI
    const contextFilesText = contextFiles
      .map((f: any) => `=== FILE: ${f.path} ===\n${f.content}\n`)
      .join('\n');

    let userPrompt = `
ORIGINAL USER REQUEST: ${prompt}

PROJECT CONTEXT: ${JSON.stringify(sharedProject, null, 2)}

FILE TO GENERATE:
- Path: ${filePlan.path}
- Type: ${filePlan.type}
- Purpose: ${filePlan.purpose}
- Dependencies: ${filePlan.dependencies.join(', ')}
- Must Export: ${filePlan.exports.join(', ')}

EXISTING PROJECT FILES:
${contextFilesText}

Generate COMPLETE, VALID code for ${filePlan.path}.
Ensure ALL brackets are closed and code is production-ready.
`;

    // Add previous error context if retrying
    if (previousError) {
      userPrompt += `\n\nPREVIOUS ATTEMPT HAD ERRORS:\n${previousError.errors.map((e: any) => `- ${e.message}`).join('\n')}\n\nPlease fix these issues.`;
    }

    let attempt = 0;
    let code = null;
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
          model: 'openai/gpt-oss-120b', // Your verified working model
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.1, // Low temperature for consistency
          max_tokens: 8000, // ✅ INCREASED: Prevent truncation (Groq max is 8192)
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Groq API error (${response.status}):`, errorText);
        throw new Error(`Groq API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;

      // Extract code from markdown block
      const codeMatch = content.match(/```(?:tsx?|jsx?|javascript|typescript)?\n([\s\S]*?)```/);
      const extractedCode = codeMatch ? codeMatch[1].trim() : null;

      if (!extractedCode) {
        lastError = "AI did not return code in proper format";
        console.error('Invalid AI response:', content.substring(0, 200));
        continue;
      }

      // ✅ Check for blocked imports
      const blockedFound = detectBlockedImports(extractedCode);
      if (blockedFound.length > 0) {
        lastError = `Used blocked libraries: ${blockedFound.join(', ')}`;
        console.error(`Blocked imports detected:`, blockedFound);

        if (attempt === 1) {
          userPrompt += `\n\nPREVIOUS ATTEMPT USED BLOCKED LIBRARIES: ${blockedFound.join(', ')}\nYou MUST use supported alternatives:\n- Instead of @mui: Use Tailwind CSS classes\n- Instead of styled-components: Use Tailwind CSS\n- Instead of react-icons: Use lucide-react\n- Instead of gsap/react-spring: Use framer-motion\nPlease regenerate with ONLY supported libraries.`;
          continue;
        }
      }

      // ✅ Validate code completeness
      const validation = validateCode(extractedCode, filePlan);

      if (!validation.isValid) {
        lastError = validation.errors.join(', ');
        console.error(`Generated code failed validation:`, validation.errors);

        // If this is attempt 1, try again with stricter prompt
        if (attempt === 1) {
          userPrompt += `\n\nPREVIOUS ATTEMPT HAD ERRORS: ${validation.errors.join(', ')}\nPlease fix these issues.`;
          continue;
        }
      }

      code = extractedCode;
    }

    if (!code) {
      throw new Error(`Failed to generate valid code after ${attempt} attempts. Last error: ${lastError}`);
    }

    // Log success
    console.log(`✅ Successfully generated ${filePlan.path} (${code.split('\n').length} lines)`);

    return new Response(
      JSON.stringify({
        success: true,
        code,
        linesOfCode: code.split('\n').length,
        attempts: attempt
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: any) {
    console.error('Error in generate-code:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

// ✅ NEW: Code validation function
function validateCode(code: string, filePlan: any): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check 1: Code is not empty
  if (!code || code.trim().length === 0) {
    errors.push('Generated code is empty');
  }

  // Check 2: Has expected exports
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

  // Check 3: Brackets are balanced
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

  // Check 4: Code doesn't end with incomplete comment
  if (code.trim().endsWith('//') || code.trim().endsWith('/*')) {
    errors.push('Code ends with incomplete comment');
  }

  // Check 5: No "..." or "// rest of code" placeholders
  if (code.includes('...') && code.includes('rest of')) {
    errors.push('Code contains incomplete placeholder comments');
  }

  // Check 6: For React components, ensure return statement exists
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
