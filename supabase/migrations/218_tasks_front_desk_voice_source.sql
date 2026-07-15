-- Migration 218: tasks.source — front_desk_voice for Adir voice-created ops tasks.

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_source_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_source_check CHECK (
  source IN (
    'whatsapp_staff', 'manual', 'inbox_routed', 'guest_request',
    'manual_group', 'portal_upsell', 'portal_room_service', 'portal_order',
    'voice_call', 'legacy_service_call', 'executive_voice', 'front_desk_voice'
  )
);
