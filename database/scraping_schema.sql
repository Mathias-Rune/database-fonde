CREATE TABLE IF NOT EXISTS scrape_runs (
  run_id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  targets_checked INTEGER NOT NULL DEFAULT 0,
  changed_pages INTEGER NOT NULL DEFAULT 0,
  changes_detected INTEGER NOT NULL DEFAULT 0,
  auto_approved INTEGER NOT NULL DEFAULT 0,
  manual_review INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  CHECK (status IN ('running', 'completed', 'failed'))
);

CREATE TABLE IF NOT EXISTS scrape_snapshots (
  snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  foundation_id TEXT NOT NULL,
  url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  http_status INTEGER,
  content_hash TEXT,
  content_text TEXT,
  changed_since_last INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  FOREIGN KEY (run_id) REFERENCES scrape_runs(run_id),
  FOREIGN KEY (foundation_id) REFERENCES foundations(foundation_id)
);

CREATE INDEX IF NOT EXISTS idx_scrape_snapshots_foundation ON scrape_snapshots(foundation_id);
CREATE INDEX IF NOT EXISTS idx_scrape_snapshots_hash ON scrape_snapshots(foundation_id, url, content_hash);

CREATE TABLE IF NOT EXISTS foundation_extracted_fields (
  foundation_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  field_value TEXT NOT NULL,
  source_url TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (foundation_id, field_name),
  FOREIGN KEY (foundation_id) REFERENCES foundations(foundation_id)
);

CREATE TABLE IF NOT EXISTS foundation_field_changes (
  change_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  foundation_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  source_url TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  significance TEXT NOT NULL DEFAULT 'medium',
  validation_status TEXT NOT NULL DEFAULT 'manual_review',
  detected_at TEXT NOT NULL,
  decided_at TEXT,
  decision_note TEXT,
  FOREIGN KEY (run_id) REFERENCES scrape_runs(run_id),
  FOREIGN KEY (foundation_id) REFERENCES foundations(foundation_id),
  CHECK (field_name IN ('deadlines', 'funding_amounts', 'contact_info', 'purpose_criteria')),
  CHECK (significance IN ('low', 'medium', 'high')),
  CHECK (validation_status IN ('approved_auto', 'manual_review', 'approved_manual', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_field_changes_status ON foundation_field_changes(validation_status);
CREATE INDEX IF NOT EXISTS idx_field_changes_foundation ON foundation_field_changes(foundation_id);
CREATE INDEX IF NOT EXISTS idx_field_changes_detected ON foundation_field_changes(detected_at);

CREATE TABLE IF NOT EXISTS scrape_notifications (
  notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  error_message TEXT,
  FOREIGN KEY (run_id) REFERENCES scrape_runs(run_id),
  CHECK (status IN ('queued', 'sent', 'failed', 'disabled'))
);
