-- Assets Pages feature for CloudOps
-- Pages, columns, rows, and custom pages management

-- Main pages table (all pages are created by users — no defaults are seeded)
CREATE TABLE IF NOT EXISTS cloudops_asset_pages (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    description TEXT,
    is_system_page BOOLEAN NOT NULL DEFAULT FALSE,
    page_order INTEGER NOT NULL DEFAULT 0,
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(name)
);

-- Columns for each page (user-defined columns)
CREATE TABLE IF NOT EXISTS cloudops_asset_page_columns (
    id SERIAL PRIMARY KEY,
    page_id INTEGER NOT NULL REFERENCES cloudops_asset_pages(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    data_type VARCHAR(50) NOT NULL DEFAULT 'text', -- text, number, date, boolean, select, email, url
    column_order INTEGER NOT NULL DEFAULT 0,
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    default_value TEXT,
    select_options JSONB, -- For select type: array of options
    validation_regex TEXT,
    is_visible BOOLEAN NOT NULL DEFAULT TRUE,
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(page_id, name)
);

-- Rows/data for each page
CREATE TABLE IF NOT EXISTS cloudops_asset_page_rows (
    id SERIAL PRIMARY KEY,
    page_id INTEGER NOT NULL REFERENCES cloudops_asset_pages(id) ON DELETE CASCADE,
    row_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    row_order INTEGER NOT NULL DEFAULT 0,
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Remove default pages seeded by earlier versions of this app (Master Page, Rental Laptop, Issued Laptop)
DELETE FROM cloudops_asset_pages WHERE name IN ('master', 'rental-laptop', 'issued-laptop') AND is_system_page = TRUE;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_cloudops_asset_pages_is_system ON cloudops_asset_pages(is_system_page);
CREATE INDEX IF NOT EXISTS idx_cloudops_asset_pages_order ON cloudops_asset_pages(page_order);
CREATE INDEX IF NOT EXISTS idx_cloudops_asset_page_columns_page_id ON cloudops_asset_page_columns(page_id);
CREATE INDEX IF NOT EXISTS idx_cloudops_asset_page_columns_order ON cloudops_asset_page_columns(page_id, column_order);
CREATE INDEX IF NOT EXISTS idx_cloudops_asset_page_rows_page_id ON cloudops_asset_page_rows(page_id);
CREATE INDEX IF NOT EXISTS idx_cloudops_asset_page_rows_order ON cloudops_asset_page_rows(page_id, row_order);
