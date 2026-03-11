/**
 * supabase-integration.ts
 *
 * One-Click Supabase Connect for Orbit
 * ──────────────────────────────────────
 * Handles the full OAuth flow:
 *   1. Opens Supabase OAuth popup → user authorizes Orbit
 *   2. Exchanges code for Management API access token
 *   3. Lists user's projects (or creates a new one)
 *   4. Fetches project URL + anon key automatically
 *   5. Writes .env into WebContainer
 *   6. Generates src/lib/supabase.ts client singleton
 *   7. Returns SupabaseConnection for the LLM context injector
 *
 * The user never sees a URL or a key. One button. Done.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'        // OAuth popup open
  | 'fetching'          // getting project keys
  | 'writing-env'       // writing .env to WebContainer
  | 'connected'
  | 'error';

export interface SupabaseProject {
  id: string;
  name: string;
  region: string;
  status: string;
}

export interface SupabaseConnection {
  projectId: string;
  projectName: string;
  projectUrl: string;       // https://xxx.supabase.co
  anonKey: string;
  serviceRoleKey?: string;  // only if user grants elevated scope
  accessToken: string;      // Management API token (for generating migrations etc)
}

export interface ConnectResult {
  ok: boolean;
  connection?: SupabaseConnection;
  error?: string;
}

// ─── OAuth Config ──────────────────────────────────────────────────────────────

const SUPABASE_OAUTH_URL = 'https://api.supabase.com/v1/oauth/authorize';
const SUPABASE_TOKEN_URL = 'https://api.supabase.com/v1/oauth/token';
const SUPABASE_MANAGEMENT_API = 'https://api.supabase.com/v1';

// These must be registered in Supabase Developer Portal for Orbit's app
// CLIENT_ID is public — it identifies Orbit to Supabase, not a secret
const ORBIT_CLIENT_ID = import.meta.env.VITE_SUPABASE_OAUTH_CLIENT_ID ?? '';
const ORBIT_REDIRECT_URI = `${window.location.origin}/oauth/supabase/callback`;

// ─── OAuth Flow ────────────────────────────────────────────────────────────────

/**
 * Generates a PKCE code verifier + challenge for secure OAuth without a backend.
 * This lets us do the OAuth flow entirely in the browser.
 */
async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const verifier = btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  return { verifier, challenge };
}

/**
 * Opens the Supabase OAuth authorization popup.
 * Returns the authorization code via postMessage from the callback page.
 */
export async function openSupabaseOAuth(): Promise<string> {
  const { verifier, challenge } = await generatePKCE();
  const state = crypto.randomUUID();

  // Store PKCE verifier for token exchange
  sessionStorage.setItem('supabase_oauth_verifier', verifier);
  sessionStorage.setItem('supabase_oauth_state', state);

  const params = new URLSearchParams({
    client_id: ORBIT_CLIENT_ID,
    redirect_uri: ORBIT_REDIRECT_URI,
    response_type: 'code',
    scope: 'all',  // projects:read, keys:read — enough for Orbit
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  const authUrl = `${SUPABASE_OAUTH_URL}?${params}`;

  return new Promise((resolve, reject) => {
    const popup = window.open(
      authUrl,
      'supabase-oauth',
      'width=600,height=700,left=200,top=100'
    );

    if (!popup) {
      reject(new Error('Popup blocked. Please allow popups for Orbit.'));
      return;
    }

    const messageHandler = (event: MessageEvent) => {
      // Only accept messages from our own origin
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'supabase-oauth-callback') return;

      window.removeEventListener('message', messageHandler);

      if (event.data.error) {
        reject(new Error(event.data.error));
        return;
      }

      if (event.data.state !== state) {
        reject(new Error('OAuth state mismatch — possible CSRF attack'));
        return;
      }

      resolve(event.data.code);
    };

    window.addEventListener('message', messageHandler);

    // Cleanup if popup is closed without completing
    const checkClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkClosed);
        window.removeEventListener('message', messageHandler);
        reject(new Error('OAuth popup closed before completing authorization'));
      }
    }, 500);
  });
}

/**
 * Exchanges the authorization code for an access token.
 */
