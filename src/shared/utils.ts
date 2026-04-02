// ===========================================
// Shared Utilities
// ===========================================

import type { CategoryGuess } from './types.js';

/**
 * Extract a human-readable message from any thrown value.
 * Handles standard Errors, Supabase PostgrestError objects, and primitives.
 */
export function errorToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: string }).message);
  }
  return String(err);
}

/**
 * Sleep for a given number of milliseconds.
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// --- Category Guessing ---

const CATEGORY_KEYWORDS: Array<[RegExp, CategoryGuess]> = [
  [/\b(restaurant|eatery|dining|bistro|kitchen|cuisine|chef|food|nhà hàng|quán ăn|bếp|ăn)\b/i, 'restaurants'],
  [/\b(cafe|café|coffee|cà phê|quán cà phê|bakery|pastry|brunch|tea|tiệm bánh)\b/i, 'cafes'],
  [/\b(bar|pub|cocktail|nightclub|lounge|beer|wine|nightlife|bia|rượu|quán bar|quán nhậu)\b/i, 'bars'],
  [/\b(hotel|resort|hostel|homestay|accommodation|villa|lodge|inn|guest\s*house|khách sạn|nhà nghỉ)\b/i, 'hotels'],
];

/**
 * Guess the business category from free text (title, caption, description).
 * Returns the first matching category or null.
 */
export function guessCategory(text: string): CategoryGuess | null {
  const lower = text.toLowerCase();
  for (const [pattern, category] of CATEGORY_KEYWORDS) {
    if (pattern.test(lower)) return category;
  }
  return null;
}
