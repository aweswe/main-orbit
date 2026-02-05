-- ============================================
-- SQL Migration: Multi-File & Smart Planner
-- ============================================

-- RATIONALE:
-- 1. project_structures: Extends project memory to store AI requirements and UI/UX plans.
-- 2. generated_files: Switches from 'one string' storage to 'proper file tree' storage.
-- 3. file_dependencies: Enables 'surgical editing' by knowing what components import others.
-- 4. generation_logs: Essential for debugging the 10-layer compiler pipeline.

-- 1. Project Structures Table
CREATE TABLE IF NOT EXISTS project_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requirements JSONB,
  confidence_score INTEGER,
  uiux_plan JSONB,
  file_plan JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Generated Files Table
CREATE TABLE IF NOT EXISTS generated_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  file_type TEXT NOT NULL,
  exports JSONB,
  estimated_lines INTEGER,
  actual_lines INTEGER,
  generation_attempts INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(project_id, path)
);

-- 3. File Dependencies Table
CREATE TABLE IF NOT EXISTS file_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES generated_files(id) ON DELETE CASCADE,
  depends_on_path TEXT NOT NULL,
  import_names JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Generation Logs Table
CREATE TABLE IF NOT EXISTS generation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  data JSONB,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_project_structures_project ON project_structures(project_id);
CREATE INDEX IF NOT EXISTS idx_generated_files_project ON generated_files(project_id);
CREATE INDEX IF NOT EXISTS idx_file_dependencies_file ON file_dependencies(file_id);
CREATE INDEX IF NOT EXISTS idx_generation_logs_project ON generation_logs(project_id);

-- Enable RLS
ALTER TABLE project_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_logs ENABLE ROW LEVEL SECURITY;

-- Basic RLS Policies (Assuming projects.user_id exists)
CREATE POLICY "Users can access their own project structures"
  ON project_structures FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

CREATE POLICY "Users can access their own generated files"
  ON generated_files FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

CREATE POLICY "Users can access their own file dependencies"
  ON file_dependencies FOR ALL
  USING (file_id IN (SELECT id FROM generated_files WHERE project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())));

CREATE POLICY "Users can access their own generation logs"
  ON generation_logs FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
