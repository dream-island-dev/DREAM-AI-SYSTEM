-- 141_delete_guest_cascade.sql
-- Central hard-delete for guest profiles: cancel pending scheduled_tasks, then DELETE guests.
-- CASCADE removes scheduled_tasks / guest_orders; whatsapp_conversations.guest_id → SET NULL.

CREATE OR REPLACE FUNCTION public.delete_guest_profile(p_guest_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guest public.guests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_guest FROM public.guests WHERE id = p_guest_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'guest_not_found');
  END IF;

  UPDATE public.scheduled_tasks
     SET status = 'cancelled',
         cancelled_at = NOW(),
         cancel_reason = 'guest_deleted',
         updated_at = NOW()
   WHERE guest_id = p_guest_id
     AND status = 'pending';

  DELETE FROM public.guests WHERE id = p_guest_id;

  RETURN jsonb_build_object(
    'ok', true,
    'phone', v_guest.phone,
    'name', v_guest.name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_guest_profile(BIGINT) TO authenticated;
