import type { PipelineLeadInput } from '../shared/types.js';
import type { ParsedChangeItem, WatchConfig } from './types.js';

/**
 * Transform a parsed change item into a pipeline lead.
 */
export function transformToLead(
  item: ParsedChangeItem,
  watchConfig: WatchConfig,
  snapshotTimestamp?: string,
): PipelineLeadInput {
  return {
    source: watchConfig.leadSource,
    source_id: `cd:${watchConfig.id}:${item.externalId}`,
    source_url: item.url || watchConfig.url,
    name: item.name || null,
    address: item.address || null,
    city: watchConfig.city,
    category_guess: item.category ?? watchConfig.categoryHint ?? null,
    description: item.rawText ? item.rawText.substring(0, 500) : null,
    raw_data: {
      changedetection: true,
      watch_id: watchConfig.id,
      watch_label: watchConfig.label,
      watch_url: watchConfig.url,
      parser: watchConfig.parser,
      snapshot_timestamp: snapshotTimestamp || null,
    },
  };
}

/**
 * Transform multiple parsed items into pipeline leads.
 */
export function transformToLeads(
  items: ParsedChangeItem[],
  watchConfig: WatchConfig,
  snapshotTimestamp?: string,
): PipelineLeadInput[] {
  return items.map((item) => transformToLead(item, watchConfig, snapshotTimestamp));
}
