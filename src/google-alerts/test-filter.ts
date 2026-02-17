import { fetchAllFeeds } from './rss-parser.js';
import { scoreItem } from './relevance-filter.js';
import { ALERT_FEEDS } from './config.js';

async function main() {
  const items = await fetchAllFeeds(ALERT_FEEDS);
  const scored = items.map(scoreItem).sort((a, b) => b.score - a.score);

  console.log(`\n=== ALL ${scored.length} ITEMS SCORED (new 3-pillar filter) ===\n`);

  const passing = scored.filter(s => s.score >= 3);
  console.log(`--- PASSING (score >= 3): ${passing.length} items ---\n`);
  for (const s of passing) {
    console.log(`  [${s.score}] ${s.item.title.substring(0, 80)}`);
    console.log(`       ${s.signals.join(', ')}\n`);
  }

  const failing = scored.filter(s => s.score < 3);
  console.log(`--- FILTERED OUT (score < 3): ${failing.length} items ---\n`);
  for (const s of failing) {
    console.log(`  [${s.score}] ${s.item.title.substring(0, 80)}`);
  }

  console.log(`\n=== SUMMARY: ${passing.length} pass / ${failing.length} filtered / ${scored.length} total ===`);
}

main();
