import type { CategoryGuess } from '../shared/types.js';

// --- Graph API Place Response ---

export interface FacebookPlace {
  id: string;
  name: string;
  location?: {
    city?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
    street?: string;
    zip?: string;
  };
  category?: string;
  category_list?: Array<{ id: string; name: string }>;
  single_line_address?: string;
  phone?: string;
  website?: string;
  link?: string;
  fan_count?: number;
  about?: string;
  hours?: Record<string, string>;
  emails?: string[];
}

// --- Search Config ---

export interface FacebookSearchConfig {
  center: { lat: number; lng: number };
  distance: number;
  query: string;
}

// --- Scan Result ---

export interface FacebookScanResult {
  places: FacebookPlace[];
  totalSearches: number;
  errors: string[];
}

// --- Tool Options ---

export interface FacebookToolOptions {
  city: string;
  dryRun: boolean;
  checkTokens: boolean;
  verbose: boolean;
}

// --- Category Mapping ---

export type { CategoryGuess };
