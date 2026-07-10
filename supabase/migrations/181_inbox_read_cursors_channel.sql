-- 181_inbox_read_cursors_channel.sql
-- Per-channel read cursors (Meta vs Whapi Suites device).
-- Fixes: load used phone-only Map keys while unread counted phone::channel →
-- marked-read threads reappeared under «לא נקרא» after refresh; Whapi never persisted.

ALTER TABLE public.inbox_read_cursors
  ADD COLUMN IF NOT EXISTS inbox_channel TEXT NOT NULL DEFAULT 'meta';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inbox_read_cursors_channel_check'
  ) THEN
    ALTER TABLE public.inbox_read_cursors
      ADD CONSTRAINT inbox_read_cursors_channel_check
      CHECK (inbox_channel IN ('meta', 'whapi'));
  END IF;
END $$;

-- Rebuild PK to include channel (idempotent if already migrated).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.inbox_read_cursors'::regclass
      AND conname = 'inbox_read_cursors_pkey'
      AND pg_get_constraintdef(oid) NOT LIKE '%inbox_channel%'
  ) THEN
    ALTER TABLE public.inbox_read_cursors
      DROP CONSTRAINT inbox_read_cursors_pkey;
    ALTER TABLE public.inbox_read_cursors
      ADD PRIMARY KEY (phone, staff_id, inbox_channel);
  END IF;
END $$;

COMMENT ON COLUMN public.inbox_read_cursors.inbox_channel IS
  'Inbox thread channel: meta (Dream Bot) or whapi (Suites device). Unread is per phone+channel.';
