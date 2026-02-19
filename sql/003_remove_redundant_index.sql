-- ============================================
-- DB Audit Fix #3: Remove redundant index
-- The UNIQUE(source, source_id) constraint already
-- creates an implicit B-tree index. This explicit
-- index is a 1:1 duplicate wasting storage and
-- slowing down writes.
-- ============================================

DROP INDEX IF EXISTS idx_known_places_source_id;
