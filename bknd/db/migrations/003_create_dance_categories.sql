CREATE TABLE IF NOT EXISTS dance_categories (
  dance_id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  source_file_name VARCHAR(255) NOT NULL,
  reference_video_url TEXT NOT NULL,
  reference_skeleton_path TEXT NOT NULL,
  duration_seconds INTEGER,
  sort_order INTEGER NOT NULL UNIQUE,
  variant_capacity INTEGER NOT NULL DEFAULT 10 CHECK (variant_capacity >= 0),
  analysis_status VARCHAR(32) NOT NULL DEFAULT 'PENDING_ANALYSIS',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dance_categories_sort_order_idx
  ON dance_categories (sort_order);
