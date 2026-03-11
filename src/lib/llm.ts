import { SYSTEM_PROMPT, EDITOR_SYSTEM_PROMPT, ANALYZER_SYSTEM_PROMPT, CLEAR_PROJECT_TYPES, INTENT_ROUTER_PROMPT, CLONE_REPLICATION_PROTOCOL } from './prompts';
import { withDeterminism } from './determinism-constraints';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface CodePatch {
    file: string;
    operation: 'replace' | 'insert' | 'delete';
    search: string;
    replace?: string;
}

export interface EditorResponse {
    explanation: string;
    patches: CodePatch[];
}

import { createOpenAI } from '@ai-sdk/openai';

const getApiKey = () => {
    const key = process.env.NEXT_PUBLIC_GROQ_API_KEY || process.env.GROQ_API_KEY;
    if (!key) {
        throw new Error('VITE_GROQ_API_KEY is not configured in .env.local');
    }
    return key;
};

// Abstract getter for the Vercel AI SDK Model pointing to Groq's high-reasoning model
export const getModel = (): any => {
    const groq = createOpenAI({
        baseURL: 'https://api.groq.com/openai/v1',
        apiKey: getApiKey(),
    });
    
    // Using the 120b model or Llama 3 70b as the core logic engine
    return groq('llama3-70b-8192'); 
};

// ==========================================
// 1. App Generation (Streaming)
// ==========================================
export async function generateAppStream(prompt: string, isEdit: boolean = false): Promise<Response> {
    const apiKey = getApiKey();

    return fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'openai/gpt-oss-120b',
            messages: [
                { role: 'system', content: withDeterminism(isEdit ? EDITOR_SYSTEM_PROMPT : SYSTEM_PROMPT, isEdit ? 'editor' : 'full') },
                { role: 'user', content: `${isEdit ? 'Modify this application:' : 'Create this application:'} ${prompt}` }
            ],
            stream: true,
            temperature: 0.1,
            max_tokens: 16000,
        }),
    });
}

