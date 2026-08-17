ALTER TABLE design_layouts
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS design_layouts_project_revision_idx
  ON design_layouts (project_id, revision);
