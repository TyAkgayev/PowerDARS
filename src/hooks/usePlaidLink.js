import { useCallback } from 'react';

const FUNCTION_URLS = {
  createLinkToken:    'https://createlinktoken-v5nh5hrtnq-uc.a.run.app',
  exchangePublicToken:'https://exchangepublictoken-v5nh5hrtnq-uc.a.run.app',
  syncBalances:       'https://syncbalances-v5nh5hrtnq-uc.a.run.app',
};

const OAUTH_ACCOUNT_KEY = 'plaid_oauth_account_id';

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

function getRedirectUri() {
  return window.location.origin + window.location.pathname.replace(/\/$/, '') || window.location.origin + '/';
}

async function initPlaidLink({ accountId, onSuccess, receivedRedirectUri }) {
  const res = await fetch(FUNCTION_URLS.createLinkToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uri: getRedirectUri() }),
  });
  if (!res.ok) throw new Error('Failed to get link token');
  const { link_token } = await res.json();

  await loadPlaidScript();

  const handler = window.Plaid.create({
    token: link_token,
    ...(receivedRedirectUri ? { receivedRedirectUri } : {}),
    onSuccess: async (public_token, metadata) => {
      sessionStorage.removeItem(OAUTH_ACCOUNT_KEY);
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
}

export function usePlaidLink() {
  // True when Plaid has redirected back after OAuth bank login
  const isOAuthReturn = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('oauth_state_id');

  const openLink = useCallback(async (accountId, onSuccess) => {
    try {
      sessionStorage.setItem(OAUTH_ACCOUNT_KEY, accountId);
      await initPlaidLink({ accountId, onSuccess, receivedRedirectUri: null });
    } catch (err) {
      console.error('usePlaidLink error:', err);
      alert('Could not open bank linking. Check the console for details.');
    }
  }, []);

  // Call this on app load when isOAuthReturn is true
  const completeOAuthReturn = useCallback(async (onSuccess) => {
    try {
      const accountId = sessionStorage.getItem(OAUTH_ACCOUNT_KEY);
      if (!accountId) throw new Error('Missing accountId for OAuth return');
      const receivedRedirectUri = window.location.href;
      await initPlaidLink({ accountId, onSuccess, receivedRedirectUri });
    } catch (err) {
      console.error('OAuth return error:', err);
      alert('Bank linking could not complete. Please try again.');
    }
  }, []);

  const syncBalances = useCallback(async () => {
    const res = await fetch(FUNCTION_URLS.syncBalances, { method: 'POST' });
    if (!res.ok) throw new Error('Sync failed');
    return res.json();
  }, []);

  return { openLink, completeOAuthReturn, isOAuthReturn, syncBalances };
}
