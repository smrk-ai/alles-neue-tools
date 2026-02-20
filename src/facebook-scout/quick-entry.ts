import { config } from '../shared/config.js';
import { createLogger } from '../shared/logger.js';
import { graphApiGet, withRetry } from '../shared/meta-client.js';
import { pushLead } from '../shared/pipeline-client.js';
import { markKnown } from '../shared/delta-store.js';
import { getCityIdByName } from '../shared/city-config.js';
import type { PipelineLeadInput, CategoryGuess } from '../shared/types.js';
import type { FacebookPlace } from './types.js';
import { mapFacebookCategory } from './lead-transformer.js';
import { PLACE_FIELDS } from './config.js';

const log = createLogger('fb-quick-entry');

// --- Page ID Extraction ---

function extractPageIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\//, '').replace(/\/$/, '');

    // ?id=123456
    if (parsed.searchParams.has('id')) {
      return parsed.searchParams.get('id');
    }

    // /pages/PageName/123456 or /groups/123456
    const segments = path.split('/');
    if (['pages'].includes(segments[0]) && segments.length >= 3) {
      return segments[2];
    }

    // Skip non-page paths
    if (['groups', 'events', 'marketplace', 'watch', 'reel'].includes(segments[0])) {
      return null;
    }

    // /pagename or /profile.php → use path as ID
    return segments[0] || null;
  } catch {
    return null;
  }
}

// --- Quick Entry ---

interface QuickEntryArgs {
  url: string;
  name?: string;
  category?: CategoryGuess;
  city?: string;
  group?: string;
}

async function quickEntry(args: QuickEntryArgs): Promise<void> {
  const pageId = extractPageIdFromUrl(args.url);
  log.info(`Page ID: ${pageId || '(could not extract)'}`);

  // Enrich via Graph API if possible
  let pageDetails: Partial<FacebookPlace> = {};
  if (pageId && config.meta.pageToken) {
    try {
      pageDetails = await withRetry(() =>
        graphApiGet<FacebookPlace>(
          pageId,
          { fields: PLACE_FIELDS },
          config.meta.pageToken,
        ),
      );
      log.info(
        `Enriched: ${pageDetails.name}, fans: ${pageDetails.fan_count ?? 'n/a'}`,
      );
    } catch (error) {
      log.warn(
        `Could not enrich page ${pageId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  // Build lead (merge manual + enriched data)
  const lead: PipelineLeadInput = {
    source: 'facebook',
    source_id: pageDetails.id || pageId || undefined,
    source_url: args.url,
    name: pageDetails.name || args.name || null,
    address: pageDetails.single_line_address || null,
    city: args.city || 'Hoi An',
    category_guess:
      args.category || mapFacebookCategory(pageDetails as FacebookPlace),
    phone: pageDetails.phone || null,
    website: pageDetails.website || null,
    facebook: args.url,
    raw_data: {
      entry_type: 'manual_quick_entry',
      found_in_group: args.group || null,
      fb_enriched: !!pageDetails.id,
      fb_details: pageDetails,
    },
  };

  // Push to pipeline
  const result = await pushLead(lead);

  if (result.duplicate) {
    log.info(`Skipped: "${lead.name}" already in pipeline (duplicate)`);
  } else if (result.success) {
    log.info(`Pushed: "${lead.name}" → pipeline (${result.id})`);

    // Mark as known in delta store
    if (lead.source_id) {
      await markKnown([
        {
          source: 'facebook',
          sourceId: lead.source_id,
          city: lead.city || 'Hoi An',
          cityId: lead.city_id || getCityIdByName(lead.city || 'Hoi An')!,
          name: lead.name || undefined,
        },
      ]);
    }
  } else {
    log.error(`Failed to push "${lead.name}": ${result.error}`);
  }
}

// --- CLI ---

function parseArgs(): QuickEntryArgs {
  const args = process.argv.slice(2);

  const flagValue = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  const url = flagValue('--url');
  if (!url) {
    console.log('Usage:');
    console.log(
      '  npx tsx src/facebook-scout/quick-entry.ts --url <facebook-url> [options]',
    );
    console.log('');
    console.log('Options:');
    console.log('  --url <url>          Facebook page/profile URL (required)');
    console.log('  --name <name>        Business name (auto-detected if possible)');
    console.log('  --category <cat>     restaurants | cafes | bars | hotels');
    console.log('  --city <city>        City name (default: Hoi An)');
    console.log('  --group <group>      Facebook group where you found it');
    process.exit(1);
  }

  return {
    url,
    name: flagValue('--name'),
    category: flagValue('--category') as CategoryGuess | undefined,
    city: flagValue('--city'),
    group: flagValue('--group'),
  };
}

async function main() {
  const args = parseArgs();
  await quickEntry(args);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
