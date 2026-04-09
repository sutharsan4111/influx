CREATE TABLE IF NOT EXISTS reply_authors (
  id SERIAL PRIMARY KEY,
  zoho_ticket_id TEXT NOT NULL,
  zoho_conversation_id TEXT NOT NULL UNIQUE,
  user_email TEXT NOT NULL,
  user_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reply_authors_ticket ON reply_authors(zoho_ticket_id);
