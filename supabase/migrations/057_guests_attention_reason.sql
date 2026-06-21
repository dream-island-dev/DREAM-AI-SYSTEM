-- Migration 057: Add guests.attention_reason — distinguishes WHY
-- requires_attention/needs_callback was set, since the date-change button,
-- the human-callback button, and the human-callback fallback regex path all
-- currently collapse into the exact same two boolean flags with no way to
-- tell them apart on the dashboard. Written by whatsapp-webhook's button
-- router + DATE_CHANGE_RE path; read by GuestsPage.js/GuestDashboard.js to
-- render a distinct "שינוי בתאריך" badge instead of a generic red dot.

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS attention_reason TEXT;

COMMENT ON COLUMN public.guests.attention_reason IS
  'Why requires_attention/needs_callback was set: "date_change" | "human_callback" | NULL (generic/guest_notes capture). Set by whatsapp-webhook, read by guest dashboards for a distinct badge.';
