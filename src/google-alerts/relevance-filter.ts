import type { ParsedFeedItem, ScoredItem } from './types.js';

// --- Signal Dictionaries ---

const HIGH_VALUE_SIGNALS = [
  'grand opening', 'soft opening', 'now open', 'just opened', 'newly opened',
  'khai trương', 'mới khai trương', 'vừa khai trương', 'vừa mở cửa',
];

const POSITIVE_SIGNALS = [
  // English
  'new', 'opening', 'open', 'opens', 'opened', 'launch', 'launches', 'launched',
  'debuts', 'unveils', 'ribbon cutting', 'first day',
  'restaurant', 'cafe', 'café', 'coffee', 'bar', 'pub', 'hotel', 'resort', 'hostel',
  'bistro', 'rooftop', 'lounge', 'eatery', 'dining', 'cocktail',
  // Vietnamese
  'mới', 'mới mở', 'ra mắt', 'chính thức mở cửa',
  'nhà hàng', 'quán ăn', 'quán cà phê', 'cà phê', 'khách sạn', 'quán bar',
];

const NEGATIVE_SIGNALS = [
  // Off-topic: closures
  'closed', 'closing', 'permanently closed', 'shutting down', 'đóng cửa',
  // Off-topic: listicles / travel guides
  'review of', 'best restaurants in', 'top 10', 'guide to', 'things to do',
  'must visit', 'travel guide', 'bucket list',
  // Off-topic: recipes / food content
  'recipe', 'cook at home', 'menu ideas',
  // Off-topic: jobs / B2B
  'job', 'jobs', 'hiring', 'vacancy', 'career', 'wholesale', 'supply', 'import', 'export',
  // Off-topic: delivery / old venues
  'delivery', 'order online',
];

const HIGH_VALUE_DOMAINS = [
  'saigoneer.com', 'vietnamcoracle.com', 'hanoigrapevine.com',
  'danangfantasticcity.vn', 'baodanang.vn',
  'tuoitre.vn', 'thanhnien.vn', 'vnexpress.net', 'vietnamtimes.vn',
];

const LOW_VALUE_DOMAINS = [
  'pinterest.com', 'youtube.com', 'amazon.com', 'ebay.com',
  'tripadvisor.com', 'yelp.com', 'zomato.com',
  'booking.com', 'agoda.com', 'expedia.com',
];

// --- Scoring ---

export function scoreItem(item: ParsedFeedItem): ScoredItem {
  const text = `${item.title} ${item.snippet}`.toLowerCase();
  let score = 0;
  const signals: string[] = [];

  // High-value signals first (+2 each)
  for (const s of HIGH_VALUE_SIGNALS) {
    if (text.includes(s)) {
      score += 2;
      signals.push(`+2:${s}`);
    }
  }

  // Positive signals (+1 each, skip if already matched as high-value)
  for (const s of POSITIVE_SIGNALS) {
    if (text.includes(s) && !HIGH_VALUE_SIGNALS.includes(s)) {
      score += 1;
      signals.push(`+1:${s}`);
    }
  }

  // Negative signals (-2 each)
  for (const s of NEGATIVE_SIGNALS) {
    if (text.includes(s)) {
      score -= 2;
      signals.push(`-2:${s}`);
    }
  }

  // Domain bonuses/penalties
  try {
    const domain = new URL(item.realUrl).hostname.replace(/^www\./, '');
    if (HIGH_VALUE_DOMAINS.some((d) => domain.endsWith(d))) {
      score += 2;
      signals.push(`+2:domain:${domain}`);
    } else if (LOW_VALUE_DOMAINS.some((d) => domain.endsWith(d))) {
      score -= 1;
      signals.push(`-1:domain:${domain}`);
    }
  } catch {
    // invalid URL
  }

  return { item, score, signals };
}

export function filterRelevant(items: ParsedFeedItem[], minScore: number): ScoredItem[] {
  return items
    .map(scoreItem)
    .filter((s) => s.score >= minScore);
}
