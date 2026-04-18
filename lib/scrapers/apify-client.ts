/**
 * Apify client — unified interface for calling pre-built actors.
 *
 * Two modes:
 * - runSync: holds the HTTP connection until actor finishes (up to 5min).
 *   Best for: quick scrapes (< 50s), you need results immediately.
 *   Uses: /acts/{actorId}/run-sync-get-dataset-items
 *
 * - runAsync: starts a run, returns the run_id, you poll later.
 *   Best for: long scrapes (> 50s) or webhook-driven flows.
 *   Uses: /acts/{actorId}/runs  +  /actor-runs/{runId}/dataset/items
 *
 * Timeout strategy: Vercel functions have 60s limit on Pro. Use runSync with
 * a 55s cap, or runAsync for anything longer.
 */

const APIFY_BASE = 'https://api.apify.com/v2';

export class ApifyError extends Error {
  constructor(message: string, public actorId?: string, public status?: number) {
    super(message);
    this.name = 'ApifyError';
  }
}

function getApiKey(): string {
  const key = process.env.APIFY_API_KEY;
  if (!key) throw new ApifyError('APIFY_API_KEY not configured');
  return key;
}

/**
 * Synchronously run an actor and get results directly.
 * Ideal for quick scrapes that fit within 55s.
 */
export async function runSync<T = any>(
  actorId: string,
  input: Record<string, any>,
  opts: { timeoutMs?: number; maxItems?: number } = {}
): Promise<T[]> {
  const { timeoutMs = 55000, maxItems = 500 } = opts;
  const apiKey = getApiKey();

  // The run-sync-get-dataset-items endpoint returns the dataset directly
  const url = `${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?token=${apiKey}&format=json&limit=${maxItems}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new ApifyError(`Actor ${actorId} failed: HTTP ${res.status} ${text.slice(0, 200)}`, actorId, res.status);
    }

    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new ApifyError(`Actor ${actorId} timed out after ${timeoutMs}ms`, actorId);
    }
    if (err instanceof ApifyError) throw err;
    throw new ApifyError(`Actor ${actorId} error: ${err.message}`, actorId);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Start an actor asynchronously. Returns the run_id immediately.
 * Call pollRunResults() later (or use webhooks).
 */
export async function runAsync(
  actorId: string,
  input: Record<string, any>
): Promise<{ runId: string; status: string }> {
  const apiKey = getApiKey();
  const url = `${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/runs?token=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new ApifyError(`Failed to start actor ${actorId}: HTTP ${res.status} ${text.slice(0, 200)}`, actorId, res.status);
  }

  const data = await res.json();
  return { runId: data.data?.id || '', status: data.data?.status || 'READY' };
}

/**
 * Poll a running actor for results. Returns empty array if still running.
 */
export async function pollRunResults<T = any>(
  runId: string,
  opts: { maxItems?: number } = {}
): Promise<{ status: string; items: T[]; stats?: any }> {
  const { maxItems = 500 } = opts;
  const apiKey = getApiKey();

  // Check run status first
  const statusRes = await fetch(
    `${APIFY_BASE}/actor-runs/${runId}?token=${apiKey}`,
    { signal: AbortSignal.timeout(10000) }
  );
  if (!statusRes.ok) {
    throw new ApifyError(`Failed to check run ${runId}: HTTP ${statusRes.status}`);
  }
  const runInfo = await statusRes.json();
  const status = runInfo.data?.status || 'UNKNOWN';

  // Still running — no results yet
  if (status === 'READY' || status === 'RUNNING') {
    return { status, items: [], stats: runInfo.data?.stats };
  }

  // Get dataset items
  const itemsRes = await fetch(
    `${APIFY_BASE}/actor-runs/${runId}/dataset/items?token=${apiKey}&format=json&limit=${maxItems}`,
    { signal: AbortSignal.timeout(15000) }
  );
  if (!itemsRes.ok) {
    throw new ApifyError(`Failed to fetch items for run ${runId}: HTTP ${itemsRes.status}`);
  }
  const items = await itemsRes.json();
  return { status, items: Array.isArray(items) ? items : [], stats: runInfo.data?.stats };
}

/**
 * Abort a running actor (cleanup).
 */
export async function abortRun(runId: string): Promise<void> {
  const apiKey = getApiKey();
  try {
    await fetch(`${APIFY_BASE}/actor-runs/${runId}/abort?token=${apiKey}`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Silent — abort is best-effort
  }
}
