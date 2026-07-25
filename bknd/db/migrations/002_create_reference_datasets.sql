CREATE TABLE IF NOT EXISTS reference_datasets (
  dance_id VARCHAR(64) PRIMARY KEY,
  schema_version VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  source_video_count INTEGER NOT NULL CHECK (source_video_count > 0),
  motion_count INTEGER NOT NULL CHECK (motion_count > 0),
  generated_at TIMESTAMPTZ,
  dataset JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reference_datasets_dataset_gin
  ON reference_datasets USING GIN (dataset);
