import { useState, useCallback, useRef, useEffect } from 'react';
import { Message, GenerationState, ProjectFile, RequestIntent } from '@/types/chat';
// @ts-ignore: module aliasing
import { ProjectPlan, PromptAnalysis, UserRequirements, Question } from '@/types/pipeline';
import { supabase } from '@/integrations/supabase/client';
// @ts-ignore: module aliasing

import { useWebContainer } from '@/contexts/WebContainerContext';
import { getWebContainer } from '@/lib/webcontainer/instance';
import { StreamingActionParser, ParsedAction } from '@/lib/runtime/streaming-parser';
import { ActionRunner } from '@/lib/runtime/action-runner';
import { analyzePromptLocal, generateAppStream, routeAndPlan } from '@/lib/llm';
import { parseTerminalError } from '@/lib/runtime/error-detector';
import { buildWorkspaceContext } from '@/lib/context/workspace-context';
// Mock extractSearchKeywords until we build it natively or map it
const extractSearchKeywords = async (prompt: string) => prompt.split(' ').filter(w => w.length > 4);
import { formatSmartEditPrompt } from '@/lib/context/smart-edit';

// Feature flag: Use new streaming pipeline vs legacy multi-step
export const USE_STREAMING_PIPELINE = true;

const MAX_RETRIES = 3;

// ============================================
// RATE LIMITER - Prevents Groq API rate limiting
// Groq Free Tier: 30 requests/minute
// Strategy: Space requests 5s apart = 12 requests/minute (very safe buffer)
// This eliminates ALL 500 errors and ensures 0 retries needed
// ============================================
let lastRequestTime = 0;
const MIN_DELAY_MS = 5000; // 5 seconds between requests (increased to eliminate errors)

