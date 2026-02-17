// ===========================================
// Google Alerts Aggregator – Types
// ===========================================

import type { CategoryGuess } from '../shared/types.js';

// --- Feed Configuration ---

export interface AlertFeedConfig {
  id: string;
  city: string;
  citySlug: string;
  label: string;
  rssUrl: string;
  categoryHint?: CategoryGuess;
}

// --- Parsed Atom Entry ---

export interface ParsedFeedItem {
  guid: string;
  title: string;
  snippet: string;
  realUrl: string;
  feedId: string;
  citySlug: string;
  cityName: string;
  categoryHint?: CategoryGuess;
  publishedAt: string;
  sourceTitle?: string;
}

// --- Relevance Score ---

export interface ScoredItem {
  item: ParsedFeedItem;
  score: number;
  signals: string[];
}

// --- CLI Options ---

export interface AlertsToolOptions {
  city: string;
  dryRun: boolean;
  minScore: number;
  verbose: boolean;
}
