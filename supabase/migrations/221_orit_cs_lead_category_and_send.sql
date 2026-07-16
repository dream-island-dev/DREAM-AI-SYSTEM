-- Orit CS Agent: lead category, outbound email via Graph, auto-ack template.

ALTER TABLE public.orit_agent_threads
  DROP CONSTRAINT IF EXISTS orit_agent_threads_category_check;

ALTER TABLE public.orit_agent_threads
  ADD CONSTRAINT orit_agent_threads_category_check
  CHECK (category IN ('complaint', 'booking', 'spa', 'vendor', 'internal', 'other', 'lead'));

-- Microsoft Graph mailboxes: enable outbound + auto-ack (OAuth already requests Mail.Send).
UPDATE public.orit_agent_mailbox
SET
  read_only_mode = FALSE,
  auto_ack_enabled = TRUE,
  auto_ack_template = 'שלום {{GUEST_NAME}},

קיבלנו את בקשתך, ניצור איתך קשר בהקדם.

בברכה,
דרים איילנד — אתר הנופש'
WHERE provider = 'microsoft'
  AND connection_status = 'active';

COMMENT ON COLUMN public.orit_agent_threads.category IS
  'AI + tier-0: lead | complaint | booking | spa | vendor | internal | other';
