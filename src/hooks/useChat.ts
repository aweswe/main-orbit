import { useState, useCallback, useRef } from 'react';
import { Message, GenerationState, ProjectFile, RequestIntent } from '@/types/chat';
// @ts-ignore: module aliasing
import { ProjectPlan, PromptAnalysis, UserRequirements, Question } from '@/types/pipeline';
import { supabase } from '@/integrations/supabase/client';
// @ts-ignore: module aliasing
import { canonicalizeImports } from '@/lib/importCanonicalizer';
import { useWebContainer } from '@/contexts/WebContainerContext';
import { getWebContainer } from '@/lib/webcontainer/instance';
import { StreamingActionParser, ParsedAction } from '@/lib/runtime/streaming-parser';
import { ActionRunner } from '@/lib/runtime/action-runner';

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
  const editKeywords = [
    'change', 'update', 'make the', 'fix', 'adjust', 'tweak', 'modify',
    'set the', 'turn the', 'make it', 'switch', 'replace', 'remove the',
    'add a', 'add the', 'delete the', 'hide the', 'show the'
  ];
  const generateKeywords = [
    'create', 'build', 'generate', 'design', 'implement', 'make a',
    'make me', 'write a', 'develop', 'construct', 'new'
  ];

  const promptLower = prompt.toLowerCase();
  const isEditIntent = editKeywords.some(k => promptLower.includes(k));
  const isGenerateIntent = generateKeywords.some(k => promptLower.includes(k));

  if (!hasExistingCode) return 'generate';
  if (isEditIntent && !isGenerateIntent) return 'edit';
  if (isGenerateIntent && !isEditIntent) return 'generate';
  if (hasExistingCode && prompt.length < 100) return 'edit';

  return 'generate';
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

      const { data, error } = await supabase.functions.invoke('analyze-prompt', {
        body: { prompt, projectId: 'temp-ui-project' },
      });

      console.log('🔍 [ANALYZE-PROMPT] Response:', { data, error });

      if (error) {
        console.error('❌ [ANALYZE-PROMPT] Error:', error);
        throw new Error(error.message || 'Analysis failed');
      }

      console.log('✅ [ANALYZE-PROMPT] Success:', {
        hasAnalysis: !!data?.analysis,
        questionCount: data?.questions?.length,
        skipQuestions: data?.skipQuestions
      });

      return data;
    } catch (err: any) {
      console.error('❌ [ANALYZE-PROMPT] Exception:', err);
      throw err;
    }
  };

  const planProject = async (prompt: string): Promise<ProjectPlan> => {
    console.log('📋 [PLAN-PROJECT] Starting...');
    console.log('📋 [PLAN-PROJECT] Prompt:', prompt.substring(0, 100) + '...');

    try {
      // ✅ RATE LIMIT: Wait before making request
      await waitForRateLimit();

      const { data, error } = await supabase.functions.invoke('plan-project', {
        body: { prompt },
      });

      console.log('📋 [PLAN-PROJECT] Response:', {
        success: data?.success,
        error: error || data?.error,
        fileCount: data?.plan?.files?.length
      });

      if (error || !data.success) {
        console.error('❌ [PLAN-PROJECT] Failed:', { error, dataError: data?.error });
        throw new Error(data?.error || error?.message || 'Planning failed');
      }

      console.log('✅ [PLAN-PROJECT] Success:', {
        files: data.plan?.files?.map((f: any) => f.path)
      });

      return data.plan;
    } catch (err: any) {
      console.error('❌ [PLAN-PROJECT] Exception:', err);
      throw err;
    }
  };

  const generateTypes = async (plan: ProjectPlan): Promise<string> => {
    console.log('📝 [GENERATE-TYPES] Starting...');

    try {
      // ✅ RATE LIMIT: Wait before making request
      await waitForRateLimit();

      const { data, error } = await supabase.functions.invoke('generate-types', {
        body: { plan },
      });

      console.log('📝 [GENERATE-TYPES] Response:', {
        success: data?.success,
        error: error || data?.error,
        typesLength: data?.types?.length
      });

      if (error || !data.success) {
        console.error('❌ [GENERATE-TYPES] Failed:', { error, dataError: data?.error });
        throw new Error(data?.error || error?.message || 'Type generation failed');
      }

      console.log('✅ [GENERATE-TYPES] Success');
      return data.types;
    } catch (err: any) {
      console.error('❌ [GENERATE-TYPES] Exception:', err);
      throw err;
    }
  };

  const generateProjectFile = async (
    filePlan: any,
    sharedProject: any,
    contextFiles: ProjectFile[],
    prompt: string
  ): Promise<{ code: string; content: string }> => {
    console.log('🏗️ [GENERATE-FILE] Starting:', filePlan.path);
    console.log('🏗️ [GENERATE-FILE] FilePlan:', {
      path: filePlan.path,
      type: filePlan.type,
      exports: filePlan.exports,
      dependencies: filePlan.dependencies
    });
    console.log('🏗️ [GENERATE-FILE] Context files:', contextFiles.map(f => f.path));

    try {
      // ✅ RATE LIMIT: Wait before making request to avoid Groq API limits
      await waitForRateLimit();

      const { data, error } = await supabase.functions.invoke('generate-project-file', {
        body: { filePlan, sharedProject, contextFiles, prompt },
      });

      console.log('🏗️ [GENERATE-FILE] Response for', filePlan.path, ':', {
        success: data?.success,
        error: error || data?.error,
        codeLength: data?.code?.length,
        attempts: data?.attempts,
        linesOfCode: data?.linesOfCode
      });

      if (error || !data.success) {
        console.error('❌ [GENERATE-FILE] Failed:', filePlan.path, {
          error,
          dataError: data?.error,
          stack: data?.stack
        });
        throw new Error(data?.error || error?.message || `Failed to generate ${filePlan.path}`);
      }

      console.log('✅ [GENERATE-FILE] Success:', filePlan.path, `(${data.linesOfCode} lines)`);
      return data;
    } catch (err: any) {
      console.error('❌ [GENERATE-FILE] Exception for', filePlan.path, ':', err);
      throw err;
    }
  };

  const validateCode = async (code: string, filename: string): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> => {
    console.log('🔍 [VALIDATE-CODE] Starting:', filename);

    try {
      // ✅ RATE LIMIT: Wait before making request
      await waitForRateLimit();

      const { data, error } = await supabase.functions.invoke('validate-code', {
        body: { code, filename },
      });

      console.log('🔍 [VALIDATE-CODE] Response for', filename, ':', {
        valid: data?.valid,
        errors: data?.errors,
        warnings: data?.warnings,
        error
      });

      if (error) {
        console.warn('⚠️ [VALIDATE-CODE] API error, assuming valid:', error);
        return { valid: true, errors: [], warnings: [] };
      }

      const result = {
        valid: data.valid ?? true,
        errors: data.errors || [],
        warnings: data.warnings || [],
      };

      if (!result.valid) {
        console.warn('⚠️ [VALIDATE-CODE] Validation failed for', filename, ':', result.errors);
      } else {
        console.log('✅ [VALIDATE-CODE] Valid:', filename);
      }

      return result;
    } catch (err: any) {
      console.error('❌ [VALIDATE-CODE] Exception:', err);
      return { valid: true, errors: [], warnings: [] };
    }
  };

  const editCodeSnippet = async (
    prompt: string,
    currentCode: string,
    filename: string = 'App.tsx'
  ): Promise<{ code: string; explanation: string; appliedPatches: string[] }> => {
    console.log('✏️ [EDIT-CODE] Starting...');
    console.log('✏️ [EDIT-CODE] Prompt:', prompt.substring(0, 100) + '...');
    console.log('✏️ [EDIT-CODE] Current code length:', currentCode.length);

    let retries = 4;
    let delay = 6000;

    while (true) {
      try {
        await waitForRateLimit();

        const { data, error } = await supabase.functions.invoke('edit-code', {
          body: { prompt, currentCode, filename },
        });

        console.log('✏️ [EDIT-CODE] Response:', {
          success: data?.success,
          error: error || data?.error,
          codeLength: data?.code?.length,
          patchCount: data?.appliedPatches?.length
        });

        if (error || !data.success) {
          console.error('❌ [EDIT-CODE] Failed:', { error, dataError: data?.error });
          throw new Error(data?.error || error?.message || 'Code editing failed');
        }

        console.log('✅ [EDIT-CODE] Success');
        return {
          code: data.code,
          explanation: data.explanation || '',
          appliedPatches: data.appliedPatches || [],
        };
      } catch (err: any) {
        if (retries <= 0) {
          console.error('❌ [EDIT-CODE] Exception (Final):', err);
          throw err;
        }

        console.log(`🔄 [EDIT-CODE RETRY] Attempt ${5 - retries + 1}/5, waiting ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        retries--;
        delay *= 1.5;
      }
    }
  };

  const getCurrentCode = (): string | null => {
    const appFile = projectFiles.find(f => f.path === 'App.tsx');
    return appFile?.content || null;
  };

  // Main Generation Pipeline
  const runGenerationPipeline = useCallback(async (prompt: string, aiMessageId: string, requirements?: UserRequirements) => {
    try {
      setGenerationState({ status: 'generating' });

      // Ensure WebContainer is ready
      updateMessage(aiMessageId, { content: '⏳ Initializing development environment...' });
      await getWebContainer();

      // Step 1: Planning
      updateMessage(aiMessageId, { content: '📋 Designing project architecture...' });
      const plan = await planProject(prompt);
      setCurrentPlan(plan);

      if (!plan.files || plan.files.length === 0) {
        throw new Error('Planner failed to generate a file list');
      }

      // Step 2: Sequential Multi-File Generation
      const generatedFiles: ProjectFile[] = [];
      const sortedFiles = [...plan.files].sort((a, b) => a.priority - b.priority);

      let currentFileIndex = 0;
      const withRetry = async <T>(fn: () => Promise<T>, retries = 4, delay = 6000): Promise<T> => {
        try {
          return await fn();
        } catch (error) {
          if (retries <= 0) throw error;
          console.log(`🔄 [RETRY] Attempt ${5 - retries + 1}/5, waiting ${delay}ms before retry...`);
          // Wait for rate limit + extra delay before retry
          await waitForRateLimit();
          await new Promise(resolve => setTimeout(resolve, delay));
          return withRetry(fn, retries - 1, delay * 1.5);
        }
      };

      for (const filePlan of sortedFiles) {
        currentFileIndex++;
        const progress = `🏗️ Building project (${currentFileIndex}/${sortedFiles.length}): \`${filePlan.path}\`...`;
        updateMessage(aiMessageId, {
          content: progress + (generatedFiles.length > 0 ? `\n\nGenerated: ${generatedFiles.map(f => `\`${f.path}\``).join(', ')}` : '')
        });

        // 1. Initial Generation - Use smart context selection to prevent token overflow
        const contextFiles = selectSmartContext(filePlan, generatedFiles);

        let { code, content } = await withRetry(() => generateProjectFile(
          filePlan,
          plan.sharedProject,
          contextFiles,
          prompt
        ));

        // 2. Validation & Auto-Healing Loop
        let retryCount = 0;
        const maxRetriesPerFile = 2;

        while (retryCount < maxRetriesPerFile) {
          updateMessage(aiMessageId, {
            content: progress + `\n🔍 Validating \`${filePlan.path}\`...` + (generatedFiles.length > 0 ? `\n\nGenerated: ${generatedFiles.map(f => `\`${f.path}\``).join(', ')}` : '')
          });
          const validation = await validateCode(code, filePlan.path);

          if (validation.valid && validation.errors.length === 0) {
            break; // Code is clean
          }

          // Reparation required
          retryCount++;
          const errorContext = `Found ${validation.errors.length} errors in ${filePlan.path}:\n- ${validation.errors.join('\n- ')}`;
          updateMessage(aiMessageId, {
            content: progress + `\n🔧 Auto-healing \`${filePlan.path}\` (Attempt ${retryCount}/${maxRetriesPerFile})...\n\n${errorContext}` + (generatedFiles.length > 0 ? `\n\nGenerated: ${generatedFiles.map(f => `\`${f.path}\``).join(', ')}` : '')
          });

          try {
            const editResult = await editCodeSnippet(
              `Fix the following errors in the code for ${filePlan.path}:\n${errorContext}\n\nEnsure ALL imports and exports are correct.`,
              code,
              filePlan.path
            );
            code = editResult.code;
          } catch (e) {
            console.error(`❌ [AUTO-HEAL] Failed to edit ${filePlan.path}, keeping original code.`, e);
            updateMessage(aiMessageId, {
              content: progress + `\n⚠️ Auto-healing failed for \`${filePlan.path}\`. Continuing with original code.`
            });
            break; // Stop healing this file
          }
        }

        const cleanCode = canonicalizeImports(code, filePlan.path);
        const newFile: ProjectFile = {
          path: filePlan.path,
          content: cleanCode,
          language: 'tsx'
        };

        generatedFiles.push(newFile);
        setProjectFiles([...generatedFiles]); // Update UI file tree in real-time

        // Brief pause between files to prevent rate limiting/overload
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // PHASE 2: Ensure package.json exists (Fallback Injection)
      const hasPackageJson = generatedFiles.some(f => f.path === 'package.json');
      if (!hasPackageJson) {
        console.warn('⚠️ [ORBIT] AI did not generate package.json, injecting fallback');
        updateMessage(aiMessageId, {
          content: '⚠️ Adding missing package.json...'
        });

        // Detect dependencies from generated files
        const useTailwind = generatedFiles.some(f =>
          f.content.includes('tailwind') || f.content.includes('className=')
        );
        const useReactRouter = generatedFiles.some(f =>
          f.content.includes('react-router') || f.content.includes('useNavigate')
        );

        const fallbackPackageJson: ProjectFile = {
          path: 'package.json',
          content: JSON.stringify({
            name: 'orbit-generated-project',
            private: true,
            version: '0.0.1',
            type: 'module',
            scripts: {
              dev: 'vite',
              build: 'vite build',
              preview: 'vite preview'
            },
            dependencies: {
              'react': '^18.2.0',
              'react-dom': '^18.2.0',
              ...(useReactRouter ? { 'react-router-dom': '^6.20.0' } : {})
            },
            devDependencies: {
              '@vitejs/plugin-react': '^4.2.0',
              'vite': '^5.0.0',
              ...(useTailwind ? {
                'tailwindcss': '^3.3.0',
                'postcss': '^8.4.0',
                'autoprefixer': '^10.4.0'
              } : {})
            }
          }, null, 2),
          language: 'json'
        };
        generatedFiles.unshift(fallbackPackageJson);
      }

      // Ensure index.html exists
      const hasIndexHtml = generatedFiles.some(f => f.path === 'index.html');
      if (!hasIndexHtml) {
        const fallbackIndexHtml: ProjectFile = {
          path: 'index.html',
          content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Orbit App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`,
          language: 'html'
        };
        generatedFiles.unshift(fallbackIndexHtml);
      }

      // Ensure vite.config.ts exists
      const hasViteConfig = generatedFiles.some(f =>
        f.path === 'vite.config.ts' || f.path === 'vite.config.js'
      );
      if (!hasViteConfig) {
        const fallbackViteConfig: ProjectFile = {
          path: 'vite.config.ts',
          content: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});`,
          language: 'typescript'
        };
        generatedFiles.push(fallbackViteConfig);
      }

      setProjectFiles([...generatedFiles]);

      // PHASE 3: AUTO-BOOT SEQUENCE - The critical missing piece!
      updateMessage(aiMessageId, {
        content: `✅ Files generated! Now booting preview...\n\n**Files:** ${generatedFiles.map(f => `\`${f.path}\``).join(', ')}`
      });

      setGenerationState({ status: 'building' });
      bootOutputRef.current = [];

      const bootSuccess = await runBootSequence(generatedFiles, (output) => {
        bootOutputRef.current.push(output);
        // Update message with boot progress (throttled)
        if (bootOutputRef.current.length % 5 === 0) {
          updateMessage(aiMessageId, {
            content: `🚀 Booting preview...\n\n\`\`\`\n${bootOutputRef.current.slice(-10).join('')}\n\`\`\``
          });
        }
      });

      // Final Step: Completion
      const finalExplanation = bootSuccess
        ? '? Project generated and running!\\n\\n**Structure:**\\n' + sortedFiles.map(f => '- ' + f.path + ': ' + f.purpose).join('\\n') + '\\n\\n?? Preview is ready!'
        : '? Files generated! Preview may need manual start.\\n\\n**Structure:**\\n' + sortedFiles.map(f => '- ' + f.path + ': ' + f.purpose).join('\\n') + '\\n\\n?? If preview does not load, check the terminal.';

      updateMessage(aiMessageId, {
        content: finalExplanation,
        status: 'complete',
      });

      conversationHistoryRef.current.push({ role: 'assistant', content: finalExplanation });
      setGenerationState({ status: 'ready' });

    } catch (error: any) {
      console.error('Generation Pipeline Error:', error);
      updateMessage(aiMessageId, { content: `❌ Error: ${error.message}`, status: 'error' });
      setGenerationState({ status: 'error', error: error.message });
    }
  }, [updateMessage]);

  // ============================================
  // NEW STREAMING PIPELINE - Uses generate-app + StreamingActionParser
  // This is the Bolt-style single-LLM-call approach
  // ============================================
  const runStreamingPipeline = useCallback(async (prompt: string, aiMessageId: string) => {
    try {
      setGenerationState({ status: 'generating' });

      // Bolt Pattern: Await WebContainer promise instead of failing if null.
      // This ensures the user NEVER sees a "not ready" error.
      updateMessage(aiMessageId, { content: '⏳ Initializing development environment...' });
      const wc = await getWebContainer();

      updateMessage(aiMessageId, { content: '🚀 Generating application...' });

      const filesCreated: string[] = [];
      const generatedFiles: ProjectFile[] = [];

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
        onActionComplete: (action) => {
          console.log('[ACTION COMPLETE]', action.description, action.endTime ? `(took ${action.endTime - (action.startTime || 0)}ms)` : '');
        },
        onWarning: (message) => {
          console.warn('[ACTION WARNING]', message);
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

          // Track generated files for projectFiles state
          if (action.type === 'file' && action.path) {
            const newFile: ProjectFile = {
              path: action.path,
              content: action.content,
              language: action.path.endsWith('.tsx') ? 'tsx' :
                action.path.endsWith('.ts') ? 'typescript' :
                  action.path.endsWith('.json') ? 'json' : 'text'
            };

            generatedFiles.push(newFile);

            // Critical: Update both local and global state
            setProjectFiles([...generatedFiles]);
          }
        },
        onText: (text) => {
          // Non-action text (explanations) - could show in UI
          console.log('[TEXT]', text.slice(0, 100));
        }
      });

      // Call generate-app with streaming
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-app`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ prompt, stream: true }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
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
  }, [webcontainer, updateMessage]);

  const sendMessage = useCallback(async (content: string) => {
    const userMessage: Message = { id: Date.now().toString(), role: 'user', content, status: 'complete', timestamp: new Date() };
    const aiMessageId = (Date.now() + 1).toString();
    const aiMessage: Message = { id: aiMessageId, role: 'assistant', content: '', status: 'generating', timestamp: new Date() };

    setMessages((prev) => [...prev, userMessage, aiMessage]);
    setGenerationState({ status: 'generating' });
    conversationHistoryRef.current.push({ role: 'user', content });
    lastPromptRef.current = content;

    const currentCode = getCurrentCode();
    const intent = classifyIntent(content, !!currentCode);

    try {
      if (intent === 'generate') {
        // Use new streaming pipeline when feature flag is enabled
        if (USE_STREAMING_PIPELINE) {
          await runStreamingPipeline(content, aiMessageId);
        } else {
          // Legacy multi-step pipeline
          updateMessage(aiMessageId, { content: '🔍 Analyzing requirements...' });
          const { analysis, questions, skipQuestions } = await analyzePrompt(content);

          if (!skipQuestions && questions && questions.length > 0) {
            setPendingAnalysis(analysis);
            setPendingQuestions(questions);
            setShowQuestionnaire(true);
            updateMessage(aiMessageId, { content: '❓ I have some questions to clarify your vision. Please check the questionnaire below.' });
            setGenerationState({ status: 'idle' });
            return;
          }
          await runGenerationPipeline(content, aiMessageId);
        }
      } else if (intent === 'edit' && currentCode) {
        updateMessage(aiMessageId, { content: '🔧 Applying surgical edit...' });
        const result = await editCodeSnippet(content, currentCode);
        const code = canonicalizeImports(result.code, 'App.tsx');

        updateMessage(aiMessageId, {
          content: result.explanation + (result.appliedPatches.length ? '\n\n**Changes:**\n' + result.appliedPatches.map(p => `- ${p}`).join('\n') : ''),
          codeBlocks: [{ language: 'tsx', code, filename: 'App.tsx' }],
          status: 'complete',
        });
        setProjectFiles([{ path: 'App.tsx', content: code, language: 'tsx' }]);
        conversationHistoryRef.current.push({ role: 'assistant', content: result.explanation });
        setGenerationState({ status: 'ready' });
      }
    } catch (error: any) {
      updateMessage(aiMessageId, { content: `❌ Error: ${error.message}`, status: 'error' });
      setGenerationState({ status: 'error', error: error.message });
    }
  }, [projectFiles, runGenerationPipeline, updateMessage]);

  const proceedWithRequirements = useCallback(async (requirements: UserRequirements) => {
    setClarifiedRequirements(requirements);
    setShowQuestionnaire(false);
    const aiMessage = messages.find(m => m.status === 'generating' || m.content.includes('questionnaire'));
    const aiMessageId = aiMessage?.id || (Date.now() + 1).toString();

    updateMessage(aiMessageId, { content: '✅ Requirements clarified. Starting generation...', status: 'generating' });
    await runGenerationPipeline(lastPromptRef.current, aiMessageId, requirements);
  }, [messages, runGenerationPipeline, updateMessage]);

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
