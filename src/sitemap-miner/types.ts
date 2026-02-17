import type { CategoryGuess } from '../shared/types.js';

// --- Supported Platforms ---

export type SitemapPlatform = 'tripadvisor' | 'booking' | 'agoda';

// --- Sitemap Source Configuration ---

export interface SitemapSourceConfig {
  id: string;                    // 'booking-hoi-an-hotels'
  platform: SitemapPlatform;
  city: string;                  // 'Hoi An'
  citySlug: string;              // 'hoi-an'
  category: CategoryGuess;
  sitemapIndexUrl: string;       // URL of the sitemap index XML
  subSitemapPattern: RegExp;     // Filter: which sub-sitemaps to load
  urlPattern: RegExp;            // Filter: which URLs from sub-sitemaps are relevant
  gzip?: boolean;                // Sub-sitemaps are .xml.gz (e.g. Booking.com)
}

// --- Sitemap Entries ---

export interface SitemapEntry {
  loc: string;                   // URL
  lastmod?: string;              // ISO date string
}

// --- Enriched Entry ---

export interface EnrichedEntry {
  url: string;
  platform: SitemapPlatform;
  city: string;
  citySlug: string;
  category: CategoryGuess;
  name: string | null;           // Extracted from URL slug
  platformId: string | null;     // e.g. 'hoi-an-golden-rice-villa'
}

// --- CLI Options ---

export interface SitemapMinerOptions {
  city: string;                  // 'hoi-an' | 'da-nang' | 'all'
  dryRun: boolean;
  verbose: boolean;
  configId?: string;             // Optional: run only a specific config
}
