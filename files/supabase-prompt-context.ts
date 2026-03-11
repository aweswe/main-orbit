/**
 * supabase-prompt-context.ts
 *
 * When Supabase is connected, this injects a context block into every
 * LLM generation prompt so the model generates correct Supabase v2 code.
 *
 * Usage in llm.ts:
 *   import { buildSupabaseContext } from './supabase-prompt-context';
 *
 *   // In generateAppStream():
 *   const supabaseBlock = supabaseConnection
 *     ? buildSupabaseContext(supabaseConnection)
 *     : '';
 *
 *   messages: [{ role: 'system', content: SYSTEM_PROMPT + supabaseBlock }]
 */

import type { SupabaseConnection } from './supabase-integration';

// ─── Core Context Builder ──────────────────────────────────────────────────────

export function buildSupabaseContext(connection: SupabaseConnection): string {
  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SUPABASE BACKEND — PROJECT: ${connection.projectName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This project has a live Supabase backend. Generate real fullstack code.

PROJECT URL: ${connection.projectUrl}
CLIENT SINGLETON: Always import from 'src/lib/supabase.ts' — NEVER call createClient() inline.

CORRECT IMPORT PATTERN (always use this):
  import { supabase } from '../lib/supabase';

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SUPABASE V2 API — EXACT SYNTAX (no hallucinations)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DATABASE QUERIES:
  // Select
  const { data, error } = await supabase.from('table').select('*');
  const { data, error } = await supabase.from('table').select('id, name, created_at').eq('id', id);

  // Insert
  const { data, error } = await supabase.from('table').insert({ col: value }).select();

  // Update
  const { data, error } = await supabase.from('table').update({ col: value }).eq('id', id).select();

  // Delete
  const { error } = await supabase.from('table').delete().eq('id', id);

  // Always handle errors:
  if (error) { console.error(error); return; }

AUTH (v2 — these are the ONLY correct method names):
  // Sign up
  const { data, error } = await supabase.auth.signUp({ email, password });

  // Sign in
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  // Sign out
  await supabase.auth.signOut();

  // Get current session
  const { data: { session } } = await supabase.auth.getSession();

  // Get current user
  const { data: { user } } = await supabase.auth.getUser();

  // Listen to auth changes
  supabase.auth.onAuthStateChange((event, session) => { ... });

  ❌ WRONG — these v1 methods DO NOT EXIST in v2:
     supabase.auth.user()           → use supabase.auth.getUser()
     supabase.auth.session()        → use supabase.auth.getSession()
     supabase.auth.signIn()         → use supabase.auth.signInWithPassword()
     supabase.auth.logout()         → use supabase.auth.signOut()

REALTIME SUBSCRIPTIONS:
  const channel = supabase
    .channel('room-1')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' },
      (payload) => { console.log(payload.new); }
    )
    .subscribe();

  // Cleanup:
  supabase.removeChannel(channel);

STORAGE:
  // Upload
  const { data, error } = await supabase.storage.from('bucket').upload('path/file.png', file);

  // Get public URL
  const { data } = supabase.storage.from('bucket').getPublicUrl('path/file.png');

  // Download
  const { data, error } = await supabase.storage.from('bucket').download('path/file.png');

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CODE GENERATION RULES FOR SUPABASE PROJECTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Generate REAL database calls — not mock data or localStorage
2. Always create a SQL migration file at supabase/migrations/001_initial.sql
   with CREATE TABLE statements for every table you query
3. Add RLS policies to the migration: enable RLS + basic authenticated access
4. The @supabase/supabase-js package is already installed — never add it to package.json again
5. For auth-protected routes, check session with getSession() inside a useEffect
6. Use TypeScript types for table rows:
   type Task = { id: string; title: string; status: string; created_at: string; }
7. Always use .select() after .insert() or .update() to return the mutated row
8. For realtime features, clean up channels in useEffect return function

MIGRATION FILE TEMPLATE (always generate this):
  -- supabase/migrations/001_initial.sql
  create table if not exists public.your_table (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references auth.users(id) on delete cascade,
    title text not null,
    created_at timestamptz default now() not null
  );

  alter table public.your_table enable row level security;

  create policy "Users can read own rows"
    on public.your_table for select
    using (auth.uid() = user_id);

  create policy "Users can insert own rows"
    on public.your_table for insert
    with check (auth.uid() = user_id);

  create policy "Users can update own rows"
    on public.your_table for update
    using (auth.uid() = user_id);

  create policy "Users can delete own rows"
    on public.your_table for delete
    using (auth.uid() = user_id);
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
}

// ─── Migration Runner ──────────────────────────────────────────────────────────

/**
 * Runs SQL migrations against the connected Supabase project via Management API.
 * Called after the LLM generates migration files.
 *
 * @param sql - The SQL to execute
 * @param connection - Active Supabase connection
 */
export async function runMigration(
  sql: string,
  connection: SupabaseConnection
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${connection.projectId}/database/query`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${connection.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: response.statusText }));
      return { ok: false, error: err.message ?? 'Migration failed' };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Network error',
    };
  }
}

// ─── Auto-Migration Detector ───────────────────────────────────────────────────

/**
 * Scans generated files for SQL migration files and runs them automatically.
 * Call this after all files are written, if Supabase is connected.
 */
export async function autoRunMigrations(
  files: Array<{ path: string; content: string }>,
  connection: SupabaseConnection,
  onOutput: (msg: string) => void
): Promise<void> {
  const migrationFiles = files.filter(
    f => f.path.includes('migrations/') && f.path.endsWith('.sql')
  );

  if (migrationFiles.length === 0) return;

  onOutput(`\n🗄️  Running ${migrationFiles.length} migration(s) against ${connection.projectName}...\n`);

  for (const file of migrationFiles) {
    onOutput(`   📄 ${file.path}... `);
    const result = await runMigration(file.content, connection);
    if (result.ok) {
      onOutput(`✅\n`);
    } else {
      onOutput(`❌ ${result.error}\n`);
    }
  }

  onOutput(`✅ Migrations complete\n`);
}
