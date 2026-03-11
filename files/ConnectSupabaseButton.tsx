/**
 * ConnectSupabaseButton.tsx
 *
 * The single UI entry point for Supabase integration.
 * Drop this anywhere in Orbit's sidebar/settings panel.
 *
 * Props:
 *   onConnected(connection) — called when fully connected, env written
 *   writeFile — ActionRunner's writeFile, used to write .env + supabase.ts
 */

import { useState } from 'react';
import {
  connectSupabase,
  writeSupabaseFilesToContainer,
  type ConnectionStatus,
  type SupabaseConnection,
  type SupabaseProject,
} from '@/lib/supabase-integration';

interface Props {
  onConnected?: (connection: SupabaseConnection) => void;
  writeFile: (path: string, content: string) => Promise<void>;
}

export default function ConnectSupabaseButton({ onConnected, writeFile }: Props) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [statusMessage, setStatusMessage] = useState('');
  const [connection, setConnection] = useState<SupabaseConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [projects, setProjects] = useState<SupabaseProject[]>([]);
  const [resolveProject, setResolveProject] = useState<((p: SupabaseProject) => void) | null>(null);

  const handleConnect = async () => {
    setError(null);
    setStatus('disconnected');

    const result = await connectSupabase(
      (s, msg) => {
        setStatus(s);
        if (msg) setStatusMessage(msg);
      },
      // Project selector: show picker UI if multiple projects
      async (availableProjects) => {
        setProjects(availableProjects);
        setShowProjectPicker(true);
        return new Promise<SupabaseProject>((resolve) => {
          setResolveProject(() => resolve);
        });
      }
    );

    if (!result.ok || !result.connection) {
      setError(result.error ?? 'Unknown error');
      setStatus('error');
      return;
    }

    // Write .env + src/lib/supabase.ts into WebContainer
    setStatus('writing-env');
    setStatusMessage('Writing environment variables...');
    try {
      await writeSupabaseFilesToContainer(result.connection, writeFile);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to write environment files');
      setStatus('error');
      return;
    }

    setConnection(result.connection);
    setStatus('connected');
    setStatusMessage('');
    onConnected?.(result.connection);
  };

  const selectProject = (project: SupabaseProject) => {
    setShowProjectPicker(false);
    resolveProject?.(project);
    setResolveProject(null);
  };

  // ── Project Picker Modal ─────────────────────────────────────────────────────
  if (showProjectPicker) {
    return (
      <div style={styles.card}>
        <p style={styles.label}>Select a Supabase project:</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {projects.map(p => (
            <button
              key={p.id}
              onClick={() => selectProject(p)}
              style={styles.projectRow}
            >
              <span style={styles.projectName}>{p.name}</span>
              <span style={styles.projectRegion}>{p.region}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Connected State ──────────────────────────────────────────────────────────
  if (status === 'connected' && connection) {
    return (
      <div style={styles.card}>
        <div style={styles.connectedRow}>
          <span style={styles.greenDot} />
          <div>
            <p style={styles.connectedTitle}>{connection.projectName}</p>
            <p style={styles.connectedUrl}>{connection.projectUrl}</p>
          </div>
        </div>
        <button
          onClick={() => {
            setConnection(null);
            setStatus('disconnected');
          }}
          style={styles.disconnectBtn}
        >
          Disconnect
        </button>
      </div>
    );
  }

  // ── Default / Connecting State ───────────────────────────────────────────────
  const isLoading = status === 'connecting' || status === 'fetching' || status === 'writing-env';

  return (
    <div style={styles.card}>
      <button
        onClick={handleConnect}
        disabled={isLoading}
        style={{ ...styles.connectBtn, opacity: isLoading ? 0.7 : 1 }}
      >
        {isLoading ? (
          <>
            <Spinner />
            {statusMessage || 'Connecting...'}
          </>
        ) : (
          <>
            <SupabaseLogo />
            Connect Supabase
          </>
        )}
      </button>

      {error && (
        <p style={styles.errorText}>⚠ {error}</p>
      )}

      {status === 'disconnected' && !error && (
        <p style={styles.hint}>
          Adds auth, database & realtime to your app
        </p>
      )}
    </div>
  );
}

// ─── Micro-components ──────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg
      width="14" height="14"
      viewBox="0 0 24 24"
      style={{ animation: 'spin 0.8s linear infinite', marginRight: 8 }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"
        fill="none" strokeDasharray="30 70" />
    </svg>
  );
}

function SupabaseLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 109 113" fill="none"
      style={{ marginRight: 8 }} xmlns="http://www.w3.org/2000/svg">
      <path d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z" fill="url(#paint0_linear)"/>
      <path d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z" fill="url(#paint1_linear)" fillOpacity="0.2"/>
      <path d="M45.317 2.07103C48.1765 -1.53037 53.9745 0.442937 54.0434 5.04075L54.4849 72.2922H9.83113C1.64038 72.2922 -2.92775 62.8321 2.1655 56.4175L45.317 2.07103Z" fill="#3ECF8E"/>
      <defs>
        <linearGradient id="paint0_linear" x1="53.9738" y1="54.974" x2="94.1635" y2="71.8295" gradientUnits="userSpaceOnUse">
          <stop stopColor="#249361"/>
          <stop offset="1" stopColor="#3ECF8E"/>
        </linearGradient>
        <linearGradient id="paint1_linear" x1="36.1558" y1="30.578" x2="54.4844" y2="65.0806" gradientUnits="userSpaceOnUse">
          <stop/><stop offset="1" stopOpacity="0"/>
        </linearGradient>
      </defs>
    </svg>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: '10px 0',
  },
  connectBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    padding: '9px 14px',
    background: '#1a1a1a',
    border: '1px solid #333',
    borderRadius: 8,
    color: '#e5e5e5',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s',
  },
  hint: {
    fontSize: 11,
    color: '#555',
    margin: 0,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 12,
    color: '#f87171',
    margin: 0,
    padding: '6px 8px',
    background: '#1a0a0a',
    borderRadius: 6,
    border: '1px solid #3a1a1a',
  },
  connectedRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  greenDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#4ade80',
    boxShadow: '0 0 6px #4ade80',
    flexShrink: 0,
  },
  connectedTitle: {
    margin: 0,
    fontSize: 13,
    fontWeight: 600,
    color: '#e5e5e5',
  },
  connectedUrl: {
    margin: 0,
    fontSize: 11,
    color: '#555',
  },
  disconnectBtn: {
    padding: '5px 10px',
    background: 'transparent',
    border: '1px solid #2a2a2a',
    borderRadius: 6,
    color: '#666',
    fontSize: 11,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  label: {
    margin: 0,
    fontSize: 12,
    color: '#888',
    fontWeight: 500,
  },
  projectRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    background: '#111',
    border: '1px solid #2a2a2a',
    borderRadius: 6,
    cursor: 'pointer',
    color: '#e5e5e5',
  },
  projectName: {
    fontSize: 13,
    fontWeight: 500,
  },
  projectRegion: {
    fontSize: 11,
    color: '#555',
  },
};
