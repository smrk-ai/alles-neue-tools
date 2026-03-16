// ===========================================
// Shared Types – alles-neue-tools
// ===========================================

// --- Lead Sources ---

export type LeadSource =
  | 'facebook'
  | 'google_maps'
  | 'instagram'
  | 'manual'
  | 'google_alert'
  | 'foursquare'
  | 'osm'
  | 'foody'
  | 'tripadvisor'
  | 'booking'
  | 'agoda'
  | 'prompt_scout'
  | 'job_posting'
  | 'other';

export type CategoryGuess = 'restaurants' | 'bars' | 'cafes' | 'hotels';

// --- Pipeline ---

// Keep in sync with: alles-neue/lib/validations/pipeline.ts (Zod schema)
export interface PipelineLeadInput {
  source: LeadSource;
  source_url?: string | null;
  source_id?: string | null;
  name?: string | null;
  address?: string | null;
  city?: string | null;
  city_id?: string;
  category_guess?: CategoryGuess | null;
  description?: string | null;
  photos?: string[] | null;
  google_maps_url?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  website?: string | null;
  phone?: string | null;
  lat?: number | null;
  lng?: number | null;
  raw_data?: Record<string, unknown> | null;
}

export interface PipelineResult {
  success: boolean;
  id?: string;
  status?: string;
  duplicate?: boolean;
  error?: string;
}

// --- City Config ---

export interface Hotspot {
  name: string;
  boundary: [number, number][]; // [lng, lat] pairs (GeoJSON order)
  resolution: number;
}

export interface CityConfig {
  id: string; // UUID from cities table
  name: string;
  slug: string;
  country: string;
  boundary: [number, number][]; // [lng, lat] pairs (GeoJSON order)
  resolution: number;
  categories: string[];
  hotspots?: Hotspot[];
}

// --- Tool Runner ---

export interface ToolRunOptions {
  toolSlug: string;
  city: string;
  dryRun?: boolean;
}

export interface ToolRunReport {
  toolSlug: string;
  city: string;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  leadsFound: number;
  leadsNew: number;
  leadsPushed: number;
  errors: string[];
  status: 'success' | 'partial' | 'failed';
}

// --- Delta Store ---

export interface DeltaEntry {
  source: string;
  sourceId: string;
}

export interface DeltaMarkEntry extends DeltaEntry {
  city: string;
  cityId: string;
  h3Cell?: string;
  name?: string;
  category?: CategoryGuess;
  subType?: string;
  rawData?: Record<string, unknown>;
}

export interface DeltaStats {
  total: number;
  bySource: Record<string, number>;
}

// --- Cross-Source Matching (P3) ---

export interface CrossMatchResult {
  entry: DeltaMarkEntry;
  matchedWith: {
    id: string;
    canonicalId: string;
    name: string;
    source: string;
    score: number;
  };
}

// --- API Budget ---

export type ApiSku =
  | 'text_search_ids_only'
  | 'place_details_pro'
  | 'place_details_essentials';

export interface BudgetStatus {
  sku: ApiSku;
  month: string;
  callsUsed: number;
  callsLimit: number;
  callsSafety: number;
  remaining: number;
  exhausted: boolean;
  usagePercent: number;
}

export type DetailTier = 'place_details_pro' | 'place_details_essentials' | 'queued';
