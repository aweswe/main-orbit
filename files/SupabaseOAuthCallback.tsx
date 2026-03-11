/**
 * SupabaseOAuthCallback.tsx
 *
 * Rendered at /oauth/supabase/callback
 * Supabase redirects here after the user authorizes Orbit.
 * This page reads the ?code= param and sends it to the parent window via postMessage.
 * Then closes itself.
 *
 * Add this route to your App.tsx:
 *   <Route path="/oauth/supabase/callback" element={<SupabaseOAuthCallback />} />
 */

import { useEffect, useState } from 'react';

export default function SupabaseOAuthCallback() {
  const [status, setStatus] = useState<'processing' | 'done' | 'error'>('processing');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const errorParam = params.get('error');
    const errorDescription = params.get('error_description');

    if (errorParam) {
      const message = errorDescription ?? errorParam;
      setError(message);
      setStatus('error');
      window.opener?.postMessage(
        { type: 'supabase-oauth-callback', error: message },
        window.location.origin
      );
      setTimeout(() => window.close(), 2000);
      return;
    }

    if (!code || !state) {
      const message = 'Missing code or state in OAuth callback';
      setError(message);
      setStatus('error');
      window.opener?.postMessage(
        { type: 'supabase-oauth-callback', error: message },
        window.location.origin
      );
      setTimeout(() => window.close(), 2000);
      return;
    }

    // Send code + state back to parent window (Orbit)
    window.opener?.postMessage(
      { type: 'supabase-oauth-callback', code, state },
      window.location.origin
    );

    setStatus('done');
    // Close after a brief moment so user can see success state
    setTimeout(() => window.close(), 800);
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      fontFamily: 'system-ui, sans-serif',
      background: '#0a0a0a',
      color: '#fff',
      gap: '12px',
    }}>
      {status === 'processing' && (
        <>
          <div style={{ fontSize: 24 }}>⏳</div>
          <p style={{ color: '#888', margin: 0 }}>Connecting to Supabase...</p>
        </>
      )}
      {status === 'done' && (
        <>
          <div style={{ fontSize: 32 }}>✅</div>
          <p style={{ color: '#4ade80', margin: 0, fontWeight: 600 }}>Connected!</p>
          <p style={{ color: '#555', margin: 0, fontSize: 13 }}>Closing window...</p>
        </>
      )}
      {status === 'error' && (
        <>
          <div style={{ fontSize: 32 }}>❌</div>
          <p style={{ color: '#f87171', margin: 0, fontWeight: 600 }}>Authorization failed</p>
          <p style={{ color: '#888', margin: 0, fontSize: 13 }}>{error}</p>
        </>
      )}
    </div>
  );
}
