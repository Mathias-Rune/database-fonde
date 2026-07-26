DROP VIEW IF EXISTS foundation_search;
DROP VIEW IF EXISTS program_search;
DROP TABLE IF EXISTS notification_events;
DROP TABLE IF EXISTS favorite_foundations;
DROP TABLE IF EXISTS notification_subscriptions;
DROP TABLE IF EXISTS call_scan_results;
DROP TABLE IF EXISTS deadlines;
DROP TABLE IF EXISTS programs;
DROP TABLE IF EXISTS foundations;

CREATE TABLE foundations (
  foundation_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  legal_type TEXT,
  regulator TEXT,
  country TEXT NOT NULL DEFAULT 'Danmark',
  city TEXT,
  website TEXT,
  application_url TEXT,
  support_areas TEXT,
  applicant_types TEXT,
  deadline_model TEXT,
  notes TEXT,
  source_url TEXT,
  last_checked TEXT,
  verification_status TEXT NOT NULL DEFAULT 'to_verify',
  CHECK (verification_status IN ('source_checked', 'to_verify', 'needs_update'))
);

CREATE INDEX idx_foundations_name ON foundations(name);
CREATE INDEX idx_foundations_legal_type ON foundations(legal_type);
CREATE INDEX idx_foundations_city ON foundations(city);
CREATE INDEX idx_foundations_deadline_model ON foundations(deadline_model);
CREATE INDEX idx_foundations_verification_status ON foundations(verification_status);

CREATE TABLE programs (
  program_id TEXT PRIMARY KEY,
  foundation_id TEXT NOT NULL,
  program_name TEXT NOT NULL,
  program_type TEXT,
  support_areas TEXT,
  applicant_types TEXT,
  geography TEXT,
  funding_use TEXT,
  amount_range TEXT,
  application_status TEXT,
  deadline_summary TEXT,
  application_url TEXT,
  source_url TEXT,
  last_checked TEXT,
  verification_status TEXT NOT NULL DEFAULT 'to_verify',
  notes TEXT,
  FOREIGN KEY (foundation_id) REFERENCES foundations(foundation_id) ON DELETE CASCADE,
  CHECK (verification_status IN ('source_checked', 'to_verify', 'needs_update'))
);

CREATE INDEX idx_programs_foundation_id ON programs(foundation_id);
CREATE INDEX idx_programs_program_type ON programs(program_type);
CREATE INDEX idx_programs_application_status ON programs(application_status);
CREATE INDEX idx_programs_verification_status ON programs(verification_status);

CREATE TABLE deadlines (
  deadline_id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  deadline_type TEXT,
  status TEXT NOT NULL DEFAULT 'to_verify',
  opens_on TEXT,
  closes_on TEXT,
  recurrence TEXT,
  summary TEXT,
  last_checked TEXT,
  verification_status TEXT NOT NULL DEFAULT 'to_verify',
  FOREIGN KEY (program_id) REFERENCES programs(program_id) ON DELETE CASCADE,
  CHECK (status IN ('open', 'closed', 'upcoming', 'to_verify')),
  CHECK (verification_status IN ('source_checked', 'to_verify', 'needs_update'))
);

CREATE INDEX idx_deadlines_program_id ON deadlines(program_id);
CREATE INDEX idx_deadlines_status ON deadlines(status);
CREATE INDEX idx_deadlines_type ON deadlines(deadline_type);
CREATE INDEX idx_deadlines_closes_on ON deadlines(closes_on);

CREATE TABLE call_scan_results (
  scan_result_id TEXT PRIMARY KEY,
  foundation_id TEXT NOT NULL,
  program_id TEXT,
  foundation_name TEXT,
  program_name TEXT,
  scan_url TEXT NOT NULL,
  scan_status TEXT NOT NULL DEFAULT 'pending',
  match_type TEXT,
  discovered_title TEXT,
  discovered_url TEXT,
  excerpt TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  contact_source_url TEXT,
  scanned_at TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'new',
  FOREIGN KEY (foundation_id) REFERENCES foundations(foundation_id) ON DELETE CASCADE,
  FOREIGN KEY (program_id) REFERENCES programs(program_id) ON DELETE CASCADE,
  CHECK (scan_status IN ('found', 'no_match', 'error')),
  CHECK (review_status IN ('new', 'reviewed', 'ignored'))
);

CREATE INDEX idx_call_scan_results_foundation_id ON call_scan_results(foundation_id);
CREATE INDEX idx_call_scan_results_program_id ON call_scan_results(program_id);
CREATE INDEX idx_call_scan_results_status ON call_scan_results(scan_status);
CREATE INDEX idx_call_scan_results_review_status ON call_scan_results(review_status);
CREATE INDEX idx_call_scan_results_scanned_at ON call_scan_results(scanned_at);

CREATE TABLE notification_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  notify_deadline_soon INTEGER NOT NULL DEFAULT 1,
  notify_new_foundation INTEGER NOT NULL DEFAULT 1,
  notify_new_call INTEGER NOT NULL DEFAULT 1,
  notify_favorite_update INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_notification_subscriptions_email ON notification_subscriptions(email);

CREATE TABLE favorite_foundations (
  favorite_id TEXT PRIMARY KEY,
  subscription_id TEXT,
  foundation_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (subscription_id) REFERENCES notification_subscriptions(subscription_id) ON DELETE CASCADE,
  FOREIGN KEY (foundation_id) REFERENCES foundations(foundation_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_favorite_foundations_unique ON favorite_foundations(subscription_id, foundation_id);
CREATE INDEX idx_favorite_foundations_foundation_id ON favorite_foundations(foundation_id);

CREATE TABLE notification_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  foundation_id TEXT,
  program_id TEXT,
  deadline_id TEXT,
  scan_result_id TEXT,
  title TEXT NOT NULL,
  body TEXT,
  event_date TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  FOREIGN KEY (foundation_id) REFERENCES foundations(foundation_id) ON DELETE CASCADE,
  FOREIGN KEY (program_id) REFERENCES programs(program_id) ON DELETE CASCADE,
  FOREIGN KEY (deadline_id) REFERENCES deadlines(deadline_id) ON DELETE CASCADE,
  FOREIGN KEY (scan_result_id) REFERENCES call_scan_results(scan_result_id) ON DELETE CASCADE,
  CHECK (event_type IN ('deadline_soon', 'new_foundation', 'new_call', 'favorite_update'))
);

CREATE INDEX idx_notification_events_type ON notification_events(event_type);
CREATE INDEX idx_notification_events_event_date ON notification_events(event_date);

CREATE VIEW foundation_search AS
SELECT
  foundation_id,
  name,
  city,
  legal_type,
  support_areas,
  applicant_types,
  deadline_model,
  application_url,
  verification_status
FROM foundations
ORDER BY name;

CREATE VIEW program_search AS
SELECT
  p.program_id,
  p.program_name,
  p.program_type,
  p.application_status,
  p.deadline_summary,
  p.support_areas,
  p.applicant_types,
  p.geography,
  p.application_url,
  p.verification_status,
  f.foundation_id,
  f.name AS foundation_name,
  f.city,
  d.deadline_type,
  d.status AS deadline_status,
  d.closes_on,
  d.summary AS deadline_detail
FROM programs p
JOIN foundations f ON f.foundation_id = p.foundation_id
LEFT JOIN deadlines d ON d.program_id = p.program_id
ORDER BY f.name, p.program_name;
