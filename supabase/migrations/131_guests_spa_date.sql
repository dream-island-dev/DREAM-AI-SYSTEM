-- Spa treatment calendar date (HH:MM stays in spa_time).
ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS spa_date DATE;

COMMENT ON COLUMN guests.spa_date IS 'Date of spa treatment; spa_time holds HH:MM (24h).';
