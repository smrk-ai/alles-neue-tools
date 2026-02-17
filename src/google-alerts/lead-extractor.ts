import type { CategoryGuess, PipelineLeadInput } from '../shared/types.js';
import type { ScoredItem } from './types.js';

// --- Business Name Extraction ---

const GENERIC_PHRASES = [
  'new', 'grand opening', 'opening', 'soft opening', 'khai trương',
  'restaurant', 'cafe', 'bar', 'hotel', 'review', 'update',
];

function isGenericPhrase(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return GENERIC_PHRASES.some((p) => lower === p || lower.startsWith(p + ' '));
}

export function extractBusinessName(title: string): string | null {
  // Strategy 1: Text inside quotes
  const quotedMatch = title.match(/["\u201C\u201D]([^"\u201C\u201D]{2,60})["\u201C\u201D]/);
  if (quotedMatch) return quotedMatch[1].trim();

  // Strategy 2: Text before colon
  const colonMatch = title.match(/^([^:]{3,60}):/);
  if (colonMatch) {
    const candidate = colonMatch[1].trim();
    if (!isGenericPhrase(candidate)) return candidate;
  }

  // Strategy 3: Text before dash separator
  const dashMatch = title.match(/^(.{3,60})\s[-\u2013\u2014]\s/);
  if (dashMatch) {
    const candidate = dashMatch[1].trim();
    if (!isGenericPhrase(candidate)) return candidate;
  }

  return null;
}

// --- Category Guessing ---

const CATEGORY_KEYWORDS: Array<[string[], CategoryGuess]> = [
  [['restaurant', 'eatery', 'dining', 'bistro', 'nhà hàng', 'quán ăn'], 'restaurants'],
  [['cafe', 'café', 'coffee', 'cà phê', 'quán cà phê', 'bakery', 'tiệm bánh'], 'cafes'],
  [['bar', 'pub', 'cocktail', 'nightclub', 'lounge', 'quán bar'], 'bars'],
  [['hotel', 'resort', 'hostel', 'homestay', 'khách sạn', 'nhà nghỉ', 'guest house', 'villa'], 'hotels'],
];

export function guessCategory(text: string): CategoryGuess | null {
  const lower = text.toLowerCase();
  for (const [keywords, category] of CATEGORY_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k))) return category;
  }
  return null;
}

// --- Lead Extraction ---

export function extractLead(scored: ScoredItem): PipelineLeadInput {
  const { item } = scored;
  const combinedText = `${item.title} ${item.snippet}`;

  return {
    source: 'google_alert',
    source_id: item.guid,
    source_url: item.realUrl,
    name: extractBusinessName(item.title),
    city: item.cityName,
    category_guess: item.categoryHint ?? guessCategory(combinedText),
    description: item.snippet.substring(0, 500) || null,
    website: item.realUrl || null,
    raw_data: {
      feed_id: item.feedId,
      title: item.title,
      snippet: item.snippet,
      published_at: item.publishedAt,
      source_title: item.sourceTitle ?? null,
      relevance_score: scored.score,
      relevance_signals: scored.signals,
    },
  };
}

export function extractLeads(scoredItems: ScoredItem[]): PipelineLeadInput[] {
  return scoredItems.map(extractLead);
}
