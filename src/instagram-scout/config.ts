import type { HashtagConfig } from './types.js';

// --- Hashtag Tiers (30 unique per 7 days) ---

// Tier 1: Direct "New" hashtags (7 tags — checked daily)
export const TIER_1_HASHTAGS: HashtagConfig[] = [
  { tag: 'hoiannew', priority: 'daily', city: 'Hoi An' },
  { tag: 'hoianopening', priority: 'daily', city: 'Hoi An' },
  { tag: 'newinhoian', priority: 'daily', city: 'Hoi An' },
  { tag: 'hoian2026', priority: 'daily', city: 'Hoi An' },
  { tag: 'hoianfoodscene', priority: 'daily', city: 'Hoi An' },
  { tag: 'hoiangrandopening', priority: 'daily', city: 'Hoi An' },
  { tag: 'newinchoian', priority: 'daily', city: 'Hoi An' },
];

// Tier 2: Category-specific (12 tags — rotating by day)
export const TIER_2_HASHTAGS: HashtagConfig[] = [
  { tag: 'hoianrestaurant', priority: 'weekly', city: 'Hoi An', categoryHint: 'restaurants' },
  { tag: 'hoianfood', priority: 'weekly', city: 'Hoi An', categoryHint: 'restaurants' },
  { tag: 'hoiandining', priority: 'weekly', city: 'Hoi An', categoryHint: 'restaurants' },
  { tag: 'hoianfoodie', priority: 'weekly', city: 'Hoi An', categoryHint: 'restaurants' },
  { tag: 'hoiancafe', priority: 'weekly', city: 'Hoi An', categoryHint: 'cafes' },
  { tag: 'hoiancoffee', priority: 'weekly', city: 'Hoi An', categoryHint: 'cafes' },
  { tag: 'hoianbrunch', priority: 'weekly', city: 'Hoi An', categoryHint: 'cafes' },
  { tag: 'hoianbar', priority: 'weekly', city: 'Hoi An', categoryHint: 'bars' },
  { tag: 'hoiannightlife', priority: 'weekly', city: 'Hoi An', categoryHint: 'bars' },
  { tag: 'hoiancocktails', priority: 'weekly', city: 'Hoi An', categoryHint: 'bars' },
  { tag: 'hoianboutiquehotel', priority: 'weekly', city: 'Hoi An', categoryHint: 'hotels' },
  { tag: 'hoianstay', priority: 'weekly', city: 'Hoi An', categoryHint: 'hotels' },
];

// Tier 3: Vietnamese (5 tags — rotating)
export const TIER_3_HASHTAGS: HashtagConfig[] = [
  { tag: 'hoianquanmoi', priority: 'weekly', city: 'Hoi An' },
  { tag: 'quanmoihoian', priority: 'weekly', city: 'Hoi An' },
  { tag: 'khaitruonghoian', priority: 'weekly', city: 'Hoi An' },
  { tag: 'hoianmoi', priority: 'weekly', city: 'Hoi An' },
  { tag: 'hoianvietnam', priority: 'weekly', city: 'Hoi An' },
];

// Tier 4: Location tags (6 tags — weekly)
export const TIER_4_HASHTAGS: HashtagConfig[] = [
  { tag: 'hoianoldtown', priority: 'weekly', city: 'Hoi An' },
  { tag: 'ancienttown', priority: 'weekly', city: 'Hoi An' },
  { tag: 'anbangbeach', priority: 'weekly', city: 'Hoi An' },
  { tag: 'camnam', priority: 'weekly', city: 'Hoi An' },
  { tag: 'hoianbeach', priority: 'weekly', city: 'Hoi An' },
  { tag: 'hoianriverside', priority: 'weekly', city: 'Hoi An' },
];

// Weekly schedule: which tier-2/3/4 hashtags on which day
// Mo: Tier 2 Restaurant (4)  → 11/30
// Di: Tier 2 Cafe (3)        → 14/30
// Mi: Tier 2 Bar (3) + Tier 3 (2) → 19/30
// Do: Tier 2 Hotel (2) + Tier 3 (3) → 24/30
// Fr: Tier 4 (6)             → 30/30
// Sa-So: Tier 1 only (already counted)
export const WEEKLY_SCHEDULE: Record<number, HashtagConfig[]> = {
  1: TIER_2_HASHTAGS.filter((h) => h.categoryHint === 'restaurants'),
  2: TIER_2_HASHTAGS.filter((h) => h.categoryHint === 'cafes'),
  3: [
    ...TIER_2_HASHTAGS.filter((h) => h.categoryHint === 'bars'),
    ...TIER_3_HASHTAGS.slice(0, 2),
  ],
  4: [
    ...TIER_2_HASHTAGS.filter((h) => h.categoryHint === 'hotels'),
    ...TIER_3_HASHTAGS.slice(2),
  ],
  5: TIER_4_HASHTAGS,
  // 6 (Sat) and 0 (Sun): no new hashtags
};

// --- Opening Keywords ---

export const OPENING_SIGNALS = {
  en_strong: [
    'grand opening',
    'now open',
    'we are open',
    'doors are open',
    'opening day',
    'ribbon cutting',
    'opening ceremony',
  ],
  en_medium: [
    'just opened',
    'newly opened',
    'soft opening',
    'opening soon',
    'come visit us',
    'first day',
    'welcome to our new',
  ],
  en_weak: [
    'new place',
    'new spot',
    'new restaurant',
    'new cafe',
    'new bar',
    'check out',
    'excited to announce',
  ],
  vi_strong: [
    'khai trương',
    'chính thức mở cửa',
    'khai trương quán',
  ],
  vi_medium: [
    'mới mở',
    'mới khai trương',
    'quán mới',
    'vừa mở',
  ],
  negative: [
    'closed',
    'closing',
    'last day',
    'goodbye',
    'farewell',
    'throwback',
    'tbt',
    'memory',
    'anniversary',
    'đóng cửa',
    'tạm đóng',
  ],
  emojis: ['🎉', '🎊', '🥂', '✨', '🆕', '📍', '🏠', '🍽️', '☕', '🍸'],
};

// Name extraction patterns
export const NAME_PATTERNS = [
  /welcome to (.+?)(?:!|\.|\n|$)/i,
  /(.+?) is now open/i,
  /introducing (.+?)(?:!|\.|\n|$)/i,
  /khai trương (.+?)(?:!|\.|\n|$)/i,
  /grand opening of (.+?)(?:!|\.|\n|$)/i,
];

// Minimum confidence threshold for considering a post as a new business
export const MIN_CONFIDENCE = 0.3;
