import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, useWindowDimensions, ActivityIndicator,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { authedFetch } from '../utils/api';

const CHECK_LICENSE_STATUS_URL = 'https://us-central1-dars-4e5d0.cloudfunctions.net/checkLicenseStatus';
const POLL_LICENSE_STATUS_URL = 'https://us-central1-dars-4e5d0.cloudfunctions.net/pollLicenseStatus';
const CHECK_INSURANCE_STATUS_URL = 'https://us-central1-dars-4e5d0.cloudfunctions.net/checkInsuranceStatus';
const POLL_INSURANCE_STATUS_URL = 'https://us-central1-dars-4e5d0.cloudfunctions.net/pollInsuranceStatus';
const CHECK_BESTBUY_STATUS_URL = 'https://us-central1-dars-4e5d0.cloudfunctions.net/checkBestBuyStatus';
const POLL_BESTBUY_STATUS_URL = 'https://us-central1-dars-4e5d0.cloudfunctions.net/pollBestBuyStatus';
const CHECK_CAPITALONE_STATUS_URL = 'https://us-central1-dars-4e5d0.cloudfunctions.net/checkCapitalOneStatus';
const POLL_CAPITALONE_STATUS_URL = 'https://us-central1-dars-4e5d0.cloudfunctions.net/pollCapitalOneStatus';
const POLL_INTERVAL_MS = 4000;

const C = {
  primary: '#4361EE',
  primaryLight: '#EEF2FF',
  bg: '#F0F4FF',
  card: '#FFFFFF',
  text: '#1F2937',
  muted: '#6B7280',
  faint: '#9CA3AF',
  border: '#E5E7EB',
  green: '#22C55E',
  red: '#EF4444',
  orange: '#F59E0B',
};

// Registry of every browser-use-backed agent in the app. Add an entry here
// each time a new one goes live (functions/agents/*.js). `getData` pulls
// that agent's latest report out of whatever's already loaded in
// AppContext, so no new Firestore listeners are needed here.
function useAgentRegistry() {
  const { licenseCheck, insuranceCheck, accounts, accountReports } = useApp();
  const bestBuyAccount = accounts.find(a => a.name === 'Best Buy');
  const capitalOnePlatinumAccount = accounts.find(a => a.name === 'Capital One Platinum');

  return [
    {
      id: 'dmv',
      name: 'DMV Status',
      icon: '🪪',
      description: 'Logs into NY.gov MyDMV Online to check license status, registration status/expiration, license points, and open TVB tickets.',
      site: 'my.ny.gov',
      schedule: 'Daily at 7:00am ET',
      checkUrl: CHECK_LICENSE_STATUS_URL,
      pollUrl: POLL_LICENSE_STATUS_URL,
      data: licenseCheck,
    },
    {
      id: 'geico',
      name: 'GEICO Insurance',
      icon: '🛡️',
      description: 'Logs into GEICO’s eCams portal to check whether the policy has a past-due balance.',
      site: 'ecams.geico.com',
      schedule: 'Daily at 7:05am ET',
      checkUrl: CHECK_INSURANCE_STATUS_URL,
      pollUrl: POLL_INSURANCE_STATUS_URL,
      data: insuranceCheck,
    },
    {
      id: 'bestbuy',
      name: 'Best Buy Credit Card',
      icon: '💳',
      description: 'Logs into Citi Retail Services and populates whatever fields the "Best Buy" account’s category defines.',
      site: 'citiretailservices.citibankonline.com',
      schedule: 'Daily at 7:10am ET',
      checkUrl: CHECK_BESTBUY_STATUS_URL,
      pollUrl: POLL_BESTBUY_STATUS_URL,
      data: bestBuyAccount ? accountReports[bestBuyAccount.id] : null,
      unavailable: !bestBuyAccount,
    },
    {
      id: 'capitalone',
      name: 'Capital One Credit Cards',
      icon: '💳',
      description: 'Logs into Capital One once and populates the Platinum, QuickSilver, and Kohls cards’ category fields in a single run.',
      site: 'verified.capitalone.com',
      schedule: 'Daily at 7:15am ET',
      checkUrl: CHECK_CAPITALONE_STATUS_URL,
      pollUrl: POLL_CAPITALONE_STATUS_URL,
      data: capitalOnePlatinumAccount ? accountReports[capitalOnePlatinumAccount.id] : null,
      unavailable: !capitalOnePlatinumAccount,
    },
  ];
}

