-- ================================================================
-- Migration 121: routing_config — dynamic intent → board/group/SLA routing.
--
-- Root cause this closes: guest-portal-ops-request inserts a `tasks` row for
-- every Room Service tap (source='portal_room_service'). sla-escalation-cron's
-- unassigned-task scan does not distinguish "physical field task" from
-- "future guest order" — every open task, regardless of source, is swept by
-- the same 7-minute unassigned-SLA clock and re-alerted into whichever Whapi
-- group isFutureSuiteRoomServiceTask() picks. Once the bot was added to the
-- new "בקשות אורחים" group, guests' Room Service requests started generating
-- both the original request card AND a follow-up "SLA BREACH" card in that
-- same group — spam the group was never meant to carry.
--
-- Fix: a single routing table, keyed by intent_type, that both edge-function
-- alert dispatch AND sla-escalation-cron read at runtime. intent_type keys
-- mirror the existing tasks.source values 1:1 (no new column on tasks — the
-- source column IS the intent key), plus a small set of `alert_<alert_type>`
-- keys for the parallel guest_alerts board. Every row defaults to whatever
-- the code already did before this table existed — nothing changes behavior
-- until a row is edited (via RoutingControlCenter.js) — EXCEPT the two rows
-- that are the actual bug (portal_room_service / alert_request /
-- alert_upsell_opportunity → enable_sla=false), which is the whole point of
-- this migration.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.routing_config (
  intent_type        TEXT        PRIMARY KEY,
  destination_board  TEXT        NOT NULL DEFAULT 'operations'
                      CHECK (destination_board IN ('operations', 'requests')),
  whatsapp_group_id  TEXT,                 -- NULL = fall back to the existing env-var/const target
  enable_sla         BOOLEAN     NOT NULL DEFAULT TRUE,
  label              TEXT,                 -- Hebrew display label for the admin UI
  updated_by         UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_routing_config_updated ON public.routing_config;
CREATE TRIGGER trg_routing_config_updated
  BEFORE UPDATE ON public.routing_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Seed: OPERATIONS channel — physical field tasks, SLA stays ON ───────────
INSERT INTO public.routing_config (intent_type, destination_board, enable_sla, label) VALUES
  ('whatsapp_staff',      'operations', TRUE,  'דיווח צוות מוקלד (קבוצת קריאות)'),
  ('manual',              'operations', TRUE,  'משימה ידנית (מהלוח)'),
  ('manual_group',        'operations', TRUE,  'דיווח קבוצת צוות (Room/חדר/סוויטה)'),
  ('inbox_routed',        'operations', TRUE,  'נותב מ-DREAM BOT Inbox'),
  ('legacy_service_call', 'operations', TRUE,  'קריאת שירות (ישן)'),
  ('voice_call',          'operations', TRUE,  'דיווח קולי'),
  ('guest_request',       'operations', TRUE,  'בקשת אורח — פיזית בחדר (מגבות/מים/תקלה)')
ON CONFLICT (intent_type) DO NOTHING;

-- ── Seed: GUEST REQUESTS channel — future orders/spa/room-service/portal,
--    SLA OFF by default. These are the rows that fix the reported bug. ─────
INSERT INTO public.routing_config (intent_type, destination_board, enable_sla, label) VALUES
  ('portal_room_service', 'requests', FALSE, 'שירות חדרים (פורטל אורח)'),
  ('portal_upsell',       'requests', FALSE, 'שדרוג/מכירה (פורטל אורח)'),
  ('portal_order',        'requests', FALSE, 'הזמנה (פורטל אורח)'),
  ('alert_request',       'requests', FALSE, 'בקשת אורח כללית / ספא'),
  ('alert_upsell_opportunity', 'requests', FALSE, 'הזדמנות מכירה (Requests Board)')
ON CONFLICT (intent_type) DO NOTHING;

-- ── Seed: guest_alerts rows that legitimately need fast human attention —
--    kept SLA=true (unchanged from current behavior; only now configurable). ─
INSERT INTO public.routing_config (intent_type, destination_board, enable_sla, label) VALUES
  ('alert_date_change_request', 'requests', TRUE, 'בקשת שינוי תאריך'),
  ('alert_financial_issue',     'requests', TRUE, 'בעיה פיננסית'),
  ('alert_complaint',           'requests', TRUE, 'תלונה'),
  ('alert_severe_complaint',    'requests', TRUE, 'תלונה חמורה')
ON CONFLICT (intent_type) DO NOTHING;

-- Enable RLS — same admin-write / authenticated-read convention as bot_config
-- (migrations 015 + 089).
ALTER TABLE public.routing_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS routing_config_read  ON public.routing_config;
DROP POLICY IF EXISTS routing_config_write ON public.routing_config;

CREATE POLICY routing_config_read ON public.routing_config
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY routing_config_write ON public.routing_config
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
  );

COMMENT ON TABLE public.routing_config IS
  'Dynamic intent → board/group/SLA routing. Read by sla-escalation-cron, whatsapp-webhook (routeGuestRequestToOpsGroup), guest-portal-ops-request. Edited via RoutingControlCenter.js (admin only). A missing row = fall back to the pre-existing hardcoded behavior, never a silent break.';
