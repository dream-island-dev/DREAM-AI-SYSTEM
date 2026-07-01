// supabase/functions/notify-manual-task/index.ts
// Session 30 Sprint 5.3 — posts a Whapi card into the staff ops group for a
// task created from the in-app "➕ פתח משימה חדשה" form (OperationsBoard.js's
// NewTaskForm, source='manual'), WhatsAppInbox.js guest routing (source=
// 'inbox_routed'), or the receptionist's streamlined equivalent
// (ReceptionistView.js, same component). Until session 69 only manual + Whapi-
// reported tasks got a group card — inbox_routed sat silently on the board.
//
// Card format kept deliberately distinct from buildTaskCard() in
// whapi-webhook/index.ts ("📌 New Task Opened: Suite X") so in-app tasks are
// visually identifiable in the group — same English-in-group convention, same
// "👍🏼 to complete" closer so the existing reaction-sweep listener
// (whapi-webhook) resolves it identically. Prefix varies by tasks.source:
// manual → [MANUAL TASK], inbox_routed → [GUEST WA] (WhatsAppInbox.js routing).
//
// whapi_message_id is stored back on the task row so that listener can match
// the reaction to this exact task — same column, same mechanism as every
// other task source (CLAUDE.md §5 tasks table).
//
// Session 77c — Hebrew descriptions from NewTaskForm / inbox_routed are
// translated via Gemini for the Whapi card only; tasks.description in DB
// stays Hebrew for reception/board UI (same contract as guest_request routing).

import { serve }         from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient }  from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhapiText, cleanPhoneForMention } from "../_shared/whapiSend.ts";
import { containsHebrew, translateTextForFieldOps } from "../_shared/fieldOpsTranslation.ts";

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

/** Whapi card translation — ops departments only; DB description stays Hebrew. */
const FIELD_OPS_WHAPI_DEPARTMENTS = new Set([
  "תפעול",
  "משק",
  "תפעול ואחזקה",
]);

// Session — Dynamic Native Mentions, same contract as whapi-webhook's
// buildTaskCard: `assignedPhone` is already-cleaned bare digits; omitted
// entirely (no dead "Assigned:" line) when no profiles row has a phone for
// the task's department.
function buildManualTaskCard(
  room: string | null,
  desc: string,
  category: string | null,
  assignedPhone: string | null,
  source: string | null,
): string {
  const categoryLabel = category ? (CATEGORY_LABELS[category] ?? category) : "General";
  const prefix = source === "inbox_routed" ? "[GUEST WA]" : "[MANUAL TASK]";
  return [
    `🔧 ${prefix} Room ${room ?? "—"}: ${desc} (Category: ${categoryLabel})`,
    ...(assignedPhone ? [`👤 Assigned: @${assignedPhone}`] : []),
    `👉 Please react with 👍🏼 to complete this task.`,
  ].join("\n");
}

// Same live department→phone lookup as whapi-webhook/index.ts's
// findAssignedWorkerPhone — duplicated, not imported (Deno functions don't
// share modules across function boundaries in this repo, CLAUDE.md
// convention already used for SLA_CATEGORY_MINUTES etc.).
async function findAssignedWorkerPhone(
  supabase: ReturnType<typeof createClient>,
  department: string | null,
): Promise<string | null> {
  if (!department) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("phone")
    .eq("department", department)
    .not("phone", "is", null)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(`[notify-manual-task] assigned-worker lookup failed for department "${department}":`, error.message);
    return null;
  }
  return (data?.phone as string | undefined) ?? null;
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
      .select("id, room_number, description, sla_category, department, source, whapi_message_id")
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

    const rawAssignedPhone = await findAssignedWorkerPhone(supabase, task.department);
    const assignedPhone = rawAssignedPhone ? cleanPhoneForMention(rawAssignedPhone) : null;

    const rawDesc = String(task.description ?? "");
    let whapiDesc = rawDesc;
    if (
      FIELD_OPS_WHAPI_DEPARTMENTS.has(String(task.department ?? "")) &&
      containsHebrew(rawDesc)
    ) {
      whapiDesc = await translateTextForFieldOps(rawDesc, {
        room: task.room_number as string | null,
        style: "description_only",
      });
      console.log(`[notify-manual-task] Whapi description translated (task ${taskId}, DB unchanged)`);
    }

    const card = buildManualTaskCard(
      task.room_number,
      whapiDesc,
      task.sla_category,
      assignedPhone,
      task.source as string | null,
    );

    let cardMsgId: string | null = null;
    try {
      cardMsgId = await sendWhapiText(groupId, card, {
        noLinkPreview: true,
        ...(assignedPhone ? { mentions: [assignedPhone] } : {}),
      });
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
