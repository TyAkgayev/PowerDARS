// Thin client for the browser-use Cloud API (https://api.browser-use.com/api/v4),
// shared by every browser-use-backed agent. Not specific to any one agent's
// task/domain — that lives in each agent's own file under functions/agents/.
const BROWSER_USE_API = 'https://api.browser-use.com/api/v4';
const BROWSER_USE_TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

async function createBrowserUseRun(apiKey, task, secretBindings) {
  const createResp = await fetch(`${BROWSER_USE_API}/runs`, {
    method: 'POST',
    headers: { 'X-Browser-Use-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, secretBindings }),
  });
  if (!createResp.ok) {
    throw new Error(`browser-use create run failed: ${createResp.status} ${await createResp.text()}`);
  }
  const { id: runId } = await createResp.json();
  return runId;
}

// Checks a run once. Returns { done: false } while still running, or
// { done: true, ok, resultText } once it reaches a terminal status. A real
// login flow (MFA, slow pages) can take a while, so callers should call this
// repeatedly rather than blocking on a single long wait.
async function pollBrowserUseRunOnce(apiKey, runId) {
  const statusResp = await fetch(`${BROWSER_USE_API}/runs/${runId}/status`, {
    headers: { 'X-Browser-Use-API-Key': apiKey },
  });
  if (!statusResp.ok) return { done: false };
  const { status } = await statusResp.json();
  if (!BROWSER_USE_TERMINAL_STATUSES.has(status)) return { done: false, status };

  const runResp = await fetch(`${BROWSER_USE_API}/runs/${runId}`, {
    headers: { 'X-Browser-Use-API-Key': apiKey },
  });
  const run = await runResp.json();
  if (status !== 'completed') {
    return { done: true, ok: false, error: `browser-use run ${status}: ${run.result || 'no details'}` };
  }
  return { done: true, ok: true, resultText: run.result };
}

// Runs a task to completion by polling, for callers that aren't waiting on a
// synchronous button press (e.g. a scheduled job).
async function runBrowserUseTaskToCompletion(apiKey, task, secretBindings, maxWaitMs = 8 * 60 * 1000) {
  const runId = await createBrowserUseRun(apiKey, task, secretBindings);
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const result = await pollBrowserUseRunOnce(apiKey, runId);
    if (result.done) {
      if (!result.ok) throw new Error(result.error);
      return result.resultText;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`browser-use run ${runId} did not finish within ${Math.round(maxWaitMs / 1000)}s`);
}

module.exports = { createBrowserUseRun, pollBrowserUseRunOnce, runBrowserUseTaskToCompletion };
