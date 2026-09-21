CREATE TABLE IF NOT EXISTS cloudops_projects (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'Open',
  owner_email VARCHAR(255),
  owner_name VARCHAR(255),
  created_by VARCHAR(255),
  updated_by VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE cloudops_projects ADD COLUMN IF NOT EXISTS owner_email VARCHAR(255);
ALTER TABLE cloudops_projects ADD COLUMN IF NOT EXISTS owner_name VARCHAR(255);

CREATE TABLE IF NOT EXISTS cloudops_project_members (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES cloudops_projects(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  role VARCHAR(50) NOT NULL DEFAULT 'member',
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, email)
);

CREATE TABLE IF NOT EXISTS cloudops_tasks (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES cloudops_projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'Open',
  assigned_to TEXT[] NOT NULL DEFAULT '{}',
  created_by VARCHAR(255),
  updated_by VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cloudops_task_assignees (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES cloudops_tasks(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(task_id, email)
);

CREATE INDEX IF NOT EXISTS idx_cloudops_projects_status ON cloudops_projects(status);
CREATE INDEX IF NOT EXISTS idx_cloudops_tasks_project_id ON cloudops_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_cloudops_tasks_status ON cloudops_tasks(status);
CREATE INDEX IF NOT EXISTS idx_cloudops_project_members_project_id ON cloudops_project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_cloudops_project_members_email ON cloudops_project_members(email);
CREATE INDEX IF NOT EXISTS idx_cloudops_task_assignees_task_id ON cloudops_task_assignees(task_id);
CREATE INDEX IF NOT EXISTS idx_cloudops_task_assignees_email ON cloudops_task_assignees(email);
