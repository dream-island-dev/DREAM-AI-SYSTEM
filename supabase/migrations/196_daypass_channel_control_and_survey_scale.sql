-- Migration 196: Day-pass/Suites channel control (bot_config rows) +
-- guest_surveys category scale widen 1-5 → 1-10.
--
-- Mike lock (2026-07-13, day-pass survey + channel session): ACC gets two
-- independent cohort selectors — Suites {Whapi|DreamBot}, Day-pass
-- {Off|Whapi|DreamBot} — replacing the single global GUEST_WHAPI_SUITES_ENABLED
-- gate for outbound routing decisions (guestWhapiRouting.ts). Defaults:
-- Suites=DreamBot(meta), Day-pass=Off, until Mike QAs live.
--
-- Also: survey category ratings move from 1-5 to 1-10 (overall_experience
-- was already 1-10) — MVP is day-pass+spa only, not suites (Mike, Q1).
-- Migration 194/195 are already applied on the linked remote DB (confirmed
-- via `supabase migration list` before writing this file) — cannot edit 194
-- in place, must ALTER here instead.

-- ── 1. bot_config — new cohort channel rows (reuses existing KV table,
--    same pattern as bot_active / bot_active_whapi — no new table needed) ──
INSERT INTO bot_config (config_key, config_value, category, label)
VALUES
  ('guest_suites_channel',  'meta', 'general', 'ערוץ אורחי סוויטות (whapi / meta)'),
  ('guest_daypass_channel', 'off',  'general', 'ערוץ אורחי יום-כיף (off / whapi / meta)')
ON CONFLICT (config_key) DO NOTHING;

-- ── 2. guest_surveys — widen the 6 category CHECK constraints 1-5 → 1-10 ──
-- avg_categories is a GENERATED column over the same 6 fields / 6 — no
-- formula change needed, its valid range simply widens from 1.00-5.00 to
-- 1.00-10.00 automatically. overall_experience was already 1-10 (unchanged).
-- Existing rows (if any) remain valid — this widens the range, never narrows.
ALTER TABLE public.guest_surveys DROP CONSTRAINT IF EXISTS guest_surveys_patio_check;
ALTER TABLE public.guest_surveys ADD CONSTRAINT guest_surveys_patio_check CHECK (patio BETWEEN 1 AND 10);

ALTER TABLE public.guest_surveys DROP CONSTRAINT IF EXISTS guest_surveys_live_kitchen_check;
ALTER TABLE public.guest_surveys ADD CONSTRAINT guest_surveys_live_kitchen_check CHECK (live_kitchen BETWEEN 1 AND 10);

ALTER TABLE public.guest_surveys DROP CONSTRAINT IF EXISTS guest_surveys_chestnut_restaurant_check;
ALTER TABLE public.guest_surveys ADD CONSTRAINT guest_surveys_chestnut_restaurant_check CHECK (chestnut_restaurant BETWEEN 1 AND 10);

ALTER TABLE public.guest_surveys DROP CONSTRAINT IF EXISTS guest_surveys_service_team_check;
ALTER TABLE public.guest_surveys ADD CONSTRAINT guest_surveys_service_team_check CHECK (service_team BETWEEN 1 AND 10);

ALTER TABLE public.guest_surveys DROP CONSTRAINT IF EXISTS guest_surveys_spa_check;
ALTER TABLE public.guest_surveys ADD CONSTRAINT guest_surveys_spa_check CHECK (spa BETWEEN 1 AND 10);

ALTER TABLE public.guest_surveys DROP CONSTRAINT IF EXISTS guest_surveys_cleaning_maintenance_check;
ALTER TABLE public.guest_surveys ADD CONSTRAINT guest_surveys_cleaning_maintenance_check CHECK (cleaning_maintenance BETWEEN 1 AND 10);
