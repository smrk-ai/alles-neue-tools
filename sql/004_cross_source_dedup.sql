-- ============================================
-- P3: Cross-Source Dedup via Name-Matching
-- Manuell in Supabase SQL Editor ausführen!
-- ============================================

-- 1. Canonical ID für Cross-Source-Verknüpfung
--    Zeigt auf den "Haupt-Eintrag" (bevorzugt Google Maps).
--    Wenn canonical_id gesetzt ist, wurde dieser Eintrag als Duplikat erkannt.
ALTER TABLE known_places
  ADD COLUMN IF NOT EXISTS canonical_id UUID REFERENCES known_places(id) ON DELETE SET NULL;

-- 2. Normalisierter Name für schnelles Cross-Source-Matching
--    Diakritika entfernt, lowercase, Hotel-Suffixe gestrippt.
ALTER TABLE known_places
  ADD COLUMN IF NOT EXISTS name_normalized TEXT;

-- 3. Index für Cross-Source-Kandidaten-Lookup:
--    "Alle Einträge dieser Stadt + Kategorie mit normalisiertem Namen"
CREATE INDEX IF NOT EXISTS idx_known_places_city_cat_name
  ON known_places(city_id, category) WHERE name_normalized IS NOT NULL;

-- 4. Index für Canonical-Gruppierung (alle Quellen eines Places)
CREATE INDEX IF NOT EXISTS idx_known_places_canonical
  ON known_places(canonical_id) WHERE canonical_id IS NOT NULL;
