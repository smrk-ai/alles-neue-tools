// ===========================================
// Google Maps Discovery Tool – Types
// ===========================================

// --- Google Places API Response Types ---

export interface PlaceBasicDetails {
  id: string;
  displayName?: {
    text: string;
    languageCode: string;
  };
  formattedAddress?: string;
  location?: {
    latitude: number;
    longitude: number;
  };
  types: string[];
  businessStatus?: string;
  googleMapsUri?: string;
  primaryType?: string;
  primaryTypeDisplayName?: {
    text: string;
    languageCode: string;
  };
  rating?: number;
  userRatingCount?: number;
  photos?: Array<{
    name: string;
    widthPx?: number;
    heightPx?: number;
  }>;
}

// --- Grid Scanner Types ---

export interface GridScanResult {
  city: string;
  cellsScanned: number;
  totalIdsFound: number;
  uniqueIdsFound: number;
  idsByCategory: Record<string, number>;
  /** Actual ID sets per search category (e.g. 'lodging' → Set of place IDs) */
  idSetsByCategory: Record<string, string[]>;
  idsByCell: Record<string, string[]>;
  allUniqueIds: string[];
  durationMs: number;
  errors: ScanError[];
}

export interface ScanError {
  cellId: string;
  category: string;
  error: string;
  retried: boolean;
}

// --- Delta Detector Types ---

export interface DeltaResult {
  city: string;
  scanDate: string;
  totalScanned: number;
  knownIds: number;
  newIds: string[];
  newCount: number;
}

// --- Places Client Types ---

export interface TextSearchParams {
  lat: number;
  lng: number;
  radius: number;
  includedType: string;
}

// --- Error ---

export class PlacesApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public apiError?: unknown,
  ) {
    super(message);
    this.name = 'PlacesApiError';
  }
}

// --- Tool Options ---

export interface GoogleMapsToolOptions {
  city: string;
  dryRun: boolean;
  baselineOnly: boolean;
  verbose: boolean;
  toolSlug?: string;
}
