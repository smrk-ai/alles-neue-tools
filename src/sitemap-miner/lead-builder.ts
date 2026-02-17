import type { PipelineLeadInput } from '../shared/types.js';
import type { EnrichedEntry } from './types.js';

export function buildLead(entry: EnrichedEntry, configId: string): PipelineLeadInput {
  return {
    source: 'tripadvisor',
    source_url: entry.url,
    source_id: entry.platformId,
    name: entry.name,
    city: entry.city,
    category_guess: entry.category,
    raw_data: {
      platform: entry.platform,
      platform_id: entry.platformId,
      sitemap_source: configId,
      discovered_at: new Date().toISOString(),
    },
  };
}

export function buildLeads(entries: EnrichedEntry[], configId: string): PipelineLeadInput[] {
  return entries.map((e) => buildLead(e, configId));
}
