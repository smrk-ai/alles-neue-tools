import { config } from '../shared/config.js';
import { createLogger } from '../shared/logger.js';
import type { CDWatchSummary, CDWatchHistory } from './types.js';

const log = createLogger('changedetection-api');

const TIMEOUT_MS = 15_000;

function getBaseUrl(): string {
  const url = config.changedetection.baseUrl;
  if (!url) {
    throw new Error('CHANGEDETECTION_BASE_URL is not configured');
  }
  return url.replace(/\/+$/, ''); // strip trailing slash
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.changedetection.apiKey) {
    headers['x-api-key'] = config.changedetection.apiKey;
  }
  return headers;
}

async function apiFetch(path: string): Promise<Response> {
  const url = `${getBaseUrl()}${path}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: getHeaders(),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`API ${res.status} for ${path}: ${body}`);
    }

    return res;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * List all watches with their current status.
 * GET /api/v1/watch
 */
export async function listWatches(): Promise<Record<string, CDWatchSummary>> {
  log.debug('Fetching watch list');
  const res = await apiFetch('/api/v1/watch');
  const data = await res.json() as Record<string, CDWatchSummary>;
  log.debug(`Got ${Object.keys(data).length} watches`);
  return data;
}

/**
 * Get the snapshot history for a watch.
 * GET /api/v1/watch/{uuid}/history
 * Returns { timestamp: filepath } mapping.
 */
export async function getWatchHistory(uuid: string): Promise<CDWatchHistory> {
  log.debug(`Fetching history for watch ${uuid}`);
  const res = await apiFetch(`/api/v1/watch/${uuid}/history`);
  return await res.json() as CDWatchHistory;
}

/**
 * Get a snapshot's text content.
 * GET /api/v1/watch/{uuid}/history/{timestamp}
 * Use 'latest' as timestamp to get the most recent snapshot.
 */
export async function getSnapshot(uuid: string, timestamp: string = 'latest'): Promise<string> {
  log.debug(`Fetching snapshot for ${uuid} at ${timestamp}`);

  let ts = timestamp;
  if (ts === 'latest') {
    const history = await getWatchHistory(uuid);
    const timestamps = Object.keys(history).sort((a, b) => Number(b) - Number(a));
    if (timestamps.length === 0) {
      log.warn(`No snapshots available for watch ${uuid}`);
      return '';
    }
    ts = timestamps[0];
  }

  const res = await apiFetch(`/api/v1/watch/${uuid}/history/${ts}`);
  return await res.text();
}

/**
 * Get a text diff between two snapshots.
 * GET /api/v1/watch/{uuid}/diff/{from}/{to}
 */
export async function getDiff(
  uuid: string,
  from: string = 'previous',
  to: string = 'latest',
): Promise<string> {
  log.debug(`Fetching diff for ${uuid}: ${from} → ${to}`);

  let fromTs = from;
  let toTs = to;

  if (fromTs === 'previous' || toTs === 'latest') {
    const history = await getWatchHistory(uuid);
    const timestamps = Object.keys(history).sort((a, b) => Number(b) - Number(a));

    if (timestamps.length < 2) {
      log.warn(`Not enough snapshots for diff (${timestamps.length} available)`);
      return '';
    }

    if (toTs === 'latest') toTs = timestamps[0];
    if (fromTs === 'previous') fromTs = timestamps[1];
  }

  const res = await apiFetch(`/api/v1/watch/${uuid}/diff/${fromTs}/${toTs}?format=text`);
  return await res.text();
}
