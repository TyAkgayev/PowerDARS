import { useCallback } from 'react';

const FUNCTION_URLS = {
  createLinkToken:    'https://createlinktoken-v5nh5hrtnq-uc.a.run.app',
  exchangePublicToken:'https://exchangepublictoken-v5nh5hrtnq-uc.a.run.app',
  syncBalances:       'https://syncbalances-v5nh5hrtnq-uc.a.run.app',
};

function loadPlaidScript() {
  return new Promise((resolve, reject) => {
    if (window.Plaid) { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export function usePlaidLink() {
  const openLink = useCallback(async (accountId, onSuccess) => {
    try {
      // 1. Get a link_token from our Cloud Function
      const redirectUri = window.location.origin + window.location.pathname;
      const res = await fetch(FUNCTION_URLS.createLinkToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirect_uri: redirectUri }),
      });
      if (!res.ok) throw new Error('Failed to get link token');
      const { link_token } = await res.json();

      // 2. Load Plaid Link script if not already loaded
      await loadPlaidScript();

      // 3. Open Plaid Link UI
      const handler = window.Plaid.create({
        token: link_token,
        receivedRedirectUri: document.referrer.includes('plaid') ? window.location.href : undefined,
        onSuccess: async (public_token, metadata) => {
          // 4. Exchange the public token for a permanent access token (server-side)
          const ex = await fetch(FUNCTION_URLS.exchangePublicToken, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ public_token, accountId }),
          });
          if (!ex.ok) throw new Error('Token exchange failed');
          onSuccess?.(metadata);
        },
        onExit: (err) => {
          if (err) console.warn('Plaid Link exited with error:', err);
        },
      });

      handler.open();
    } catch (err) {
      console.error('usePlaidLink error:', err);
      alert('Could not open bank linking. Check the console for details.');
    }
  }, []);

  // Trigger a balance sync for all linked accounts
  const syncBalances = useCallback(async () => {
    const res = await fetch(FUNCTION_URLS.syncBalances, { method: 'POST' });
    if (!res.ok) throw new Error('Sync failed');
    return res.json();
  }, []);

  return { openLink, syncBalances };
}
