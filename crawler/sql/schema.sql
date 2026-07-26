-- Compatibility entry point. New installations should use `npm run db:migrate`.
\ir ../../database/postgres/001_core.sql
\ir ../../database/postgres/002_intelligence.sql
\ir ../../database/postgres/003_application.sql
