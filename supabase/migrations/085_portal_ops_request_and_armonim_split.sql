-- =============================================================================
-- 085_portal_ops_request_and_armonim_split.sql
-- Session "Culinary UX Split, Dual-Buttons & Strict Enterprise Routing".
--
-- 1. tasks.source gains 'portal_room_service' — a NEW kind of portal-originated
--    request that is OPERATIONAL (physical, actionable — "bring food to the
--    room"), not a sales lead. Distinct from the existing 'portal_upsell'
--    value (migration 083): that one was written by the ORIGINAL design of
--    guest-portal-upsell, before it was redesigned to insert into
--    `guest_alerts` instead (see that function's header comment — "REDESIGNED
--    (was: tasks insert + Whapi group card)"). 'portal_upsell' is therefore
--    currently unused/dead on `tasks` — reusing it for a conceptually
--    different flow (operational room-service, not a sales upsell) would
--    blur exactly the Requests-vs-Operations split this session is enforcing,
--    so a new, precisely-named value is added instead of resurrecting the old
--    one.
--
-- 2. portal_scenes content split — "the restaurant and wine room concepts are
--    mixed" (the row imaged `wine.jpg` actually carried Armonim-restaurant
--    copy as its title/body, with wine-only CTAs). Split into two rows:
--      - wine.jpg keeps the WINE ROOM concept only (real sourced line from
--        dream-island.co.il/culinary: "...חדר יין, אזור ישיבה על גדות האגם,
--        ומתחם פנימי מרשים" — verified live via fetch, not invented), single
--        LINK button out to the existing approved OnceHub workshop signup.
--      - armonim.jpg (NEW — Mike uploaded this exact filename) gets its own
--        row carrying the restaurant copy that used to live under wine.jpg
--        (itself originally sourced from the site, session 37) + TWO CTAs:
--        a LINK to dream-island.co.il/culinary (the real site has no
--        standalone digital menu page — /culinary is the closest real page
--        about Armonim, verified live; flagged here rather than inventing a
--        /menu URL that doesn't exist) and a NEW actionType "OPS_REQUEST"
--        button ("הזמנת שירות לחדר") that PhotoTour.js/GuestPortal.js route to
--        the new guest-portal-ops-request Edge Function — Operations Board
--        (tasks), not Requests Board (guest_alerts), per this session's
--        strict routing split.
--
--    No schema change needed for the dual-button support itself: `ctas` has
--    been a JSONB array since migration 084 and PhotoTour.js already renders
--    every entry in it (the wine.jpg row already carried 2 CTAs before this
--    migration) — "OPS_REQUEST" is just a new string value inside that JSON,
--    not a new column. Rigid button_1_*/button_2_* columns would have been a
--    regression from that existing, already-working, N-button design.
-- =============================================================================

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_source_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_source_check
  CHECK (source IN ('manual', 'whatsapp_staff', 'legacy_service_call', 'inbox_routed', 'guest_request', 'manual_group', 'portal_upsell', 'portal_room_service'));

COMMENT ON COLUMN public.tasks.source IS
  'manual = in-app New Task form. whatsapp_staff = parsed from the staff ops WhatsApp group. legacy_service_call = one-time backfill (migration 071). inbox_routed = operator routed a guest WhatsApp conversation to Maintenance/Housekeeping. guest_request = suite guest fulfillable ask via WhatsApp (migration 077). manual_group = Room/חדר/סוויטה-prefixed manual text in the ops group (migration 078). portal_upsell = UNUSED/legacy (migration 083) — guest-portal-upsell was redesigned to write guest_alerts instead, kept in the CHECK list only for historical rows, do not write new ones. portal_room_service = guest portal''s "הזמנת שירות לחדר" (Armonim scene) — an OPERATIONAL request, routed to this board (not guest_alerts) per the Operations-vs-Requests split (migration 085).';

-- ── Wine Room — strip the Armonim-restaurant copy/keep wine-only content ───
UPDATE public.portal_scenes
SET
  title = 'חדר היין',
  body  = 'חדר יין אינטימי, ישיבה על גדות האגם ומתחם פנימי מרשים — ולסדנאות טעימה מיוחדות לאוהבי יין.',
  ctas  = '[{"label": "לכל הסדנאות שלנו", "actionType": "LINK", "buttonUrl": "https://go.oncehub.com/DreamIsland"}]'::jsonb
WHERE image = 'wine.jpg';

-- ── Armonim Restaurant — new scene, guarded against re-running this migration ──
INSERT INTO public.portal_scenes (sort_order, image, title, body, ctas)
SELECT 45, 'armonim.jpg', 'מסעדת ערמונים',
  'מסעדת ערמונים מפליאה במנות מרתקות, ופוד-טראקים מפתיעים את האורחים בכל פינה באי.',
  '[{"label": "לתפריט המסעדה", "actionType": "LINK", "buttonUrl": "https://www.dream-island.co.il/culinary"}, {"label": "הזמנת שירות לחדר", "actionType": "OPS_REQUEST", "upsellLabel": "הזמנת שירות לחדר — ארמונים"}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.portal_scenes WHERE image = 'armonim.jpg');
