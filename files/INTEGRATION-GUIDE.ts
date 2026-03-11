/**
 * INTEGRATION GUIDE
 * ──────────────────
 * How to wire Smart Edit + Supabase into your existing llm.ts and useChat.ts
 * Minimal changes — everything slots into existing functions.
 */


// ════════════════════════════════════════════════════════
// 1. llm.ts — Smart Edit context upgrade
// ════════════════════════════════════════════════════════

// ADD to imports at top of llm.ts:
import { buildEditPrompt } from './smart-edit-context';
import type { WorkspaceFileEntry } from './smart-edit-context';

// CHANGE editCodeLocal signature to accept workspace files:
export async function editCodeLocal(
  prompt: string,
  currentCode: string,
  filename: string = 'App.tsx',
  allWorkspaceFiles: WorkspaceFileEntry[] = []   // ← ADD THIS PARAM
) {
  // REPLACE the userMessage construction:
  // BEFORE:
  //   const userMessage = `Current code in ${filename}:\n\`\`\`tsx\n${truncatedCode}...`;
  //
  // AFTER:
  const userMessage = buildEditPrompt(prompt, filename, currentCode, allWorkspaceFiles);

  // Everything else in editCodeLocal stays identical.
}


// ════════════════════════════════════════════════════════
// 2. llm.ts — Supabase context in generateAppStream
// ════════════════════════════════════════════════════════

// ADD to imports at top of llm.ts:
import { buildSupabaseContext } from './supabase-prompt-context';
import type { SupabaseConnection } from './supabase-integration';
import { withDeterminism } from './determinism-constraints';

// CHANGE generateAppStream signature:
export async function generateAppStream(
  prompt: string,
  supabaseConnection?: SupabaseConnection   // ← ADD THIS PARAM
): Promise<Response> {
  const apiKey = getApiKey();

  const supabaseBlock = supabaseConnection
    ? buildSupabaseContext(supabaseConnection)
    : '';

  return fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      messages: [
        // CHANGE: withDeterminism(SYSTEM_PROMPT + supabaseBlock)
        { role: 'system', content: withDeterminism(SYSTEM_PROMPT + supabaseBlock) },
        { role: 'user', content: `Create this application: ${prompt}` }
      ],
      stream: true,
      temperature: 0.1,
      max_tokens: 16000,
    }),
  });
}


// ════════════════════════════════════════════════════════
// 3. useChat.ts — Pass workspace files to editCodeLocal
// ════════════════════════════════════════════════════════

// In your editCode handler (wherever editCodeLocal is called):
// BEFORE:
//   const result = await editCodeLocal(prompt, currentCode, filename);
//
// AFTER:
//   const allFiles = Array.from(workspaceFiles.entries()).map(([path, content]) => ({ path, content }));
//   const result = await editCodeLocal(prompt, currentCode, filename, allFiles);
//
// workspaceFiles is your existing Map<string, string> of the workspace.
// If you use ActionRunner's #writtenFiles map, you can read it directly.


// ════════════════════════════════════════════════════════
// 4. useChat.ts — Supabase connection state
// ════════════════════════════════════════════════════════

// ADD to your chat state:
//   const [supabaseConnection, setSupabaseConnection] = useState<SupabaseConnection | null>(null);

// Pass to generateAppStream:
//   generateAppStream(prompt, supabaseConnection ?? undefined)

// After files are written (in queueAction completion), auto-run migrations:
//   import { autoRunMigrations } from './supabase-prompt-context';
//   if (supabaseConnection) {
//     await autoRunMigrations(allWrittenFiles, supabaseConnection, onOutput);
//   }


// ════════════════════════════════════════════════════════
// 5. Orbit Sidebar — Add the Connect button
// ════════════════════════════════════════════════════════

// In your Sidebar/Settings component:
//   import ConnectSupabaseButton from '@/components/ConnectSupabaseButton';
//
//   <ConnectSupabaseButton
//     writeFile={(path, content) => actionRunner.writeFile(path, content)}
//     onConnected={(conn) => setSupabaseConnection(conn)}
//   />

// In App.tsx routes:
//   import SupabaseOAuthCallback from '@/components/SupabaseOAuthCallback';
//   <Route path="/oauth/supabase/callback" element={<SupabaseOAuthCallback />} />


// ════════════════════════════════════════════════════════
// 6. vite.config.ts in Orbit itself — allow popup origin
// ════════════════════════════════════════════════════════

// Add to your Orbit app's vite.config.ts (NOT the generated project):
//   server: {
//     headers: {
//       'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
//     }
//   }
// This is required for window.opener.postMessage to work in the OAuth callback.


// ════════════════════════════════════════════════════════
// 7. Supabase Developer Portal — Register Orbit as OAuth app
// ════════════════════════════════════════════════════════

// Go to: https://supabase.com/dashboard/account/tokens → OAuth Apps → New app
// App name: Orbit
// Redirect URI: https://your-orbit-domain.com/oauth/supabase/callback
//               http://localhost:5173/oauth/supabase/callback  (for dev)
// Copy the Client ID → set as VITE_SUPABASE_OAUTH_CLIENT_ID in Orbit's .env
// (There is no client secret — we use PKCE, which is secret-free)


// ════════════════════════════════════════════════════════
// COMPLETE DATA FLOW DIAGRAM
// ════════════════════════════════════════════════════════
//
// USER CLICKS "Connect Supabase"
//       │
//       ▼
// ConnectSupabaseButton → openSupabaseOAuth() → Popup opens supabase.com
//       │                                            │
//       │                              User clicks "Authorize Orbit"
//       │                                            │
//       │                              Supabase redirects to /oauth/supabase/callback
//       │                                            │
//       │                              SupabaseOAuthCallback → postMessage(code)
//       │                                            │
//       ◄─────────────────────────────────────────── ┘
//       │
//       ▼
// exchangeCodeForToken(code) → Supabase Management API
//       │
//       ▼
// fetchProjects(token) → [project list]
//       │
//       ▼  (auto-select if 1 project, or show picker)
// fetchProjectKeys(projectId) → { anon, service_role }
//       │
//       ▼
// writeSupabaseFilesToContainer()
//   ├── writes .env          (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
//   └── writes src/lib/supabase.ts  (createClient singleton)
//       │
//       ▼
// setSupabaseConnection(connection)
//       │
//       ▼
// USER SENDS NEXT PROMPT: "add user auth and a tasks database"
//       │
//       ▼
// generateAppStream(prompt, supabaseConnection)
//   └── SYSTEM_PROMPT + buildSupabaseContext(connection)  ← LLM now knows
//       │                                                    the project URL,
//       ▼                                                    v2 API syntax,
// LLM generates:                                            and migration format
//   ├── src/components/TaskList.tsx     (real supabase queries)
//   ├── src/components/AuthForm.tsx     (real supabase auth v2)
//   ├── src/hooks/useTasks.ts          (real supabase hooks)
//   └── supabase/migrations/001.sql    (CREATE TABLE + RLS)
//       │
//       ▼
// autoRunMigrations() → runs SQL against live Supabase project
//       │
//       ▼
// App is fully functional fullstack ✅
