import { errorToString } from '../shared/utils.js';
import { pushLead } from '../shared/pipeline-client.js';
import { createLogger } from '../shared/logger.js';
import type { PipelineLeadInput, CategoryGuess, LeadSource } from '../shared/types.js';

const log = createLogger('quick-entry');

// --- Types ---

interface QuickEntryArgs {
  name: string;
  category?: CategoryGuess;
  source?: LeadSource;
  url?: string;
  address?: string;
  city?: string;
  phone?: string;
  instagram?: string;
  facebook?: string;
  website?: string;
  notes?: string;
  dryRun?: boolean;
}

// --- Arg Parsing ---

function parseArgs(argv: string[]): QuickEntryArgs {
  const args = argv.slice(2);
  const flags = new Map<string, string>();
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].replace('--', '');
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
      flags.set(key, value);
      if (value !== 'true') i++;
    } else {
      positional.push(args[i]);
    }
  }

  return {
    name: flags.get('name') || positional[0] || '',
    category: (flags.get('category') || flags.get('cat') || positional[1]) as CategoryGuess | undefined,
    source: (flags.get('source') as LeadSource) || 'manual',
    url: flags.get('url'),
    address: flags.get('address'),
    city: flags.get('city') || 'Hoi An',
    phone: flags.get('phone'),
    instagram: flags.get('instagram') || flags.get('ig'),
    facebook: flags.get('facebook') || flags.get('fb'),
    website: flags.get('website'),
    notes: flags.get('notes'),
    dryRun: flags.has('dry-run'),
  };
}

// --- Interactive Mode ---

async function interactiveEntry(): Promise<QuickEntryArgs> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve));

  const name = await ask('Name: ');
  const category = await ask('Category (restaurants/cafes/bars/hotels): ');
  const url = await ask('URL (optional, Enter to skip): ');
  const notes = await ask('Notes (optional, Enter to skip): ');

  rl.close();

  return {
    name,
    category: (category as CategoryGuess) || undefined,
    url: url || undefined,
    notes: notes || undefined,
  };
}

// --- Main Logic ---

async function quickEntry(args: QuickEntryArgs): Promise<void> {
  if (!args.name) {
    console.error('Error: Name is required.');
    console.error('Usage: npm run q "Name" [category] [--url ...] [--notes ...]');
    process.exit(1);
  }

  const lead: PipelineLeadInput = {
    source: args.source || 'manual',
    source_url: args.url || null,
    name: args.name,
    address: args.address || null,
    city: args.city || 'Hoi An',
    category_guess: args.category || null,
    phone: args.phone || null,
    instagram: args.instagram || null,
    facebook: args.facebook || null,
    website: args.website || null,
    description: args.notes || null,
    raw_data: {
      entry_type: 'quick_entry_cli',
      entry_date: new Date().toISOString(),
      notes: args.notes || null,
    },
  };

  if (args.dryRun) {
    console.log('\n🔍 DRY RUN — would push:\n');
    console.log(JSON.stringify(lead, null, 2));
    return;
  }

  const result = await pushLead(lead);

  if (result.duplicate) {
    console.log(`⏭️  "${args.name}" → Duplicate (already in pipeline)`);
  } else if (result.success) {
    console.log(`✅ "${args.name}" → Pipeline (ID: ${result.id})`);
  } else {
    console.log(`❌ "${args.name}" → Error: ${result.error}`);
    process.exit(1);
  }
}

// --- CLI Entry Point ---

async function main() {
  const parsed = parseArgs(process.argv);

  // No arguments at all → interactive mode
  const args = parsed.name ? parsed : await interactiveEntry();

  await quickEntry(args);
}

main().catch((err) => {
  log.error(`Fatal error: ${errorToString(err)}`);
  process.exit(1);
});
