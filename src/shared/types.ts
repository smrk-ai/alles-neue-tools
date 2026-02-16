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
  | 'prompt_scout'
  | 'job_posting'
  | 'other';

export type CategoryGuess = 'restaurants' | 'bars' | 'cafes' | 'hotels';

// --- Pipeline ---

export interface PipelineLeadInput {
  source: LeadSource;
  source_url?: string | null;
  source_id?: string | null;
  name?: string | null;
  address?: string | null;
  city?: string;
  category_guess?: CategoryGuess | null;
  description?: string | null;
  photos?: string[] | null;
  google_maps_url?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  website?: string | null;
  phone?: string | null;
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
  h3Cell?: string;
  name?: string;
}

export interface DeltaStats {
  total: number;
  bySource: Record<string, number>;
}
