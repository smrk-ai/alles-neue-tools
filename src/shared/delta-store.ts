import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { createLogger } from './logger.js';
import type { DeltaEntry, DeltaMarkEntry, DeltaStats } from './types.js';

const log = createLogger('delta-store');

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!client) {
    client = createClient(config.supabase.url, config.supabase.serviceRoleKey);
  }
  return client;
}

const BATCH_SIZE = 100;

/**
 * Find which entries are NEW (not yet in known_places).
 * Returns only the entries that are not yet known.
 */
export async function findNew(entries: DeltaEntry[]): Promise<DeltaEntry[]> {
  if (entries.length === 0) return [];

  const db = getClient();
  const knownSet = new Set<string>();

  // Process in batches
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const sourceIds = batch.map((e) => e.sourceId);

    const { data, error } = await db
      .from('known_places')
      .select('source, source_id')
      .in('source_id', sourceIds);

    if (error) {
      log.error(`findNew query failed`, { error: error.message, batch: i });
      throw error;
    }

    if (data) {
      for (const row of data) {
        knownSet.add(`${row.source}::${row.source_id}`);
      }
    }
  }

  return entries.filter((e) => !knownSet.has(`${e.source}::${e.sourceId}`));
}

/**
 * Mark entries as known. UPSERT – updates last_seen on conflict.
 */
export async function markKnown(entries: DeltaMarkEntry[]): Promise<void> {
  if (entries.length === 0) return;

  const db = getClient();

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const rows = batch.map((e) => {
      // Omit city field entirely if undefined/null so the DB default ('Hoi An') kicks in.
      // Passing null explicitly violates the NOT NULL constraint.
      const row: Record<string, unknown> = {
        source: e.source,
        source_id: e.sourceId,
        h3_cell: e.h3Cell || null,
        name: e.name || null,
        last_seen: new Date().toISOString(),
      };
      if (e.city) row.city = e.city;
      return row;
    });

    const { error } = await db
      .from('known_places')
      .upsert(rows, { onConflict: 'source,source_id' });

    if (error) {
      log.error(`markKnown upsert failed`, { error: error.message, batch: i });
      throw error;
    }
  }

  log.info(`Marked ${entries.length} places as known`);
}

/**
 * Mark a known place as pushed to pipeline.
 */
export async function markPushed(
  source: string,
  sourceId: string,
  pipelineLeadId: string
): Promise<void> {
  const db = getClient();

  const { error } = await db
    .from('known_places')
    .update({
      pushed_to_pipeline: true,
      pipeline_lead_id: pipelineLeadId,
    })
    .eq('source', source)
    .eq('source_id', sourceId);

  if (error) {
    log.error(`markPushed failed`, { error: error.message, source, sourceId });
    throw error;
  }
}

/**
 * Get statistics for a city.
 */
export async function getStats(city: string): Promise<DeltaStats> {
  const db = getClient();

  const { data, error } = await db
    .from('known_places')
    .select('source')
    .eq('city', city);

  if (error) {
    log.error(`getStats failed`, { error: error.message, city });
    throw error;
  }

  const bySource: Record<string, number> = {};
  for (const row of data || []) {
    bySource[row.source] = (bySource[row.source] || 0) + 1;
  }

  const total = data?.length || 0;
  return { total, bySource };
}
