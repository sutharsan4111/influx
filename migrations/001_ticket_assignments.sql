-- =====================================================
-- TICKET ASSIGNMENTS TABLE
-- Stores multi-agent assignments for Zoho Desk tickets
-- =====================================================

-- Create the ticket_assignments table
CREATE TABLE IF NOT EXISTS ticket_assignments (
    id SERIAL PRIMARY KEY,
    
    -- Zoho Desk ticket reference
    zoho_ticket_id VARCHAR(50) NOT NULL UNIQUE,
    zoho_ticket_number VARCHAR(50),
    zoho_department_id VARCHAR(50),
    
    -- Assignment info (supports multiple agents)
    assigned_users TEXT[] NOT NULL DEFAULT '{}',    -- Array of user emails
    primary_assignee VARCHAR(255) NOT NULL,          -- First user = synced to Zoho
    assigned_by VARCHAR(255) NOT NULL,
    assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Reassignment tracking
    reassigned_user VARCHAR(255),                    -- New primary after reassignment
    reassigned_at TIMESTAMP WITH TIME ZONE,
    reassigned_by VARCHAR(255),
    
    -- Ticket status
    status VARCHAR(50) NOT NULL DEFAULT 'Open',
    closed_at TIMESTAMP WITH TIME ZONE,
    closed_by VARCHAR(255),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_ticket_assignments_zoho_ticket_id 
    ON ticket_assignments(zoho_ticket_id);

CREATE INDEX IF NOT EXISTS idx_ticket_assignments_primary_assignee 
    ON ticket_assignments(primary_assignee);

CREATE INDEX IF NOT EXISTS idx_ticket_assignments_status 
    ON ticket_assignments(status);

CREATE INDEX IF NOT EXISTS idx_ticket_assignments_assigned_at 
    ON ticket_assignments(assigned_at DESC);

-- GIN index for array search (find all tickets assigned to a specific user)
CREATE INDEX IF NOT EXISTS idx_ticket_assignments_assigned_users 
    ON ticket_assignments USING GIN(assigned_users);

-- =====================================================
-- TRIGGER: Auto-update updated_at timestamp
-- =====================================================
CREATE OR REPLACE FUNCTION update_ticket_assignments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_ticket_assignments_updated_at ON ticket_assignments;

CREATE TRIGGER trigger_update_ticket_assignments_updated_at
    BEFORE UPDATE ON ticket_assignments
    FOR EACH ROW
    EXECUTE FUNCTION update_ticket_assignments_updated_at();

-- =====================================================
-- SAMPLE QUERIES (for reference)
-- =====================================================

-- Get all tickets assigned to a specific user:
-- SELECT * FROM ticket_assignments WHERE $1 = ANY(assigned_users);

-- Get assignment by Zoho ticket ID:
-- SELECT * FROM ticket_assignments WHERE zoho_ticket_id = $1;

-- Bulk insert/update assignments:
-- INSERT INTO ticket_assignments (zoho_ticket_id, assigned_users, primary_assignee, assigned_by)
-- VALUES ($1, $2, $3, $4)
-- ON CONFLICT (zoho_ticket_id) DO UPDATE SET
--     assigned_users = EXCLUDED.assigned_users,
--     primary_assignee = EXCLUDED.primary_assignee,
--     reassigned_user = ticket_assignments.primary_assignee,
--     reassigned_at = NOW(),
--     reassigned_by = EXCLUDED.assigned_by;
