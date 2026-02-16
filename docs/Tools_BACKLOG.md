# Tools Backlog

Discovery-Tools für newaround.com — was als nächstes gebaut wird und was verschoben wurde.

---

## Phase 3 — Nächste Prioritäten

| # | Tool | Beschreibung | Aufwand |
|---|------|-------------|---------|
| T2 | Google Alerts Aggregator | RSS-Feeds von Google Alerts parsen → neue Businesses erkennen → Pipeline | ~3 Std |
| T3 | Sitemap Delta Miner | Sitemaps von TripAdvisor/Foody.vn crawlen, neue URLs erkennen → Pipeline | ~3 Std |
| T4 | OSM Changeset Monitor | Overpass API abfragen, neue POIs in Hoi An erkennen → Pipeline | ~1.5 Std |
| T5 | changedetection.io Setup | Self-hosted Change-Detection für relevante Webseiten (Listings, Directories) | ~1 Std |

---

## Phase 4 — Social Media Scouts

| Tool | Beschreibung | Status |
|------|-------------|--------|
| Facebook Scout | Facebook Pages/Groups nach neuen Businesses in Hoi An durchsuchen | Geplant |
| Instagram Scout | Instagram Location-Tags und Hashtags nach neuen Businesses scannen | Geplant |

---

## Verschoben / Nice-to-have

| Tool | Grund für Verschiebung |
|------|----------------------|
| Foursquare Scanner | Google deckt Vietnam gut ab, Foursquare hat dort wenig Mehrwert |
| Enrichment (Phone/Website/Hours) | Enterprise Tier ($35-40/1000 Calls), nicht nötig für Lead-Erkennung |
| Da Nang Scan | Erst Hoi An perfektionieren, dann auf weitere Städte expandieren |

---

## Erledigt

| Phase | Was | Status |
|-------|-----|--------|
| Phase 0 | Shared Infrastructure (config, logger, h3-grid, delta-store, pipeline-client, tool-runner) | Erledigt |
| Phase 2 | Google Maps Discovery Tool (Grid-Scan, Delta Detection, Lead Transform, Baseline 2.514 Places) | Erledigt |
