// supabase/functions/notify-manual-task/index.ts
// Session 30 Sprint 5.3 — posts a Whapi card into the staff ops group for a
// task created from the in-app "➕ פתח משימה חדשה" form (OperationsBoard.js's
// NewTaskForm, source='manual') or the receptionist's streamlined equivalent
// (ReceptionistView.js, same component). Until now ONLY tasks reported via
// WhatsApp (whapi-webhook) got a group card — a manually-opened task sat
// silently on the in-app board with nobody outside the dashboard aware of it.
//
// Card format kept deliberately distinct from buildTaskCard() in
// whapi-webhook/index.ts ("📌 New Task Opened: Suite X") so a manual task is
// visually identifiable in the group as staff-initiated, not guest/WhatsApp-
// sourced — same English-in-group convention, same "👍🏼 to complete" closer so
// the existing reaction-sweep listener (whapi-webhook) resolves it identically.
//
// whapi_message_id is stored back on the task row so that listener can match
// the reaction to this exact task — same column, same mechanism as every
// other task source (CLAUDE.md §5 tasks table).

import { serve }         from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient }  from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhapiText } from "../_shared/whapiSend.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Same canonical category labels as whapi-webhook/sla-escalation-cron's
// SLA_THRESHOLDS keys — translated to English for the group card only.
const CATEGORY_LABELS: Record<string, string> = {
  pest_control:    "Pest Control",
  guest_amenities: "Guest Amenities",
  maintenance:      "Maintenance",
};

function buildManualTaskCard(room: string | null, desc: string, category: string | null): string {
  const categoryLabel = category ? (CATEGORY_LABELS[category] ?? category) : "General";
  return [
    `🔧 [MANUAL TASK] Room ${room ?? "—"}: ${desc} (Category: ${categoryLabel})`,
    `👉 Please react with 👍🏼 to complete this task.`,
  ].join("\n");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { taskId } = (await req.json().catch(() => ({}))) as { taskId?: string };
    if (!taskId) {
      return new Response(JSON.stringify({ ok: false, error: "taskId required" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: task, error: taskErr } = await supabase
      .from("tasks")
      .select("id, room_number, description, sla_category, whapi_message_id")
      .eq("id", taskId)
      .maybeSingle();
    if (taskErr) throw new Error(`task_lookup_error: ${taskErr.message}`);
    if (!task) {
      return new Response(JSON.stringify({ ok: true, notified: false, reason: "task_not_found" }),
        { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const groupId = (Deno.env.get("WHAPI_GROUP_ID") ?? "").trim();
    if (!groupId) {
      console.warn("[notify-manual-task] WHAPI_GROUP_ID not set — manual task card not sent.");
      return new Response(JSON.stringify({ ok: true, notified: false, reason: "no_whapi_group_id" }),
        { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const card = buildManualTaskCard(task.room_number, task.description, task.sla_category);

    let cardMsgId: string | null = null;
    try {
      cardMsgId = await sendWhapiText(groupId, card, { noLinkPreview: true });
    } catch (e) {
      console.error(`[notify-manual-task] Whapi send failed for task ${taskId}:`, (e as Error).message);
      return new Response(JSON.stringify({ ok: true, notified: false, reason: (e as Error).message }),
        { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    if (cardMsgId) {
      const { error: updateErr } = await supabase.from("tasks").update({ whapi_message_id: cardMsgId }).eq("id", taskId);
      if (updateErr) console.warn(`[notify-manual-task] failed to store whapi_message_id for task ${taskId}:`, updateErr.message);
    }

    return new Response(JSON.stringify({ ok: true, notified: true, taskId }),
      { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[notify-manual-task] error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