async function exchangeCodeForToken(code: string): Promise<string> {
  const verifier = sessionStorage.getItem('supabase_oauth_verifier');
  if (!verifier) throw new Error('PKCE verifier not found — OAuth session expired');

  sessionStorage.removeItem('supabase_oauth_verifier');
  sessionStorage.removeItem('supabase_oauth_state');

  const response = await fetch(SUPABASE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: ORBIT_REDIRECT_URI,
      client_id: ORBIT_CLIENT_ID,
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  const data = await response.json();
  return data.access_token;
}

// ─── Management API ────────────────────────────────────────────────────────────

async function mgmtFetch<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${SUPABASE_MANAGEMENT_API}${path}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase Management API error: ${response.status} ${path}`);
  }

  return response.json();
}

/**
 * Fetches all projects for the authenticated user.
 */
export async function fetchProjects(accessToken: string): Promise<SupabaseProject[]> {
  return mgmtFetch<SupabaseProject[]>('/projects', accessToken);
}

/**
 * Fetches the API keys for a project (anon + service_role).
 */
async function fetchProjectKeys(
  projectId: string,
  accessToken: string
): Promise<{ anon: string; service_role: string }> {
  const keys = await mgmtFetch<Array<{ name: string; api_key: string }>>(
    `/projects/${projectId}/api-keys`,
    accessToken
  );

  const anon = keys.find(k => k.name === 'anon')?.api_key ?? '';
  const service_role = keys.find(k => k.name === 'service_role')?.api_key ?? '';

  if (!anon) throw new Error('Could not fetch anon key for project');

  return { anon, service_role };
}

// ─── Main Connect Function ─────────────────────────────────────────────────────

/**
 * Full one-click connect flow.
 *
 * @param onStatus - callback for UI status updates during the flow
 * @param projectSelector - optional: if user has multiple projects, ask which one.
 *   If omitted, selects the first active project automatically.
 */
export async function connectSupabase(
  onStatus: (status: ConnectionStatus, message?: string) => void,
  projectSelector?: (projects: SupabaseProject[]) => Promise<SupabaseProject>
): Promise<ConnectResult> {
  try {
    // Step 1: OAuth
    onStatus('connecting', 'Opening Supabase authorization...');
    const code = await openSupabaseOAuth();

    onStatus('fetching', 'Exchanging authorization code...');
    const accessToken = await exchangeCodeForToken(code);

    // Step 2: Get projects
    onStatus('fetching', 'Fetching your Supabase projects...');
    const projects = await fetchProjects(accessToken);

    if (projects.length === 0) {
      return {
        ok: false,
        error: 'No Supabase projects found. Create a project at supabase.com first.',
      };
    }

    // Step 3: Select project
    let selectedProject: SupabaseProject;
    const activeProjects = projects.filter(p => p.status === 'ACTIVE_HEALTHY');

    if (activeProjects.length === 1 || !projectSelector) {
      selectedProject = activeProjects[0] ?? projects[0];
    } else {
      selectedProject = await projectSelector(activeProjects);
    }

    // Step 4: Fetch keys
    onStatus('fetching', `Fetching keys for "${selectedProject.name}"...`);
    const keys = await fetchProjectKeys(selectedProject.id, accessToken);

    const connection: SupabaseConnection = {
      projectId: selectedProject.id,
      projectName: selectedProject.name,
      projectUrl: `https://${selectedProject.id}.supabase.co`,
      anonKey: keys.anon,
      serviceRoleKey: keys.service_role,
      accessToken,
    };

    onStatus('connected');
    return { ok: true, connection };

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    onStatus('error', message);
    return { ok: false, error: message };
  }
}

// ─── WebContainer Integration ──────────────────────────────────────────────────

/**
 * Writes Supabase credentials to .env inside the WebContainer.
 * Call this after connectSupabase() returns a connection.
 */
export function buildEnvFile(connection: SupabaseConnection): string {
  return [
    '# Supabase — auto-configured by Orbit',
    `VITE_SUPABASE_URL=${connection.projectUrl}`,
    `VITE_SUPABASE_ANON_KEY=${connection.anonKey}`,
    '',
    '# Never commit this file to git',
  ].join('\n');
}

/**
 * Generates the src/lib/supabase.ts client singleton.
 * This is the ONLY place createClient should be called in the entire project.
 */
export function buildSupabaseClientFile(): string {
  return `import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Connect your Supabase project in Orbit settings.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export type { SupabaseClient } from '@supabase/supabase-js';
`;
}

/**
 * Generates a .gitignore entry if one doesn't exist.
 */
export function buildGitignore(existing?: string): string {
  const base = existing ?? '';
  const additions = [];
  if (!base.includes('.env')) additions.push('.env', '.env.local', '.env*.local');
  if (!base.includes('node_modules')) additions.push('node_modules');
  return base + (additions.length ? '\n' + additions.join('\n') + '\n' : '');
}

/**
 * Writes all Supabase files to the WebContainer in one call.
 */
export async function writeSupabaseFilesToContainer(
  connection: SupabaseConnection,
  writeFile: (path: string, content: string) => Promise<void>
): Promise<void> {
  await Promise.all([
    writeFile('.env', buildEnvFile(connection)),
    writeFile('src/lib/supabase.ts', buildSupabaseClientFile()),
  ]);
}
