-- ============================================
-- known_places: raw_data Spalte hinzufuegen
-- Speichert vollstaendige API-Responses
-- Manuell in Supabase SQL Editor ausführen!
-- ============================================

ALTER TABLE known_places
  ADD COLUMN IF NOT EXISTS raw_data JSONB;

COMMENT ON COLUMN known_places.raw_data IS 'Vollstaendige API-Response der Detail-Abfrage. Enthaelt tier, fetched_at, und alle Fields.';
