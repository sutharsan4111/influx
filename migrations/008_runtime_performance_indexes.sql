-- 008_runtime_performance_indexes.sql
-- Production performance: indexes covering hot lookups used by /api/tickets,
-- /api/tickets/counts and /api/tickets/:id/conversations.
-- All indexes are created IF NOT EXISTS so the migration is idempotent.

-- Active (open/in-progress) assignments lookup used by counts endpoint.
CREATE INDEX IF NOT EXISTS idx_ticket_assignments_status_open
  ON ticket_assignments (status)
  WHERE status IS NULL OR LOWER(status) NOT IN ('closed', 'resolved');

-- ANY(assigned_users) membership tests in counts/tickets endpoints.
CREATE INDEX IF NOT EXISTS idx_ticket_assignments_assigned_users_gin
  ON ticket_assignments USING GIN (assigned_users);

-- Primary assignee filter used by user-scoped tickets list.
CREATE INDEX IF NOT EXISTS idx_ticket_assignments_primary_assignee
  ON ticket_assignments (primary_assignee);

-- Direct ticket id lookup (UNIQUE constraint usually exists, but guarantee btree).
CREATE INDEX IF NOT EXISTS idx_ticket_assignments_zoho_ticket_id
  ON ticket_assignments (zoho_ticket_id);

-- Recycle-bin "active" filter used on every counts and tickets request.
CREATE INDEX IF NOT EXISTS idx_recycled_tickets_active
  ON recycled_tickets (zoho_ticket_id)
  WHERE restored_at IS NULL;

-- reply_authors batched lookup by conversation id (ANY($1)).
CREATE INDEX IF NOT EXISTS idx_reply_authors_conv_id
  ON reply_authors (zoho_conversation_id);

-- Composite for ticket+conversation lookups.
CREATE INDEX IF NOT EXISTS idx_reply_authors_ticket_conv
  ON reply_authors (zoho_ticket_id, zoho_conversation_id);

-- Refresh planner stats so the new indexes are picked up immediately.
ANALYZE ticket_assignments;
ANALYZE recycled_tickets;
ANALYZE reply_authors;
