-- Migration 152: routing_config seed for Inbox → Requests Board staff routing.
-- WhatsAppInbox.js "🛎️ ללוח בקשות" invokes inbox-route-request Edge Function;
-- admins can set whatsapp_group_id to the "בקשות אורחים" Whapi JID via RoutingControlCenter.

INSERT INTO public.routing_config (intent_type, destination_board, enable_sla, label) VALUES
  ('alert_inbox_routed', 'requests', TRUE, 'הפניית בקשה מ-DREAM BOT Inbox')
ON CONFLICT (intent_type) DO NOTHING;
