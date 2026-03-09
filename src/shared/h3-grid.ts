import { polygonToCells, cellToLatLng, cellToParent, cellToChildren, getResolution } from 'h3-js';
import type { CityConfig, Hotspot } from './types.js';

/**
 * Generate H3 cells that cover a city's boundary polygon.
 */
export function generateScanCells(city: CityConfig): string[] {
  // polygonToCells expects [lat, lng] pairs when isGeoJson=false
  // Our boundaries are [lng, lat] (GeoJSON), so set isGeoJson=true
  const cells = polygonToCells(
    [city.boundary],
    city.resolution,
    true // isGeoJson: coordinates are [lng, lat]
  );
  return cells;
}

/**
 * Generate H3 cells for a hotspot at its higher resolution.
 */
export function getHotspotCells(hotspot: Hotspot): string[] {
  return polygonToCells(
    [hotspot.boundary],
    hotspot.resolution,
    true
  );
}

/**
 * Get the center point of an H3 cell.
 */
export function getCellCenter(cellId: string): { lat: number; lng: number } {
  const [lat, lng] = cellToLatLng(cellId);
  return { lat, lng };
}

/**
 * Merge main cells with hotspot cells.
 * Removes parent cells from mainCells that are covered by higher-resolution hotspot children.
 */
export function mergeCells(
  mainCells: string[],
  hotspotCells: string[],
  mainResolution: number
): string[] {
  // Find which main-resolution parents are covered by hotspot cells
  const coveredParents = new Set<string>();
  for (const cell of hotspotCells) {
    const parent = cellToParent(cell, mainResolution);
    if (parent) coveredParents.add(parent);
  }

  // Remove covered parents, add hotspot cells instead
  const filtered = mainCells.filter((cell) => !coveredParents.has(cell));
  return [...filtered, ...hotspotCells];
}

/**
 * Get the 7 child cells of an H3 cell at the next resolution level.
 */
export function getChildCells(cellId: string): string[] {
  const res = getResolution(cellId);
  return cellToChildren(cellId, res + 1);
}

/**
 * Generate all scan cells for a city, including hotspot refinements.
 */
export function getAllScanCells(city: CityConfig): string[] {
  const mainCells = generateScanCells(city);

  if (!city.hotspots || city.hotspots.length === 0) {
    return mainCells;
  }

  const allHotspotCells = city.hotspots.flatMap(getHotspotCells);

  return mergeCells(mainCells, allHotspotCells, city.resolution);
}
