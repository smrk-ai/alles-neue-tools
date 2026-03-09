import * as fs from 'fs';
import { pushLeads } from '../shared/pipeline-client.js';
import { createLogger } from '../shared/logger.js';
import type { PipelineLeadInput, CategoryGuess, LeadSource } from '../shared/types.js';

const log = createLogger('prompt-import');

// --- Types ---

interface ImportOptions {
  file?: string;
  stdin: boolean;
  dryRun: boolean;
  source?: LeadSource;
  skipConfirm: boolean;
}

// --- Arg Parsing ---

function parseArgs(argv: string[]): ImportOptions {
  const args = argv.slice(2);

  const flagValue = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  return {
    file: flagValue('--file'),
    stdin: args.includes('--stdin'),
    dryRun: args.includes('--dry-run'),
    source: flagValue('--source') as LeadSource | undefined,
    skipConfirm: args.includes('--yes') || args.includes('-y'),
  };
}

// --- Stdin Reader ---

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// --- Normalizers ---

function normalizeCategory(cat: string | undefined): CategoryGuess | null {
  if (!cat) return null;
  const lower = cat.toLowerCase().trim();

  if (/restaurant|food|dining|eatery/.test(lower)) return 'restaurants';
  if (/cafe|café|coffee|bakery|brunch/.test(lower)) return 'cafes';
  if (/bar|pub|cocktail|nightclub|lounge/.test(lower)) return 'bars';
  if (/hotel|resort|hostel|motel|homestay|guest/.test(lower)) return 'hotels';

  // Direct match for exact category names
  if (lower === 'restaurants' || lower === 'cafes' || lower === 'bars' || lower === 'hotels') {
    return lower as CategoryGuess;
  }

  return null;
}

function normalizeInstagram(ig: string | undefined): string | null {
  if (!ig) return null;
  if (ig.startsWith('@')) return `https://instagram.com/${ig.slice(1)}`;
  if (ig.includes('instagram.com')) return ig;
  return `https://instagram.com/${ig}`;
}

function normalizeInput(raw: unknown, sourceOverride?: LeadSource): PipelineLeadInput[] {
  let items: unknown[] | undefined;

  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.results)) items = obj.results;
    else if (Array.isArray(obj.leads)) items = obj.leads;
    else if (Array.isArray(obj.data)) items = obj.data;
  }

  if (!items) {
    throw new Error('Expected JSON array or object with results/leads/data array');
  }

  return items.map((item) => {
    // Format C: String-only
    if (typeof item === 'string') {
      return {
        source: sourceOverride || 'prompt_scout',
        name: item,
        city: 'Hoi An',
        raw_data: {
          entry_type: 'prompt_import',
          import_date: new Date().toISOString(),
        },
      } satisfies PipelineLeadInput;
    }

    // Format A & B: Objects
    const obj = item as Record<string, unknown>;
    return {
      source: sourceOverride || (obj.source as LeadSource) || 'prompt_scout',
      source_url: (obj.source_url || obj.url || obj.link || null) as string | null,
      source_id: (obj.source_id || null) as string | null,
      name: (obj.name || obj.title || null) as string | null,
      address: (obj.address || obj.location || null) as string | null,
      city: (obj.city as string) || 'Hoi An',
      category_guess: normalizeCategory(
        (obj.category || obj.category_guess || obj.type) as string | undefined,
      ),
      description: (obj.description || obj.notes || null) as string | null,
      instagram: normalizeInstagram((obj.instagram || obj.ig) as string | undefined),
      facebook: (obj.facebook || obj.fb || null) as string | null,
      website: (obj.website || null) as string | null,
      phone: (obj.phone || null) as string | null,
      google_maps_url: (obj.google_maps_url || obj.maps_url || null) as string | null,
      raw_data: {
        entry_type: 'prompt_import',
        import_date: new Date().toISOString(),
        confidence: (obj.confidence as string) || null,
        sources: (obj.sources as unknown[]) || [],
        original_data: obj,
      },
    } satisfies PipelineLeadInput;
  });
}

// --- Main Logic ---

async function importLeads(options: ImportOptions): Promise<void> {
  // 1. Load JSON
  let rawContent: string;
  if (options.stdin) {
    rawContent = await readStdin();
  } else if (options.file) {
    rawContent = await fs.promises.readFile(options.file, 'utf-8');
  } else {
    console.error('Error: Specify --file <path> or --stdin');
    console.error('Usage: npm run import -- --file results.json [--dry-run] [--source prompt_scout]');
    process.exit(1);
  }

  // 2. Parse JSON
  let rawData: unknown;
  try {
    rawData = JSON.parse(rawContent);
  } catch {
    console.error('Error: Invalid JSON input.');
    process.exit(1);
  }

  // 3. Normalize
  const normalized = normalizeInput(rawData, options.source);

  if (normalized.length === 0) {
    console.log('No leads found in input.');
    return;
  }

  // 4. Preview
  console.log(`\n📋 Found ${normalized.length} leads:\n`);
  for (let i = 0; i < normalized.length; i++) {
    const lead = normalized[i];
    const cat = lead.category_guess ? ` [${lead.category_guess}]` : '';
    const conf =
      lead.raw_data?.confidence ? ` (${lead.raw_data.confidence})` : '';
    console.log(`  ${i + 1}. ${lead.name}${cat}${conf}`);
    if (lead.source_url) console.log(`     📎 ${lead.source_url}`);
  }

  // 5. Dry run exit
  if (options.dryRun) {
    console.log(`\n🔍 DRY RUN — nothing sent. Use without --dry-run to import.`);
    return;
  }

  // 6. Confirmation
  if (!options.skipConfirm) {
    const rl = (await import('readline')).createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await new Promise<string>((resolve) =>
      rl.question(`\nImport ${normalized.length} leads? (y/N) `, resolve),
    );
    rl.close();
    if (answer.toLowerCase() !== 'y') {
      console.log('Cancelled.');
      return;
    }
  }

  // 7. Push to pipeline (batch with concurrency)
  const results = await pushLeads(normalized);

  let success = 0;
  let duplicates = 0;
  let errors = 0;

  for (let i = 0; i < normalized.length; i++) {
    const lead = normalized[i];
    const result = results[i];
    if (result.duplicate) {
      console.log(`  ⏭️  ${lead.name} (duplicate)`);
      duplicates++;
    } else if (result.success) {
      console.log(`  ✅ ${lead.name}`);
      success++;
    } else {
      console.log(`  ❌ ${lead.name}: ${result.error}`);
      errors++;
    }
  }

  // 8. Summary
  console.log(
    `\n📊 Import complete: ${success} new, ${duplicates} duplicates, ${errors} errors`,
  );
}

// --- CLI Entry Point ---

async function main() {
  const options = parseArgs(process.argv);
  await importLeads(options);
}

main().catch((err) => {
  log.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
