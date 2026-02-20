import { config } from './config.js';
import { createLogger } from './logger.js';
import type { PipelineLeadInput, PipelineResult } from './types.js';

const log = createLogger('pipeline');

async function postWithRetry(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  retries = 1
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (attempt < retries) {
        log.warn(`Network error, retrying (${attempt + 1}/${retries})...`, { error: String(err) });
        await new Promise((r) => setTimeout(r, 1000));
      } else {
        throw err;
      }
    }
  }
  throw new Error('Unreachable');
}

export async function pushLead(
  lead: PipelineLeadInput,
  options?: { dryRun?: boolean }
): Promise<PipelineResult> {
  if (options?.dryRun) {
    log.info(`[DRY RUN] Would push lead: ${lead.name || lead.source_id || 'unnamed'}`, {
      source: lead.source,
      city: lead.city,
    });
    return { success: true, id: 'dry-run', status: 'dry-run' };
  }

  try {
    const res = await postWithRetry(
      config.pipeline.apiUrl,
      lead,
      { 'X-API-Key': config.pipeline.apiKey }
    );

    if (res.status === 201) {
      const data = await res.json() as { id: string; status: string };
      log.info(`Lead pushed: ${lead.name || lead.source_id || 'unnamed'}`, { id: data.id });
      return { success: true, id: data.id, status: data.status };
    }

    if (res.status === 409) {
      const data = await res.json() as { existing_id: string };
      log.info(`Duplicate lead: ${lead.name || lead.source_id || 'unnamed'}`, { existingId: data.existing_id });
      return { success: true, id: data.existing_id, duplicate: true };
    }

    const errorBody = await res.text();
    log.error(`Push failed (${res.status}): ${errorBody}`);
    return { success: false, error: `HTTP ${res.status}: ${errorBody}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Push failed: ${msg}`);
    return { success: false, error: msg };
  }
}

const PUSH_CONCURRENCY = 5;

export async function pushLeads(
  leads: PipelineLeadInput[],
  options?: { dryRun?: boolean }
): Promise<PipelineResult[]> {
  const results: PipelineResult[] = [];
  for (let i = 0; i < leads.length; i += PUSH_CONCURRENCY) {
    const batch = leads.slice(i, i + PUSH_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((lead) => pushLead(lead, options)),
    );
    results.push(...batchResults);
  }
  return results;
}
