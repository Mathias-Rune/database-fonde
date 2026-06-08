DROP VIEW IF EXISTS foundation_search;
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