// ==========================================
// 2. Surgical Code Editing
// ==========================================
export async function editCodeLocal(
    prompt: string,
    currentCode: string,
    filename: string = 'App.tsx'
): Promise<{ success: boolean; code?: string; explanation?: string; appliedPatches?: string[]; error?: string; patches?: CodePatch[]; errors?: string[] }> {
    try {
        const apiKey = getApiKey();

        const maxCodeLength = 30000;
        // The newest general purpose open-model with 120b parameters and reasoning
        const DEFAULT_MODEL = 'openai/gpt-oss-120b';
        const truncatedCode = currentCode.length > maxCodeLength
            ? currentCode.substring(0, maxCodeLength) + '\\n// ... (truncated)'
            : currentCode;

        const userMessage = `Current code in ${filename || 'file'}:\\n\`\`\`tsx\\n${truncatedCode}\\n\`\`\`\\n\\nUSER REQUEST: ${prompt}\\n\\nRemember: Output ONLY valid JSON. Use EXACT search strings from the code above.`;

        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'openai/gpt-oss-120b', // Best available logic model on Groq
                messages: [
                    { role: 'system', content: withDeterminism(EDITOR_SYSTEM_PROMPT, 'editor') },
                    { role: 'user', content: userMessage },
                ],
                max_tokens: 4096,
                temperature: 0.1,
                response_format: { type: "json_object" }
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Groq API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        let content = data.choices?.[0]?.message?.content;

        if (!content) {
            throw new Error('No content in AI response');
        }

        content = content.trim();
        if (content.startsWith('\`\`\`')) {
            content = content.replace(/^\`\`\`(?:json)?\\n?/, '').replace(/\\n?\`\`\`$/, '');
        }

        let editorResponse: EditorResponse;
        try {
            editorResponse = JSON.parse(content);
        } catch (parseError) {
            throw new Error('Failed to parse editor response as JSON');
        }

        if (!editorResponse.patches || !Array.isArray(editorResponse.patches)) {
            throw new Error('Invalid response: missing patches array');
        }

        let updatedCode = currentCode;
        const appliedPatches: string[] = [];
        const errors: string[] = [];

        for (const patch of editorResponse.patches) {
            if (!patch.search) {
                errors.push('Patch missing search string');
                continue;
            }

            const normalizedSearch = patch.search.replace(/\\r\\n/g, '\\n');
            const normalizedCode = updatedCode.replace(/\\r\\n/g, '\\n');

            let searchToUse = normalizedSearch;

            if (!normalizedCode.includes(normalizedSearch)) {
                // Try trimming explicit newlines from the ends
                const trimmedSearch = normalizedSearch.replace(/^\s*\n|\n\s*$/g, '');
                if (normalizedCode.includes(trimmedSearch)) {
                    searchToUse = trimmedSearch;
                } else {
                    const fullyTrimmedSearch = normalizedSearch.trim();
                    if (normalizedCode.includes(fullyTrimmedSearch)) {
                        searchToUse = fullyTrimmedSearch;
                    } else {
                        errors.push(`Search string not found: "${patch.search.substring(0, 50)}..."`);
                        continue;
                    }
                }
            }

            switch (patch.operation) {
                case 'replace':
                    updatedCode = updatedCode.replace(searchToUse, patch.replace || '');
                    appliedPatches.push(`Replaced: "${searchToUse.substring(0, 30)}..."`);
                    break;
                case 'insert':
                    updatedCode = updatedCode.replace(searchToUse, searchToUse + (patch.replace || ''));
                    appliedPatches.push(`Inserted after: "${searchToUse.substring(0, 30)}..."`);
                    break;
                case 'delete':
                    updatedCode = updatedCode.replace(searchToUse, '');
                    appliedPatches.push(`Deleted: "${searchToUse.substring(0, 30)}..."`);
                    break;
            }
        }

        if (appliedPatches.length === 0 && errors.length > 0) {
            throw new Error(`Patch failed: ${errors.join('; ')}`);
        }

        return {
            success: true,
            explanation: editorResponse.explanation,
            code: updatedCode,
            patches: editorResponse.patches,
            appliedPatches,
            errors,
        };

    } catch (error: any) {
        console.error('Error in local edit-code:', error);
        return { success: false, error: error.message };
    }
}

// ==========================================
// 3. Prompt Analysis
// ==========================================
export async function analyzePromptLocal(prompt: string) {
    try {
        const promptLower = prompt.toLowerCase();
        const hasProjectType = CLEAR_PROJECT_TYPES.some(type => promptLower.includes(type));
        const hasAppKeyword = promptLower.includes('app') || promptLower.includes('application') ||
            promptLower.includes('website') || promptLower.includes('page');
        const wordCount = prompt.trim().split(/\\s+/).length;

        if ((hasProjectType && hasAppKeyword) || wordCount >= 8) {
            return {
                success: true,
                analysis: {
                    isVague: false,
                    missingInfo: [],
                    assumptions: ['Modern UI with Tailwind CSS', 'Local state management'],
                    confidence: 90,
                    explanation: 'Prompt is clear enough to proceed with generation'
                },
                questions: [],
                skipQuestions: true,
            };
        }

        const apiKey = getApiKey();
        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
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

        if (!response.ok) throw new Error('Groq API error during analysis');

        const data = await response.json();
        let analysis = { isVague: false, confidence: 80, explanation: '' };
        try {
            analysis = JSON.parse(data.choices?.[0]?.message?.content || '{}');
        } catch (e) { }

        return {
            success: true,
            analysis,
            questions: [],
            skipQuestions: true,
        };
    } catch (error) {
        console.error('Error in analyze-prompt:', error);
        return {
            success: true,
            analysis: { isVague: false, confidence: 80 },
            questions: [],
            skipQuestions: true,
        };
    }
}

// ==========================================
// 4. Intelligent UI/UX Planner (Roadmap 1)
// ==========================================
export const PLANNER_SYSTEM_PROMPT = `You are ORBIT ARCHITECT — a senior product designer and systems engineer with taste calibrated to Stripe, Linear, Vercel, and Craft.

Your job: transform a raw app idea into a precise, opinionated UI/UX + Engineering specification that a frontend engineer can execute without ambiguity.

## OUTPUT FORMAT
Respond ONLY in structured markdown. Max 900 words. No fluff, no filler.

---

## 1. DESIGN DIRECTION
Choose ONE deliberate aesthetic direction and commit to it completely. Do NOT default to generic SaaS.
Options: brutalist/raw · editorial/typographic · luxury/refined · retro-terminal · soft-organic · dense-utilitarian · glassmorphic · newspaper · neobrutalist · art-deco geometric

Specify:
- **Aesthetic archetype**: [one of the above, or name your own]
- **Color system**: primary bg hex, surface hex, 1-2 accent hexes, semantic colors (success/error/muted)
- **Typography**: 2 specific Google Font or system font pairings. Specify weights, tracking, line-heights for h1/h2/body/label
- **Spatial rhythm**: base spacing unit (e.g., 4px or 8px), padding scale for cards/sections/pages
- **Borders & radius**: e.g., "sharp 0px for brutalist" or "rounded-2xl for soft" — be decisive
- **Shadow & depth**: flat / subtle / layered / dramatic
- **Motion**: define 2-3 specific micro-interactions with easing curves and durations (e.g., "card hover: translateY(-2px) + shadow expand, 150ms ease-out")

## 2. LAYOUT ARCHITECTURE
- **Shell**: Describe the top-level layout (sidebar + main, top-nav + content, full-bleed, etc.)
- **Grid**: Specify exact column counts at mobile/tablet/desktop breakpoints
- **Key screens**: List 3-5 primary views with their layout pattern (e.g., "Dashboard: 3-col KPI row + 2-col chart/feed split")
- **Navigation**: Type (sidebar/topbar/bottom-tab/breadcrumb), active states, collapse behavior

## 3. DATA & STATE
- **Core entities**: Define TypeScript interfaces for 2-4 primary domain objects (e.g., User, Project, Transaction)
- **State topology**: What is global (auth, theme, notifications) vs local (form, modal, pagination)?
- **Data flow**: REST/GraphQL/realtime? Optimistic updates? Loading/skeleton strategy?
- **Key derived state**: What computations matter (totals, filters, sorted views)?

## 4. COMPONENT SPEC
List 6-10 components with:
- Name + variant count
- Props interface (key props only)
- Notable behavior/interaction
- Visual specification (size, color token, state variants)

Example format:
\`\`\`
StatusBadge
  variants: success | warning | error | neutral
  props: status, label?, pulse?: boolean
  visual: 6px dot + uppercase label, xs font-medium, color-coded bg at 15% opacity
  behavior: pulse animation when status === 'processing'
\`\`\`

## 5. DIFFERENTIATORS
- List 2-3 specific design decisions that make this app feel premium vs generic
- Call out 1 "signature moment" — the one interaction that will impress a user on first use

---

RULES:
- Never suggest Inter, Roboto, Arial, or system-ui as primary display fonts
- Never default to purple-on-white gradients or generic card shadows
- Every color must be a specific hex or Tailwind-exact class
- Assume the builder is using React + Tailwind + lucide-react
- Be opinionated. Indecision produces mediocre UIs.
- DO NOT force stock images unless strictly necessary (e.g., avatars). Rely on typography and grid layout.
`;

export async function analyzeAndPlanLocal(prompt: string): Promise<{ success: boolean; plan?: string; error?: string }> {
    try {
        const apiKey = getApiKey();
        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'openai/gpt-oss-120b',
                messages: [
                    { role: 'system', content: PLANNER_SYSTEM_PROMPT },
                    { role: 'user', content: `Draft a technical specification for this app request: "${prompt}"` },
                ],
                max_tokens: 1024,
                temperature: 0.2,
            }),
        });

        if (!response.ok) throw new Error('Groq API error during planning');

        const data = await response.json();
        const plan = data.choices?.[0]?.message?.content || '';

        return { success: true, plan };
    } catch (error) {
        console.error('Error in analyze-and-plan:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

// ==========================================
// 5. Intent Classification (Clone vs Creative)
// ==========================================
export interface IntentClassification {
    mode: 'CLONE' | 'CREATIVE';
    target: string | null;
    confidence: 'HIGH' | 'MEDIUM';
    reason: string;
}

export async function classifyIntent(prompt: string): Promise<IntentClassification> {
    try {
        const apiKey = getApiKey();
        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'openai/gpt-oss-120b',
                messages: [
                    { role: 'system', content: INTENT_ROUTER_PROMPT },
                    { role: 'user', content: prompt },
                ],
                max_tokens: 256,
                temperature: 0.0, // Deterministic classification
                response_format: { type: 'json_object' },
            }),
        });

        if (!response.ok) throw new Error('Intent classification failed');

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '{}';
        const parsed = JSON.parse(content);

        return {
            mode: parsed.mode === 'CLONE' ? 'CLONE' : 'CREATIVE',
            target: parsed.target || null,
            confidence: parsed.confidence === 'HIGH' ? 'HIGH' : 'MEDIUM',
            reason: parsed.reason || 'No reason provided',
        };
    } catch (error) {
        console.error('[Intent Router] Classification failed, defaulting to CREATIVE:', error);
        return { mode: 'CREATIVE', target: null, confidence: 'MEDIUM', reason: 'Fallback due to error' };
    }
}

