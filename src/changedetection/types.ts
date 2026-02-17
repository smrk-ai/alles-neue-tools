import type { CategoryGuess, LeadSource } from '../shared/types.js';

// --- Snapshot Parser Types ---

export type SnapshotParserType =
  | 'tripadvisor_listing'
  | 'foody_listing'
  | 'booking_listing'
  | 'job_listing'
  | 'commercial_listing';

// --- Watch Configuration ---

export interface WatchConfig {
  uuid: string;                    // changedetection.io watch UUID (set after setup)
  id: string;                      // human-readable ID, e.g. 'tripadvisor-restaurants-hoian'
  label: string;                   // 'TripAdvisor Restaurants Hoi An'
  url: string;                     // The watched URL
  city: string;                    // 'Hoi An'
  citySlug: string;                // 'hoi-an'
  categoryHint?: CategoryGuess;
  leadSource: LeadSource;
  parser: SnapshotParserType;
  checkIntervalHours: number;
}

// --- changedetection.io API Response Types ---

export interface CDWatchSummary {
  url: string;
  title: string;
  last_changed: number;          // Unix timestamp
  last_checked: number;          // Unix timestamp
  last_error: boolean | string;
  paused: boolean;
  tag: string;
}

export interface CDWatchHistory {
  [timestamp: string]: string;   // Unix timestamp -> file path
}

// --- Parsed Items ---

export interface ParsedChangeItem {
  externalId: string;            // Unique ID from source (URL slug, name hash, etc.)
  name: string;                  // Business/listing name
  url?: string;                  // Link to the listing
  address?: string;
  category?: CategoryGuess;
  rawText?: string;              // Original text snippet for debugging
}

// --- Tool Options ---

export interface CDToolOptions {
  city: string;
  dryRun: boolean;
  verbose: boolean;
  forceCheck: boolean;           // Ignore lookback window, process all recent snapshots
}
