-- =============================================================================
-- 087_cleaner_role_lockdown.sql
-- "RESTRICTED CLEANER ROLE" session.
--
-- AUDIT FINDING (before writing this migration): the 'cleaner' role already
-- exists (migration 038) and the app already routes it to a single screen
-- (App.js: user.role==='cleaner' -> <HousekeepingTabletView> only, no
-- Sidebar). But almost every table's RLS policy is scoped to
-- "auth.uid() IS NOT NULL" / "TO authenticated USING (true)" — i.e. ANY
-- logged-in role, cleaner included, can read/write guests (names, phone,
-- payment_amount, payment_link_url, guest_notes), bookings, tasks,
-- bot_config/bot_settings/bot_scripts (admin knowledge + persona),
-- whatsapp_conversations, guest_alerts, etc. via the Supabase client
-- directly (browser dev console, not just through the app's UI) — the UI
-- hiding those pages was never actually enforced at the data layer.
--
-- FIX: Postgres RESTRICTIVE policies (AS RESTRICTIVE) AND together with all
-- existing PERMISSIVE policies on a table. This lets us add ONE new "deny
-- cleaner" rule per table WITHOUT touching/rewriting any of the existing
-- permissive policies (lower blast radius — every other role's access is
-- byte-for-byte unchanged; only role='cleaner' loses access on these tables).
--
-- COALESCE(get_true_role(), '') <> 'cleaner' — NULL-safe: a request with no
-- profile row (or no session at all) gets '' <> 'cleaner' = true = NOT
-- blocked by this policy, identical to today's behavior for that case. Only
-- an authenticated user whose profiles.role is literally 'cleaner' is denied.
--
-- room_status is INTENTIONALLY untouched — that's the one table the
-- Housekeeping Tablet Board (the cleaner's only screen) needs, and migration
-- 038 already scoped it correctly (cleaner can read+write it, same as every
-- other authenticated role).
--
-- profiles gets a narrower SELECT-only restrictive policy (own row only) —
-- a cleaner still needs to read THEIR OWN profile row (the app loads
-- `user` from profiles right after login); they just can't browse every
-- other employee's profile.
-- =============================================================================

DO $$
DECLARE
  t TEXT;
  -- Every table read/write any authenticated role can currently reach that
  -- is NOT the Housekeeping Tablet Board's data (room_status) and is NOT
  -- already scoped to "your own row" in a way that makes a cleaner-specific
  -- block redundant (push_subscriptions/employees/shifts/departments).
  tables TEXT[] := ARRAY[
    'guests', 'bookings', 'suite_rooms', 'spa_staging',
    'guest_alerts', 'whatsapp_conversations', 'tasks',
    'bot_config', 'bot_settings', 'bot_scripts', 'message_templates',
    'automation_stages', 'custom_automations', 'custom_automation_steps',
    'ai_failover_events', 'notification_log',
    'agent_profiles', 'agent_memory', 'chat_history', 'schedule_patterns'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      'cleaner_lockdown_' || t, t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL ' ||
      'USING (COALESCE(public.get_true_role(), '''') <> ''cleaner'') ' ||
      'WITH CHECK (COALESCE(public.get_true_role(), '''') <> ''cleaner'')',
      'cleaner_lockdown_' || t, t
    );
  END LOOP;
END $$;

-- ── profiles: SELECT-only, own-row exception (everyone else unaffected) ─────
DROP POLICY IF EXISTS "cleaner_lockdown_profiles_select" ON public.profiles;
CREATE POLICY "cleaner_lockdown_profiles_select" ON public.profiles
  AS RESTRICTIVE
  FOR SELECT
  USING (
    auth.uid() = id
    OR COALESCE(public.get_true_role(), '') <> 'cleaner'
  );

COMMENT ON POLICY "cleaner_lockdown_profiles_select" ON public.profiles IS
  'Restrictive — a cleaner may only read their own profiles row (needed for app session bootstrap); every other role is unaffected. Pairs with the per-table cleaner_lockdown_* restrictive policies added in migration 087.';
