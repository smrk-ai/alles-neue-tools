import type { AlertFeedConfig } from './types.js';

// ===========================================
// Google Alerts Feed Configuration
// ===========================================
//
// HOW TO GET RSS URLs:
// 1. Go to https://www.google.com/alerts
// 2. For each alert, click the pencil icon to edit
// 3. Change "Deliver to" to "RSS Feed"
// 4. Copy the RSS feed URL
// 5. Paste it into the rssUrl field below
//
// Feeds with empty rssUrl are silently skipped.

export const ALERT_FEEDS: AlertFeedConfig[] = [
  // === HOI AN – ENGLISH ===
  {
    id: 'hoi-an-new-restaurant-en',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    label: 'Hoi An – new restaurant (EN)',
    rssUrl: 'https://www.google.com/alerts/feeds/10738861831827583242/2059467545724917847',
    categoryHint: 'restaurants',
  },
  {
    id: 'hoi-an-new-cafe-en',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    label: 'Hoi An – new cafe (EN)',
    rssUrl: 'https://www.google.com/alerts/feeds/10738861831827583242/15268281944514589174',
    categoryHint: 'cafes',
  },
  {
    id: 'hoi-an-new-bar-en',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    label: 'Hoi An – new bar (EN)',
    rssUrl: 'https://www.google.com/alerts/feeds/10738861831827583242/18368022192445582982',
    categoryHint: 'bars',
  },
  {
    id: 'hoi-an-new-hotel-en',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    label: 'Hoi An – new hotel (EN)',
    rssUrl: 'https://www.google.com/alerts/feeds/10738861831827583242/18368022192445579402',
    categoryHint: 'hotels',
  },
  {
    id: 'hoi-an-grand-opening-en',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    label: 'Hoi An – grand opening (EN)',
    rssUrl: 'https://www.google.com/alerts/feeds/10738861831827583242/6655413129665227443',
  },
  {
    id: 'hoi-an-just-opened-en',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    label: 'Hoi An – just opened (EN)',
    rssUrl: 'https://www.google.com/alerts/feeds/10738861831827583242/15268281944514589444',
  },
  {
    id: 'hoi-an-opening-2026-en',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    label: 'Hoi An – restaurant opening 2026 (EN)',
    rssUrl: 'https://www.google.com/alerts/feeds/10738861831827583242/15268281944514591163',
    categoryHint: 'restaurants',
  },

  // === DA NANG – ENGLISH ===
  {
    id: 'da-nang-new-restaurant-en',
    city: 'Da Nang',
    citySlug: 'da-nang',
    label: 'Da Nang – new restaurant (EN)',
    rssUrl: 'https://www.google.com/alerts/feeds/10738861831827583242/18368022192445582404',
    categoryHint: 'restaurants',
  },
  {
    id: 'da-nang-new-cafe-en',
    city: 'Da Nang',
    citySlug: 'da-nang',
    label: 'Da Nang – new cafe (EN)',
    rssUrl: 'https://www.google.com/alerts/feeds/10738861831827583242/14700359413613634230',
    categoryHint: 'cafes',
  },
  {
    id: 'da-nang-opening-2026-en',
    city: 'Da Nang',
    citySlug: 'da-nang',
    label: 'Da Nang – restaurant opening 2026 (EN)',
    rssUrl: 'https://www.google.com/alerts/feeds/10738861831827583242/7463082457581341766',
    categoryHint: 'restaurants',
  },

  // === HOI AN – VIETNAMESE ===
  {
    id: 'hoi-an-khai-truong-vi',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    label: 'Hoi An – khai trương (VI)',
    rssUrl: 'https://www.google.com/alerts/feeds/10738861831827583242/18368022192445582218',
  },
  {
    id: 'hoi-an-quan-moi-vi',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    label: 'Hoi An – quán mới (VI)',
    rssUrl: 'https://www.google.com/alerts/feeds/10738861831827583242/14700359413613635994',
  },
  {
    id: 'hoi-an-nha-hang-moi-vi',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    label: 'Hoi An – nhà hàng mới (VI)',
    rssUrl: 'https://www.google.com/alerts/feeds/10738861831827583242/7463082457581339510',
    categoryHint: 'restaurants',
  },
  {
    id: 'hoi-an-khach-san-moi-vi',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    label: 'Hoi An – khách sạn mới (VI)',
    rssUrl: 'https://www.google.com/alerts/feeds/10738861831827583242/16147454685451588124',
    categoryHint: 'hotels',
  },
  {
    id: 'hoi-an-moi-mo-vi',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    label: 'Hoi An – mới mở (VI)',
    rssUrl: 'https://www.google.com/alerts/feeds/10738861831827583242/14700359413613637589',
  },

  // === DA NANG – VIETNAMESE ===
  {
    id: 'da-nang-khai-truong-vi',
    city: 'Da Nang',
    citySlug: 'da-nang',
    label: 'Da Nang – khai trương (VI)',
    rssUrl: 'https://www.google.com/alerts/feeds/10738861831827583242/7463082457581340818',
  },
  {
    id: 'da-nang-quan-moi-vi',
    city: 'Da Nang',
    citySlug: 'da-nang',
    label: 'Da Nang – quán mới (VI)',
    rssUrl: 'https://www.google.com/alerts/feeds/10738861831827583242/16147454685451588457',
  },
  {
    id: 'da-nang-nha-hang-moi-vi',
    city: 'Da Nang',
    citySlug: 'da-nang',
    label: 'Da Nang – nhà hàng mới (VI)',
    rssUrl: 'https://www.google.com/alerts/feeds/10738861831827583242/14700359413613637104',
    categoryHint: 'restaurants',
  },
];

export function getFeedsForCity(citySlug: string): AlertFeedConfig[] {
  if (citySlug === 'all') return ALERT_FEEDS;
  return ALERT_FEEDS.filter((f) => f.citySlug === citySlug);
}
