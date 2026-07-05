-- 142_guests_replica_identity_full.sql
-- Ensures Supabase Realtime DELETE payloads include full old row (phone, etc.) for Inbox sync.

ALTER TABLE public.guests REPLICA IDENTITY FULL;
