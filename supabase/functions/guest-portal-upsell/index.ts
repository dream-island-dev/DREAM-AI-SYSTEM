// supabase/functions/guest-portal-upsell/index.ts
// Pre-Arrival Guest Portal — in-scroll one-click upsell dispatch.
//
// Validates the guest by `portal_token` (same credential as
// guest-portal-data, service-role lookup), inserts a real `tasks` row
// (source='portal_upsell', migration 083) so it lands on OperationsBoard
// under the same SLA tracking as every other task source, and posts a card
// to the staff Whapi ops group — same mechanism as notify-manual-task /
// whapi-webhook's reaction-sweep, so a 👍🏼 on the card resolves it identically.
// whapi_message_id is stored back on the task for that listener to match.

import { serve }         from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient }  from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhapiText } from "../_shared/whapiSend.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function buildUpsellCard(room: string | null, guestName: string, label: string): string {
  return [
    `🛎️ [GUEST PORTAL UPSELL] Suite ${room ?? "—"} (${guestName}): ${label}`,
    `👉 Please react with 👍🏼 to complete this task.`,
  ].join("\n");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { token, upsellLabel } = await req.json();
    if (!token || typeof token !== "string") throw new Error("token required");
    if (!upsellLabel || typeof upsellLabel !== "string") throw new Error("upsellLabel required");

    // Same UUID-shape guard as guest-portal-data — see that function's
    // comment. Without it, a malformed token throws a raw Postgres type
    // error instead of a clean guest_not_found.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(token)) {
      return new Response(
        JSON.stringify({ ok: false, error: "guest_not_found" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: guest, error: guestErr } = await supabase
      .from("guests")
      .select("id, name, room")
      .eq("portal_token", token)
      .maybeSingle();
    if (guestErr) throw new Error(`lookup_error: ${guestErr.message}`);
    if (!guest) {
      return new Response(
        JSON.stringify({ ok: false, error: "guest_not_found" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const guestLabel = guest.name ?? "אורח";
    const { data: task, error: insErr } = await supabase
      .from("tasks")
      .insert({
        room_number:       guest.room ?? null,
        department:        "מזמ\"ש (F&B)",
        description:       `[פורטל אורח — ${guestLabel}] ${upsellLabel}`.trim(),
        priority:          "normal",
        status:            "open",
        sla_category:      "guest_amenities",
        sla_deadline:       new Date(Date.now() + 15 * 60000).toISOString(),
        source:            "portal_upsell",
        guest_id:          guest.id,
        reporter_raw_text: upsellLabel,
      })
      .select("id")
      .maybeSingle();
    if (insErr) throw new Error(`task_insert_error: ${insErr.message}`);

    const groupId = (Deno.env.get("WHAPI_GROUP_ID") ?? "").trim();
    if (groupId && task?.id) {
      try {
        const card = buildUpsellCard(guest.room, guestLabel, upsellLabel);
        const cardMsgId = await sendWhapiText(groupId, card, { noLinkPreview: true });
        if (cardMsgId) {
          await supabase.from("tasks").update({ whapi_message_id: cardMsgId }).eq("id", task.id);
        }
      } catch (e) {
        // Best-effort — the task row is already created and visible on
        // OperationsBoard even if the group ping fails; never block the
        // guest's success toast on a Whapi hiccup.
        console.error("[guest-portal-upsell] Whapi notify failed (non-blocking):", (e as Error).message);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, taskId: task?.id ?? null }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[guest-portal-upsell] error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
