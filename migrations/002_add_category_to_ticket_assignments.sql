-- =====================================================
-- ADD CATEGORY TO TICKET ASSIGNMENTS
-- =====================================================

ALTER TABLE IF EXISTS ticket_assignments
  ADD COLUMN IF NOT EXISTS category VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_ticket_assignments_category
  ON ticket_assignments(category);
