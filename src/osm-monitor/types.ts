// ===========================================
// OSM Changeset Monitor – Types
// ===========================================

import type { CategoryGuess } from '../shared/types.js';

// --- Overpass API Response ---

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags: Record<string, string>;
  timestamp?: string;
  version?: number;
  center?: { lat: number; lon: number };
}

// --- Query Configuration ---

/** Bounding box in Overpass format: [south, west, north, east] */
export type Bbox = [number, number, number, number];

export interface OverpassQueryConfig {
  bbox: Bbox;
  daysBack: number;
  onlyNew: boolean;
}

// --- CLI Options ---

export interface OsmMonitorOptions {
  city: string;
  dryRun: boolean;
  days: number;
  onlyNew: boolean;
  verbose: boolean;
}
