import type { CategoryGuess } from '../shared/types.js';

// --- Sitemap Source Configuration ---

export interface SitemapSourceConfig {
  id: string;                    // 'ta-hoi-an-restaurants'
  platform: 'tripadvisor';
  city: string;                  // 'Hoi An'
  citySlug: string;              // 'hoi-an'
  category: CategoryGuess;
  sitemapIndexUrl: string;       // URL of the sitemap index XML
  subSitemapPattern: RegExp;     // Filter: which sub-sitemaps to load
  urlPattern: RegExp;            // Filter: which URLs from sub-sitemaps are relevant
  locationId: string;            // TripAdvisor location ID (e.g. 'g298082')
}

// --- Sitemap Entries ---

export interface SitemapEntry {
  loc: string;                   // URL
  lastmod?: string;              // ISO date string
}

// --- Enriched Entry ---

export interface EnrichedEntry {
  url: string;
  platform: 'tripadvisor';
  city: string;
  citySlug: string;
  category: CategoryGuess;
  name: string | null;           // Extracted from URL slug
  platformId: string | null;     // e.g. 'd25123456'
}

// --- CLI Options ---

export interface SitemapMinerOptions {
  city: string;                  // 'hoi-an' | 'da-nang' | 'all'
  dryRun: boolean;
  verbose: boolean;
  configId?: string;             // Optional: run only a specific config
}
