-- =============================================================================
-- 182_executive_assistant_mike_qa.sql
-- Links Mike's profile phone for Executive Voice Assistant QA (0506842439).
-- =============================================================================

UPDATE public.profiles
SET phone = '+972506842439'
WHERE lower(email) = 'promote7il@gmail.com';