// ==========================================
// 6. Route & Plan Pipeline (Clone or Creative)
// ==========================================
// Simple cooldown helper — non-blocking, does NOT wrap fetch
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function routeAndPlan(userPrompt: string): Promise<{ success: boolean; plan?: string; mode?: string; target?: string | null; error?: string }> {
    try {
        // Stage 0: Classify intent
        console.log('[routeAndPlan] Classifying intent...');
        const classification = await classifyIntent(userPrompt);
        console.log(`[routeAndPlan] Mode: ${classification.mode}, Target: ${classification.target}, Reason: ${classification.reason}`);

        const apiKey = getApiKey();

        if (classification.mode === 'CLONE' && classification.target) {
            // ─── CLONE PATH: Skip creative pipeline, go straight to forensic replication
            console.log(`[routeAndPlan] CLONE MODE — Target: ${classification.target}`);
            console.log('[routeAndPlan] Cooling down 12s before clone spec...');
            await sleep(12000); // Let TPM window reset before next call
            const response = await fetch(GROQ_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'openai/gpt-oss-120b',
                    messages: [
                        { role: 'system', content: CLONE_REPLICATION_PROTOCOL },
                        { role: 'user', content: `Clone target: ${classification.target}\nUser request: ${userPrompt}` },
                    ],
                    max_tokens: 2048,
                    temperature: 0.1,
                }),
            });

            if (!response.ok) throw new Error('Clone planning failed');
            const data = await response.json();
            const plan = data.choices?.[0]?.message?.content || '';

            return { success: true, plan, mode: 'CLONE', target: classification.target };
        }

        // ─── CREATIVE PATH: Full Visual Strategist → Architect pipeline
        console.log('[routeAndPlan] CREATIVE MODE — Running full visual pipeline...');

        // Step 1: Visual DNA extraction via ANALYZER_SYSTEM_PROMPT (Visual Strategist)
        console.log('[routeAndPlan] Cooling down 12s before Visual DNA extraction...');
        await sleep(12000); // Let TPM window reset
        const dnaResponse = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'openai/gpt-oss-120b',
                messages: [
                    { role: 'system', content: ANALYZER_SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt },
                ],
                max_tokens: 1024,
                temperature: 0.2,
            }),
        });

        if (!dnaResponse.ok) throw new Error('Visual DNA extraction failed');
        const dnaData = await dnaResponse.json();
        const visualDNA = dnaData.choices?.[0]?.message?.content || '';

        // Step 2: Feed Visual DNA into Architect (PLANNER_SYSTEM_PROMPT)
        console.log('[routeAndPlan] Cooling down 12s before Architecture spec...');
        await sleep(12000); // Let TPM window reset
        const specResponse = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'openai/gpt-oss-120b',
                messages: [
                    { role: 'system', content: PLANNER_SYSTEM_PROMPT },
                    { role: 'user', content: `Visual DNA analysis:\n${visualDNA}\n\nOriginal user request: "${userPrompt}"\n\nNow create the full UI/UX + Engineering specification.` },
                ],
                max_tokens: 2048,
                temperature: 0.2,
            }),
        });

        if (!specResponse.ok) throw new Error('Architecture planning failed');
        const specData = await specResponse.json();
        const plan = specData.choices?.[0]?.message?.content || '';

        return { success: true, plan, mode: 'CREATIVE', target: null };
    } catch (error) {
        console.error('[routeAndPlan] Pipeline error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

