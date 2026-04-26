-- ============= DATABASE PERFORMANCE INDEXES =============
-- Run these commands on your PostgreSQL database to improve query performance
-- File: 006_performance_indexes.sql

-- Index for ticket assignment lookups (frequently queried by primary_assignee)
CREATE INDEX IF NOT EXISTS idx_ticket_assignments_primary_assignee 
  ON ticket_assignments(LOWER(primary_assignee)) 
  WHERE status IS NULL OR LOWER(status) NOT IN ('closed', 'resolved');

-- Index for recycled ticket lookups (check if ticket is deleted)
CREATE INDEX IF NOT EXISTS idx_recycled_tickets_zoho_ticket_id 
  ON recycled_tickets(zoho_ticket_id) 
  WHERE restored_at IS NULL;

-- Index for reply author lookups (get author info from conversation ID)
CREATE INDEX IF NOT EXISTS idx_reply_authors_conversation 
  ON reply_authors(zoho_conversation_id);

-- Index for IHUB asset lookups  
CREATE INDEX IF NOT EXISTS idx_ihub_assets_email 
  ON ihub_assets(LOWER(responsible_person_email));

-- Index for SSL asset lookups
CREATE INDEX IF NOT EXISTS idx_ssl_assets_email 
  ON ssl_assets(LOWER(responsible_person_email));

-- Index for alert tickets status lookups
CREATE INDEX IF NOT EXISTS idx_ihub_alert_status 
  ON ihub_alert_tickets(status) 
  WHERE status != 'Closed';

CREATE INDEX IF NOT EXISTS idx_ssl_alert_status 
  ON ssl_expiry_alert_tickets(status) 
  WHERE status != 'Closed';

-- Composite index for ticket count queries
CREATE INDEX IF NOT EXISTS idx_ticket_assignments_composite
  ON ticket_assignments(LOWER(primary_assignee), status, created_at)
  WHERE status IS NULL OR LOWER(status) NOT IN ('closed', 'resolved');