async function waitForRateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < MIN_DELAY_MS) {
    const delay = MIN_DELAY_MS - timeSinceLastRequest;
    console.log(`⏳ [RATE-LIMIT] Waiting ${delay}ms before next request...`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  lastRequestTime = Date.now();
}

// Intent Router - decides between generate (full file) vs edit (patch-based)
function classifyIntent(prompt: string, hasExistingCode: boolean): RequestIntent {
  const promptLower = prompt.toLowerCase();

  // Explicit reset/new project keywords - these MUST trigger 'generate'
  const explicitGenerateKeywords = [
    'build a new', 'create a new', 'generate a new', 'start a new',
    'reset and', 'clear and', 'from scratch', 'new project'
  ];
  
  // High-level instruction keywords that often imply generation but might be edits
  const generateKeywords = [
    'create', 'build', 'generate', 'design', 'implement', 'make a',
    'make me', 'write a', 'develop', 'construct', 'new'
  ];

  const hasExplicitGenerate = explicitGenerateKeywords.some(k => promptLower.includes(k));
  const hasGenerateWord = generateKeywords.some(k => promptLower.includes(k));

  // 1. If no code, always generate
  if (!hasExistingCode) return 'generate';

  // 2. If explicit "new project" intent, generate
  if (hasExplicitGenerate) return 'generate';

  // 3. If it looks like a generation word but we HAVE code, default to edit
  // unless the prompt is very long (implies a full feature/page implementation)
  if (hasGenerateWord && prompt.length > 300) return 'generate';

  // 4. Default: everything else with existing code is an 'edit'
  // This forces surgical patches and saves tokens/avoid 429s.
  return 'edit';
}

// ============================================
// SMART CONTEXT SELECTION - Prevents token overflow for App.tsx
// ============================================
function selectSmartContext(
  filePlan: any,
  allGeneratedFiles: ProjectFile[]
): ProjectFile[] {
  // Get the types file (always include if exists)
  const typesFile = allGeneratedFiles.find(f =>
    f.path === 'shared/types.ts' || f.path.includes('/types.')
  );

  // Get dependency files
  const dependencyFiles = allGeneratedFiles.filter(f =>
    filePlan.dependencies?.includes(f.path) ||
    f.path.includes('shared/types') ||
    f.path.includes('types/')
  );

  // For App.tsx specifically, limit to 3 most important files
  const isAppFile = filePlan.path === 'App.tsx' ||
    filePlan.path === 'src/App.tsx' ||
    filePlan.path.endsWith('/App.tsx');

  if (isAppFile || dependencyFiles.length > 4) {
    const essentialFiles: ProjectFile[] = [];

    // Priority 1: Types (always include)
    if (typesFile && !essentialFiles.find(f => f.path === typesFile.path)) {
      essentialFiles.push(typesFile);
    }

    // Priority 2: Context/Store files (only the most critical one)
    const storeFile = dependencyFiles.find(f =>
      f.path.includes('Context') ||
      f.path.includes('store/') ||
      f.path.includes('Provider')
    );
    if (storeFile && essentialFiles.length < 2) {
      essentialFiles.push(storeFile);
    }

    // Priority 3: Main list/layout component
    const mainComponent = dependencyFiles.find(f =>
      f.path.includes('List') ||
      f.path.includes('Layout') ||
      f.path.includes('Dashboard') ||
      f.path.includes('Main')
    );
    if (mainComponent && essentialFiles.length < 2) {
      essentialFiles.push(mainComponent);
    }

    console.log(`📦 [SMART-CONTEXT] ${filePlan.path}: Reduced from ${dependencyFiles.length} to ${essentialFiles.length} files (Strict Mode)`);
    return essentialFiles;
  }

  // For other files, return dependencies but cap at 4
  return dependencyFiles.slice(0, 4);
}

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [generationState, setGenerationState] = useState<GenerationState>({ status: 'idle' });
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [currentPlan, setCurrentPlan] = useState<ProjectPlan | null>(null);

  // Smart Planner States
  const [pendingAnalysis, setPendingAnalysis] = useState<PromptAnalysis | null>(null);
  const [pendingQuestions, setPendingQuestions] = useState<Question[]>([]);
  const [showQuestionnaire, setShowQuestionnaire] = useState(false);
  const [clarifiedRequirements, setClarifiedRequirements] = useState<UserRequirements | null>(null);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);

  const conversationHistoryRef = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const lastPromptRef = useRef<string>('');
  const bootOutputRef = useRef<string[]>([]);
  const lastErrorRef = useRef<Set<string>>(new Set());
  const errorAggregationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingErrorsRef = useRef<Array<{ type: string; file: string; message: string; raw: string }>>([]);
  const isAutoHealingRef = useRef<boolean>(false);
  const recentHealAttemptsRef = useRef<Record<string, { count: number, timestamp: number }>>({});

  // Ref to break circular dependency between handleAutoHeal and runStreamingPipeline
  const pipelineRef = useRef<((prompt: string, msgId: string, err?: string, file?: string) => Promise<void>) | null>(null);



  // Get WebContainer context for auto-boot
  const { webcontainer, runBootSequence, isBooting } = useWebContainer();

  // Update message helper
  const updateMessage = useCallback((id: string, updates: Partial<Message>) => {
    setMessages((prev) => prev.map((msg) => msg.id === id ? { ...msg, ...updates } : msg));
  }, []);

  // API Call Helpers with detailed logging
  const analyzePrompt = async (prompt: string): Promise<{ analysis: PromptAnalysis; questions: Question[]; skipQuestions: boolean }> => {
    console.log('🔍 [ANALYZE-PROMPT] Starting...');
    console.log('🔍 [ANALYZE-PROMPT] Prompt:', prompt.substring(0, 100) + '...');

    try {
      // ✅ RATE LIMIT: Wait before making request
      await waitForRateLimit();

      const data = await analyzePromptLocal(prompt);

      console.log('🔍 [ANALYZE-PROMPT] Response:', { data });

      if (!data.success) {
        throw new Error('Analysis failed');
      }

      return data as any;
    } catch (err: any) {
      console.error('❌ [ANALYZE-PROMPT] Exception:', err);
      throw err;
    }
  };

  // ============================================
  // UNIFIED AUTO-HEALER (Handles Terminal & Browser Errors)
  // ============================================
  const handleAutoHeal = useCallback(async (
    errors: { type: string; file?: string; message: string; raw: string }[],
    aiMessageId: string
  ) => {
    if (errors.length === 0) return;
    if (isAutoHealingRef.current) {
      console.log(`🤖 [AUTO-HEAL TRIGGERED] Ignored ${errors.length} errors, already healing.`);
      return;
    }

    const errorHash = errors.map(e => e.message).join('\n').substring(0, 200);
    const now = Date.now();
    const attempts = recentHealAttemptsRef.current[errorHash] || { count: 0, timestamp: now };

    // Reset if older than 3 minutes
    if (now - attempts.timestamp > 3 * 60 * 1000) {
      attempts.count = 0;
    }

    if (attempts.count >= 2) {
      console.warn(`🤖 [AUTO-HEAL TRIGGERED] Ignored ${errors.length} errors, already failed to heal this exact error ${attempts.count} times recently.`);
      updateMessage(aiMessageId, {
        content: `⚠️ **Auto-Heal Aborted:** Failed to resolve the compilation error after multiple attempts. Please fix it manually.\n\n\`\`\`text\n${errors.map(e => e.message).join('\n')}\n\`\`\``,
        status: 'error'
      });
      return;
    }

    attempts.count += 1;
    attempts.timestamp = now;
    recentHealAttemptsRef.current[errorHash] = attempts;

    isAutoHealingRef.current = true;

    console.log(`🤖 [AUTO-HEAL TRIGGERED] Handling ${errors.length} errors`);

    updateMessage(aiMessageId, {
      content: `**Auto-Healing Detected:** \`[${errors.length} ERRORS]\`\n\nIntercepted runtime error(s) in project.\n\n🛠️ Generating silent fix...`,
      status: 'generating'
    });

    try {
      // Bundle all errors into one prompt
      let combinedErrorMessage = errors.map((e, i) => `ERROR ${i + 1} (${e.type}):\n${e.message}\nStack: ${e.raw.substring(0, 200)}`).join('\n\n');

      const healingPrompt = `The application crashed with ${errors.length} error(s). Fix the code to resolve these issues:\n\n${combinedErrorMessage}`;

      // Update the UI explicitly so user knows what's happening
      updateMessage(aiMessageId, {
        content: `**Auto-Healing Detected:** \`[${errors.length} ERRORS]\`\n\nIntercepted runtime error(s) in project.\n\n🛠️ Generating silent fix...`,
        status: 'generating' // Will be cleared by the pipeline's own status updates
      });

      // Route through the central unified pipeline
      // This will stream patches, apply them to WebContainer via ActionRunner,
      // and update React state automatically. No manual file management needed here.
      if (pipelineRef.current) {
        await pipelineRef.current(healingPrompt, aiMessageId);
      } else {
        console.warn('Pipeline ref not set during auto-heal');
      }

    } catch (err: any) {
      console.error('❌ [AUTO-HEAL FAILED]', err);
      updateMessage(aiMessageId, {
        content: `⚠️ **Auto-Heal Failed:** Could not automatically resolve the compilation error.\n\n\`\`\`text\n${errors.map(e => e.message).join('\n')}\n\`\`\``,
        status: 'error'
      });
    } finally {
      isAutoHealingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFiles, updateMessage]);

  // Listen for iframe browser errors
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'ORBIT_RUNTIME_ERROR' && event.data.error) {
        console.warn("Caught IFrame React Error:", event.data.error);

        // Extract likely file name from stack trace or source URL (very basic heuristic for WebContainer paths)
        const stack = event.data.error.stack || '';
        const source = event.data.error.source || '';
        const combinedString = `${stack}\n${source}`;
        const fileMatch = combinedString.match(/src\/[a-zA-Z0-9_\-\/]+\.tsx?/);
        let guessedFile = fileMatch ? fileMatch[0] : 'App.tsx';

        // Sometimes the file path might have a trailing quote or extra character from the stack trace URL formatting
        guessedFile = guessedFile.replace(/['"]$/, '');

        // Deduplicate
        const errorFingerprint = `${guessedFile}:${event.data.error.message}`;
        if (lastErrorRef.current.has(errorFingerprint)) {
          return;
        }
        lastErrorRef.current.add(errorFingerprint);

        // Clear fingerprint after a while
        setTimeout(() => {
          lastErrorRef.current.delete(errorFingerprint);
        }, 5000);

        // Accumulate errors
        pendingErrorsRef.current.push({
          type: 'React Runtime',
          file: guessedFile,
          message: event.data.error.message,
          raw: stack
        });

        // Set a debounce timer to wait for any other concurrent errors
        if (errorAggregationTimerRef.current) {
          clearTimeout(errorAggregationTimerRef.current);
        }

        errorAggregationTimerRef.current = setTimeout(() => {
          const errorsToProcess = [...pendingErrorsRef.current];
          pendingErrorsRef.current = []; // Clear for next batch

          if (errorsToProcess.length === 0) return;

          let activeId = messages.find(m => m.status === 'generating')?.id;
          if (!activeId) {
            activeId = (Date.now() + 1).toString();
            setMessages(prev => [...prev, {
              id: activeId!,
              role: 'assistant',
              content: `Intercepting ${errorsToProcess.length} browser crash(es)...`,
              status: 'generating',
              timestamp: new Date()
            }]);
          }

          handleAutoHeal(errorsToProcess, activeId);
        }, 300); // Wait 300ms to gather all DOM/React cascade errors
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleAutoHeal, messages]);

  // Legacy multi-step generation pipeline removed in favor of streaming pipeline

  // ============================================
  // NEW STREAMING PIPELINE - Uses generate-app + StreamingActionParser
  // This is the Bolt-style single-LLM-call approach
  // ============================================
  const runStreamingPipeline = useCallback(async (prompt: string, aiMessageId: string, errorMessage?: string, errorFile?: string) => {
    pipelineRef.current = runStreamingPipeline;

    try {
      setGenerationState({ status: 'generating' });

      // Bolt Pattern: Await WebContainer promise instead of failing if null.
      // This ensures the user NEVER sees a "not ready" error.
      updateMessage(aiMessageId, { content: '⏳ Initializing development environment...' });
      const wc = await getWebContainer();

      // ── ROADMAP 1: INTELLIGENT PLANNER ──
      const hasExistingCode = projectFiles.length > 0;
      const intent = classifyIntent(prompt, hasExistingCode);

      // Auto-heal logic if error occurred
      let finalPrompt = prompt;
      if (errorMessage && errorFile) {
        finalPrompt = `Fix this error in ${errorFile}:\n\n${errorMessage}\n\nUser request: ${prompt}`;
      } else if (errorMessage) {
        finalPrompt = `Fix this error:\n\n${errorMessage}\n\nUser request: ${prompt}`;
      }

      // ─── STEP 1. Semantic Over-the-Top Search (for unknown APIs/docs)
      updateMessage(aiMessageId, { content: '🔍 Searching codebase & context graph...' });
      let richPrompt = finalPrompt;

      try {
        const keywords = await extractSearchKeywords(finalPrompt);
        if (keywords.length > 0) {
          const query = keywords.join(' ');
          const searchRes = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, files: projectFiles }),
          });

          if (searchRes.ok) {
            const astData = await searchRes.json();
            if (astData.contextNodes && astData.contextNodes.length > 0) {
              const contextStrs = astData.contextNodes.map((n: any) => `// File: ${n.path}\n${n.contextSnippet}`);
              richPrompt = `[CONTEXT GRAPH RESULTS]\n${contextStrs.join('\n\n')}\n\n[USER REQUEST]\n${finalPrompt}`;
            }
          }
        }
      } catch (e) {
        console.error('Search enhancement failed:', e);
        // Fallback to non-enriched prompt on error
      }

      // ─── STEP 2. Smart Edit Context (for local file dependencies)
      let targetContentForAST = '';
      let guessedTarget = 'App.tsx';

      if (intent === 'edit') {
        updateMessage(aiMessageId, { content: '🧩 Building bidirectional import graph...' });
        // We heuristically guess the target file from the prompt, or default to App.tsx
        for (const f of projectFiles) {
          if (prompt.includes(f.path) || prompt.includes(f.path.split('/').pop() || '')) {
            guessedTarget = f.path;
            targetContentForAST = f.content;
            break;
          }
        }
        if (!targetContentForAST) {
           targetContentForAST = projectFiles.find(f => f.path === guessedTarget)?.content || '';
        }
        richPrompt = formatSmartEditPrompt(guessedTarget, projectFiles, richPrompt);
      }

      // ─── STEP 3. Intelligent Planner (Roadmap 1) — with Intent Router
      let techSpec = '';
      let routeMode = 'CREATIVE';
      if (intent === 'generate') {
        updateMessage(aiMessageId, { content: '🎯 Classifying intent (Clone vs Creative)...' });
        try {
          const planRes = await routeAndPlan(richPrompt);
          if (planRes.success && planRes.plan) {
            techSpec = planRes.plan;
            routeMode = planRes.mode || 'CREATIVE';
            const modeLabel = routeMode === 'CLONE' 
              ? `🔬 **CLONE MODE** — Target: ${planRes.target}` 
              : '🎨 **CREATIVE MODE** — Original Design';
            updateMessage(aiMessageId, { 
              content: `${modeLabel}\n\n📋 **Technical Specification**\n\n${techSpec}\n\n---\n\n✨ Starting code generation...` 
            });
          }
        } catch (e) {
          console.warn('Planning phase failed, proceeding to generation:', e);
        }
      }

      // ─── STEP 4. Execution
      updateMessage(aiMessageId, { content: techSpec ? `📋 **Technical Specification**\n\n${techSpec}\n\n---\n\n✨ Generating code...` : '✨ Generating code...' });

      // Build context
      const workspaceContext = buildWorkspaceContext(prompt, projectFiles);

      // ── ROADMAP 6: CONTEXT GRAPH CACHING ──
      let graphContextSnippet = '';
      try {
        if (projectFiles.length > 0) {
          updateMessage(aiMessageId, { content: '🔍 Querying Context Graph for related nodes...' });
          const searchRes = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: prompt, files: projectFiles })
          });
          if (searchRes.ok) {
            const searchContext = await searchRes.json();
            if (searchContext?.contextNodes?.length > 0) {
              graphContextSnippet = `\n\n[CONTEXT GRAPH]: Found ${searchContext.contextNodes.length} relevant file chunks:\n` +
                searchContext.contextNodes.map((n: any) => `File: ${n.path}\nContent:\n${n.contextSnippet}`).join('\n\n');
            }
          }
        }
      } catch (e) {
        console.warn('Context graph search bypassed:', e);
      }

      const planContext = techSpec ? `\n\n[TECHNICAL SPECIFICATION]:\n${techSpec}\n\nIMPORTANT: Follow this specification exactly when writing the code.` : '';

      const enrichedPrompt = workspaceContext.contextBlock
        ? `${workspaceContext.contextBlock}${graphContextSnippet}${planContext}\n\n${richPrompt}`
        : `${graphContextSnippet}${planContext}\n\n${richPrompt}`;

      const filesCreated: string[] = [];
      // Create ActionRunner for executing actions
      const runner = new ActionRunner(wc, {
        onOutput: (rawOutput) => {
          const output = StreamingActionParser.stripAnsi(rawOutput);
          const trimmed = output.trim();
          if (trimmed && !['\\', '|', '/', '-'].includes(trimmed)) {
            console.log('[STREAM]', output);
          }
        },
        onActionStart: (action) => {
          console.log('[ACTION START]', action.description);
          updateMessage(aiMessageId, {
            content: `⏳ Executing: ${action.description}...\n\n**Files:** ${filesCreated.map(f => `\`${f}\``).join(', ')}`
          });
        },
        onErrorDetected: async (errorInfo) => {
          handleAutoHeal([errorInfo], aiMessageId);
        },
        onActionComplete: (action) => {
          console.log('[ACTION COMPLETE]', action.description, action.endTime ? `(took ${action.endTime - (action.startTime || 0)}ms)` : '');

          // Update project files state for UI sync
          if ((action.type === 'file' || action.type === 'patch') && action.path && action.content) {
            const newFile: ProjectFile = {
              path: action.path,
              content: action.content,
              language: action.path.endsWith('.tsx') ? 'tsx' :
                action.path.endsWith('.ts') ? 'typescript' :
                  action.path.endsWith('.json') ? 'json' : 'text'
            };

            setProjectFiles(prev => {
              const existingFiltered = prev.filter(f => f.path !== newFile.path);
              return [...existingFiltered, newFile];
            });
          }
        },
      });

      // Create streaming parser
      const parser = new StreamingActionParser({
        onArtifactOpen: (artifact) => {
          console.log('[ARTIFACT OPEN]', artifact.title);
          updateMessage(aiMessageId, { content: `🏗️ Building: **${artifact.title}**...` });
        },
        onActionOpen: (action) => {
          console.log('[ACTION OPEN]', action.type, action.path || '');
          if (action.type === 'file' && action.path) {
            filesCreated.push(action.path);
            updateMessage(aiMessageId, {
              content: `📝 Creating: \`${action.path}\`...\n\n**Files:** ${filesCreated.map(f => `\`${f}\``).join(', ')}`
            });
          } else if (action.type === 'shell') {
            updateMessage(aiMessageId, {
              content: `⚡ Running: \`${action.content.slice(0, 50)}\`...\n\n**Files:** ${filesCreated.map(f => `\`${f}\``).join(', ')}`
            });
          }
        },
        onActionComplete: (action) => {
          console.log('[PARSER COMPLETE]', action.type, action.path || '');
          // Queue the action for execution
          runner.queueAction(action);
        },
        onText: (text) => {
          // Non-action text (explanations) - could show in UI
          console.log('[TEXT]', text.slice(0, 100));
        }
      });

      // Call local generate app stream or AST engine
      let response;
      if (intent === 'edit' && targetContentForAST) {
          updateMessage(aiMessageId, { content: '🤖 **AST Engine Active:** Synthesizing structural tree modifications...' });
          response = await fetch('/api/edit-ast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: enrichedPrompt,
                intent,
                targetFile: guessedTarget,
                currentCode: targetContentForAST
            })
          });
      } else {
          // Cooldown before the big generation call — let TPM rolling window reset after planning phase
          if (techSpec) {
            updateMessage(aiMessageId, { content: `📋 **Spec ready!**\n\n⏳ Cooling down before generation (25s)...` });
            await new Promise(resolve => setTimeout(resolve, 25000));
          }

          // Targeted retry for generation call — handles both explicit 429s AND CORS-masked 429s
          let retries = 0;
          const maxRetries = 3;
          while (retries <= maxRetries) {
            try {
              response = await generateAppStream(enrichedPrompt, false);
              if (response.status === 429 && retries < maxRetries) {
                retries++;
                let errorBody = '';
                try { errorBody = await response.text(); } catch(e) {}
                // Parse Groq's "Please try again in X.XXXs" to get exact wait time
                let waitMs = 15000;
                const match = errorBody.match(/try again in ([\d.]+)s/);
                if (match) waitMs = Math.ceil(parseFloat(match[1]) * 1000) + 2000;
                console.log(`[GENERATION RETRY] 429 hit. Waiting ${waitMs}ms before retry ${retries}/${maxRetries}...`);
                updateMessage(aiMessageId, { content: `⏳ Rate limit — auto-retrying in ${Math.ceil(waitMs/1000)}s (attempt ${retries}/${maxRetries})...` });
                await new Promise(resolve => setTimeout(resolve, waitMs));
                continue;
              }
              break; // Success or non-retryable error
            } catch (fetchError: any) {
              // CORS-masked 429: Groq returns 429 without CORS headers → browser throws TypeError
              if (fetchError.message?.includes('Failed to fetch') && retries < maxRetries) {
                retries++;
                const waitMs = 20000; // Can't parse wait time from CORS error, use safe default
                console.log(`[GENERATION RETRY] CORS/network error (likely 429). Waiting ${waitMs}ms before retry ${retries}/${maxRetries}...`);
                updateMessage(aiMessageId, { content: `⏳ Network error (rate limit) — auto-retrying in ${Math.ceil(waitMs/1000)}s (attempt ${retries}/${maxRetries})...` });
                await new Promise(resolve => setTimeout(resolve, waitMs));
                continue;
              }
              throw fetchError; // Re-throw if not retryable
            }
          }
      }

      if (!response.ok) {
        let errorText = 'Unknown API Error';
        try { errorText = await response.text(); } catch(e) {}
        throw new Error(`Generation failed: ${response.status} - ${errorText}`);
      }

      // Read streaming response
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let lineBuffer = '';

      setGenerationState({ status: 'building' });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        lineBuffer += chunk;

        const lines = lineBuffer.split('\n');
        // Keep the last part (potentially incomplete line) in the buffer
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;

          const data = trimmedLine.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content || '';
            if (content) {
              parser.parse(aiMessageId, content);
            }
          } catch (e) {
            // If JSON fails, it might be a split line we didn't catch, 
            // but the lineBuffer logic above should handle most cases.
            console.warn('[SSE] Failed to parse JSON:', data, e);
          }
        }
      }

      // Final flush of any remaining content if tag wasn't closed
      if (lineBuffer.startsWith('data: ')) {
        const data = lineBuffer.slice(6);
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || '';
          if (content) parser.parse(aiMessageId, content);
        } catch { }
      }

      // Final update
      updateMessage(aiMessageId, {
        content: `✅ Application generated!\n\n**Files created:** ${filesCreated.map(f => `\`${f}\``).join(', ')}\n\n🚀 Preview should load automatically.`,
        status: 'complete',
      });

      conversationHistoryRef.current.push({
        role: 'assistant',
        content: `Generated ${filesCreated.length} files: ${filesCreated.join(', ')}`
      });

      setGenerationState({ status: 'ready' });

    } catch (error: any) {
      console.error('[STREAMING PIPELINE ERROR]', error);
      updateMessage(aiMessageId, { content: `❌ Error: ${error.message}`, status: 'error' });
      setGenerationState({ status: 'error', error: error.message });
    }
  }, [webcontainer, updateMessage, projectFiles]);

  const sendMessage = useCallback(async (content: string) => {
    const userMessage: Message = { id: Date.now().toString(), role: 'user', content, status: 'complete', timestamp: new Date() };
    const aiMessageId = (Date.now() + 1).toString();
    const aiMessage: Message = { id: aiMessageId, role: 'assistant', content: '', status: 'generating', timestamp: new Date() };

    setMessages((prev) => [...prev, userMessage, aiMessage]);
    setGenerationState({ status: 'generating' });
    conversationHistoryRef.current.push({ role: 'user', content });
    lastPromptRef.current = content;

    try {
      await runStreamingPipeline(content, aiMessageId);
    } catch (error: any) {
      updateMessage(aiMessageId, { content: `❌ Error: ${error.message}`, status: 'error' });
      setGenerationState({ status: 'error', error: error.message });
    }
  }, [projectFiles, updateMessage]);

  const proceedWithRequirements = useCallback(async (requirements: UserRequirements) => {
    setClarifiedRequirements(requirements);
    setShowQuestionnaire(false);
    const aiMessage = messages.find(m => m.status === 'generating' || m.content.includes('questionnaire'));
    const aiMessageId = aiMessage?.id || (Date.now() + 1).toString();

    updateMessage(aiMessageId, { content: '✅ Requirements clarified. Starting generation...', status: 'generating' });
    await runStreamingPipeline(lastPromptRef.current, aiMessageId);
  }, [messages, runStreamingPipeline, updateMessage]);

  const retryLastGeneration = useCallback(() => {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMessage) {
      setMessages((prev) => prev.slice(0, -1));
      sendMessage(lastUserMessage.content);
    }
  }, [messages, sendMessage]);

  return {
    messages,
    generationState,
    projectFiles,
    activeFilePath,
    setActiveFilePath,
    currentPlan,
    showQuestionnaire,
    pendingQuestions,
    sendMessage,
    proceedWithRequirements,
    skipQuestionnaire: () => setShowQuestionnaire(false),
    retryLastGeneration,
    isGenerating: generationState.status === 'generating' || generationState.status === 'building',
  };
}