function fmtCheckedAt(checkedAt) {
  if (!checkedAt) return null;
  const d = checkedAt.toDate ? checkedAt.toDate() : new Date(checkedAt);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtDuration(minutes) {
  if (typeof minutes !== 'number') return null;
  if (minutes < 1) return `${Math.round(minutes * 60)} sec`;
  return `${minutes.toFixed(1)} min`;
}

function prettyJson(text) {
  if (!text) return null;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

// Same "start a run, then poll for the outcome" pattern used on the Car and
// DAR screens — the agent's login flow can take a while, so the button just
// starts the run and this polls in the background.
function useCheckPolling({ checkUrl, pollUrl, runningStatus, runId: existingRunId }) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const pollUntilDone = useCallback((runId) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await authedFetch(`${pollUrl}?runId=${encodeURIComponent(runId)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Check failed');
        if (data.status === 'completed' || data.status === 'failed') {
          stopPolling();
          setChecking(false);
          if (data.status === 'failed') setError(data.error || 'Check failed');
        }
      } catch (e) {
        stopPolling();
        setChecking(false);
        setError(e.message);
      }
    }, POLL_INTERVAL_MS);
  }, [stopPolling, pollUrl]);

  const trigger = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const res = await authedFetch(checkUrl, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start check');
      pollUntilDone(data.runId);
    } catch (e) {
      setChecking(false);
      setError(e.message);
    }
  }, [checkUrl, pollUntilDone]);

  useEffect(() => {
    if (runningStatus === 'running' && existingRunId && !pollRef.current) {
      setChecking(true);
      pollUntilDone(existingRunId);
    }
    return stopPolling;
  }, [runningStatus, existingRunId, pollUntilDone, stopPolling]);

  return { checking, error, trigger };
}

// ─── Collapsible text block (for long prompts/raw results) ─────────────────
function Expandable({ label, content, mono }) {
  const [open, setOpen] = useState(false);
  if (!content) {
    return (
      <View style={x.row}>
        <Text style={x.label}>{label}</Text>
        <Text style={x.emptyTxt}>Not run yet</Text>
      </View>
    );
  }
  return (
    <View style={x.row}>
      <TouchableOpacity onPress={() => setOpen(o => !o)} style={x.toggleRow}>
        <Text style={x.label}>{label}</Text>
        <Text style={x.toggleTxt}>{open ? 'Hide ▲' : 'Show ▼'}</Text>
      </TouchableOpacity>
      {open && (
        <View style={x.box}>
          <Text style={[x.boxTxt, mono && x.boxTxtMono]} selectable>{content}</Text>
        </View>
      )}
    </View>
  );
}

// ─── Agent Card ──────────────────────────────────────────────────────────────
function AgentCard({ agent }) {
  const { checking, error: triggerError, trigger } = useCheckPolling({
    checkUrl: agent.checkUrl,
    pollUrl: agent.pollUrl,
    runningStatus: agent.data?.status,
    runId: agent.data?.runId,
  });

  const status = agent.data?.status;
  const success = agent.data?.success;
  const checkedAtLabel = fmtCheckedAt(agent.data?.checkedAt);
  const durationLabel = status === 'running' || checking ? null : fmtDuration(agent.data?.durationMinutes);

  // The agent's own self-assessed success/failure judgment, separate from
  // `status` (which only reflects whether the browser-use run technically
  // completed without an API-level error).
  let badgeColor = C.faint;
  let badgeText = 'Not run yet';
  if (status === 'running' || checking) {
    badgeColor = C.orange; badgeText = 'Running…';
  } else if (status === 'failed' || success === false) {
    badgeColor = C.red; badgeText = 'Failed';
  } else if (status === 'completed' && success === true) {
    badgeColor = C.green; badgeText = 'Succeeded';
  } else if (status === 'completed') {
    badgeColor = C.faint; badgeText = 'Completed (no self-assessment)';
  }

  return (
    <View style={a.card}>
      <View style={a.header}>
        <View style={a.headerLeft}>
          <Text style={a.icon}>{agent.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={a.name}>{agent.name}</Text>
            <Text style={a.site}>{agent.site} · {agent.schedule}</Text>
          </View>
        </View>
        <TouchableOpacity
          style={a.checkBtn}
          onPress={trigger}
          disabled={checking || agent.unavailable}
        >
          {checking
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={a.checkBtnTxt}>Check Now</Text>}
        </TouchableOpacity>
      </View>

      <Text style={a.description}>{agent.description}</Text>

      {agent.unavailable && (
        <Text style={a.warning}>No "Best Buy" account found — create one on the Accounts screen first.</Text>
      )}

      <View style={a.statusRow}>
        <View style={[a.badge, { backgroundColor: `${badgeColor}20`, borderColor: badgeColor }]}>
          <Text style={[a.badgeTxt, { color: badgeColor }]}>{badgeText}</Text>
        </View>
        {!!durationLabel && (
          <View style={a.durationPill}>
            <Text style={a.durationTxt}>⏱ {durationLabel}</Text>
          </View>
        )}
        <Text style={a.checkedAt}>
          {checkedAtLabel ? `Last checked ${checkedAtLabel}` : ''}
        </Text>
      </View>

      {!!(triggerError || agent.data?.error) && (
        <Text style={a.error}>{triggerError || agent.data?.error}</Text>
      )}

      {!!agent.data?.summary && (
        <View style={a.summaryBox}>
          <Text style={a.summaryLabel}>Agent's summary</Text>
          <Text style={a.summaryTxt}>{agent.data.summary}</Text>
        </View>
      )}

      <Expandable label="Prompt sent to the agent" content={agent.data?.prompt} mono />
      <Expandable label="Last raw result" content={prettyJson(agent.data?.rawResult)} mono />
    </View>
  );
}

// ─── AgentsScreen ────────────────────────────────────────────────────────────
export default function AgentsScreen() {
  const agents = useAgentRegistry();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.content, isMobile && s.contentMobile]}>
      <View style={s.header}>
        <Text style={s.title}>🤖 Agents</Text>
        <Text style={s.subtitle}>Every browser-use agent running in PowerSync, what it's told to do, and what it last found.</Text>
      </View>

      {agents.map(agent => (
        <AgentCard key={agent.id} agent={agent} />
      ))}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 28, paddingBottom: 60 },
  contentMobile: { padding: 16, paddingBottom: 100 },
  header: { marginBottom: 24 },
  title: { fontSize: 28, fontWeight: '800', color: C.text },
  subtitle: { fontSize: 14, color: C.muted, marginTop: 4, maxWidth: 520 },
});

const a = StyleSheet.create({
  card: {
    backgroundColor: C.card, borderRadius: 16, padding: 20, marginBottom: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 },
  headerLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, flex: 1 },
  icon: { fontSize: 24 },
  name: { fontSize: 16, fontWeight: '700', color: C.text },
  site: { fontSize: 11, color: C.faint, marginTop: 2 },
  checkBtn: { backgroundColor: C.primary, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 16, minWidth: 100, alignItems: 'center' },
  checkBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
  description: { fontSize: 13, color: C.muted, lineHeight: 19, marginBottom: 12 },
  warning: { fontSize: 12, color: C.orange, fontWeight: '600', marginBottom: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' },
  badge: { borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  badgeTxt: { fontSize: 12, fontWeight: '700' },
  durationPill: { backgroundColor: '#F3F4F6', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  durationTxt: { fontSize: 12, fontWeight: '600', color: C.muted },
  checkedAt: { fontSize: 11, color: C.faint },
  error: { fontSize: 12, color: C.red, marginBottom: 8 },
  summaryBox: { backgroundColor: C.primaryLight, borderRadius: 10, padding: 10, marginBottom: 10 },
  summaryLabel: { fontSize: 10, fontWeight: '700', color: C.primary, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 3 },
  summaryTxt: { fontSize: 13, color: C.text },
});

const x = StyleSheet.create({
  row: { marginTop: 8 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 12, fontWeight: '600', color: C.muted },
  toggleTxt: { fontSize: 12, color: C.primary, fontWeight: '600' },
  emptyTxt: { fontSize: 12, color: C.faint, fontStyle: 'italic' },
  box: { backgroundColor: '#F9FAFB', borderRadius: 8, padding: 10, marginTop: 6, maxHeight: 260, overflow: 'scroll' },
  boxTxt: { fontSize: 12, color: C.text, lineHeight: 18 },
  boxTxtMono: { fontFamily: 'Courier', fontSize: 11 },
});
