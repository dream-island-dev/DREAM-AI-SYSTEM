// supabase/functions/staff-ops-webhook/index.ts
// ══════════════════════════════════════════════════════════════════════════════
// Receives relay-forwarded staff WhatsApp-group reports (Lidor's "11- towels"
// etc.) and turns them into `tasks` rows on the Operations & Maintenance Board.
//
// WHY A SEPARATE FUNCTION, NOT A BRANCH IN whatsapp-webhook:
//   Meta's WhatsApp Business Cloud API — the only thing whatsapp-webhook
//   speaks — has no concept of reading from or sending into a real WhatsApp
//   *group* chat; group messaging isn't part of the Business API at all. The
//   actual group is watched by an external gateway (Make.com / an unofficial
//   bridge — Mike's separate infrastructure, not built here), which forwards
//   each message into THIS function. Keeping it separate means zero lines of
//   whatsapp-webhook's guest-facing payload parsing change (Golden Rule).
//
// INBOUND CONTRACT (the relay must POST this shape):
//   {
//     "sender_phone":  "9725xxxxxxx",   // required, any reasonable phone format
//     "sender_name":   "Lidor",         // optional, informational only
//     "message_text":  "11- towels",    // optional — omit/empty for a bare photo
//     "image_base64":  "...",           // optional
//     "image_url":     "https://..."    // optional alternative to image_base64
//   }
//
// PROCESSING TIERS:
//   Tier 0 (0 tokens)   — /^(\d+)\s*-\s*([\s\S]+)$/ structured match →
//                         deterministic room/description + keyword sla_category.
//   Tier 1 (Claude)     — only when message_text exists but didn't match Tier 0
//                         (free-text staff report) — tool-calling extraction,
//                         mirrors whatsapp-webhook's proven log_guest_request
//                         pattern (session 17). No Gemini tier here — staff
//                         volume is low, correctness matters more than cost.
//   Photo-only          — no message_text at all + image present → filed as
//                         "Photo Only — Uncategorized", zero AI calls (Mike's
//                         explicit decision — image vision is out of scope).
//
// Required Supabase secrets: ANTHROPIC_API_KEY | SUPABASE_URL |
//   SUPABASE_SERVICE_ROLE_KEY | META_WHATSAPP_TOKEN/META_PHONE_NUMBER_ID
//   (for the best-effort claim/done buttons back to the reporter — see
//   sendInteractiveButtons() call below for the documented 24h-window caveat).
// ══════════════════════════════════════════════════════════════════════════════

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic        from "https://esm.sh/@anthropic-ai/sdk@0.20.0";
import { sendInteractiveButtons } from "../_shared/interactiveSend.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CLAUDE_MODEL = "claude-sonnet-4-6";

// ── SLA category minute-thresholds — same "hardcoded constants" convention as
// META_TEMPLATE_FRIENDLY (AutomationControlCenter.js) elsewhere in this repo. ─
const SLA_THRESHOLDS: Record<string, number> = {
  pest_control:     10,
  guest_amenities:  15,
  maintenance:      30,
};
const DEFAULT_SLA_CATEGORY = "maintenance";

// ── Tier 0: zero-token structured parse ──────────────────────────────────────
const STRUCTURED_RE = /^(\d+)\s*-\s*([\s\S]+)$/;

const PEST_KEYWORDS = [
  "bug", "ant", "ants", "cockroach", "roach", "mouse", "mice", "rat", "rats",
  "insect", "pest", "wasp", "spider",
  "חרק", "נמלה", "נמלים", "ג'וק", "עכבר", "עכברים", "חולדה",
];
const AMENITY_KEYWORDS = [
  "towel", "towels", "pillow", "pillows", "soap", "shampoo", "amenities",
  "minibar", "slipper", "slippers", "blanket", "sheet", "sheets",
  "מגבת", "מגבות", "כרית", "כריות", "סבון", "שמפו", "מצעים", "שמיכה",
];

function guessSlaCategory(description: string): string {
  const lower = description.toLowerCase();
  if (PEST_KEYWORDS.some((k) => lower.includes(k)))    return "pest_control";
  if (AMENITY_KEYWORDS.some((k) => lower.includes(k))) return "guest_amenities";
  return DEFAULT_SLA_CATEGORY;
}

interface ParsedReport {
  room_number:  string | null;
  sla_category: string | null;
  description:  string;
}

function parseStructured(messageText: string): ParsedReport | null {
  const m = messageText.trim().match(STRUCTURED_RE);
  if (!m) return null;
  const room_number = m[1];
  const description = m[2].trim();
  return { room_number, sla_category: guessSlaCategory(description), description };
}

// ── Tier 1: Claude free-text parse (only on regex miss, text present) ───────
// Deliberately separate from whatsapp-webhook/index.ts's callClaude() — zero
// shared code, same "resolvePaymentPlaceholders vs resolvePlaceholders"
// convention already used in this codebase. tool_choice forces the call so a
// chatty model can't just reply with prose instead of structured output.
const LOG_OPS_TOOL_NAME = "log_ops_report";
const LOG_OPS_JSON_SCHEMA = {
  type: "object",
  properties: {
    room_number:  { type: "string", description: "Room/suite number mentioned in the message, or empty string if none." },
    sla_category: { type: "string", enum: ["pest_control", "guest_amenities", "maintenance"], description: "Best-fit category for this report." },
    description:  { type: "string", description: "Short English description of the issue, 3-12 words." },
  },
  required: ["sla_category", "description"],
};

async function parseStaffReport(messageText: string): Promise<ParsedReport> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("no_anthropic_key");

  const anthropic = new Anthropic({ apiKey: key });
  const resp = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 300,
    system:
      "You parse short, informal staff-reported hotel maintenance/operations messages into a structured " +
      "ticket. Always call log_ops_report exactly once with your best-effort extraction — never reply with " +
      "plain text only, even if the message is ambiguous (pick your best guess for sla_category).",
    messages: [{ role: "user", content: messageText }],
    tools: [{
      name: LOG_OPS_TOOL_NAME,
      description: "Log a structured operations report extracted from the staff message.",
      input_schema: LOG_OPS_JSON_SCHEMA,
    }],
    tool_choice: { type: "tool", name: LOG_OPS_TOOL_NAME },
  } as any);

  const blocks = resp.content as Array<Record<string, unknown>>;
  const toolBlock = blocks.find((b) => b.type === "tool_use" && b.name === LOG_OPS_TOOL_NAME);
  const args = (toolBlock?.input ?? {}) as Record<string, unknown>;

  const rawCategory = String(args.sla_category ?? "");
  const sla_category = rawCategory in SLA_THRESHOLDS ? rawCategory : DEFAULT_SLA_CATEGORY;
  if (!(rawCategory in SLA_THRESHOLDS)) {
    console.warn(`[staff-ops-webhook] Claude returned unexpected sla_category "${rawCategory}" — defaulting to "${DEFAULT_SLA_CATEGORY}"`);
  }
  const description = typeof args.description === "string" && args.description.trim()
    ? args.description.trim() : messageText.trim();
  const room_number = typeof args.room_number === "string" && args.room_number.trim()
    ? args.room_number.trim() : null;

  return { room_number, sla_category, description };
}

// ── Image upload — reuses the existing task_images bucket + the exact
// {timestamp}_{random}.{ext} naming convention TaskBoard.js already
// established, just under an ops/ prefix so WhatsApp-staff photos are
// distinguishable from in-app-uploaded ones. ─────────────────────────────────
async function uploadStaffImage(
  supabase: ReturnType<typeof createClient>,
  imageBase64: string | undefined,
  imageUrl: string | undefined,
): Promise<string | null> {
  try {
    let bytes: Uint8Array;
    let ext = "jpg";
    let contentType = "image/jpeg";
    if (imageBase64) {
      const cleaned = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
      bytes = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
    } else if (imageUrl) {
      const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`image_fetch_${res.status}`);
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("png")) { ext = "png"; contentType = "image/png"; }
      bytes = new Uint8Array(await res.arrayBuffer());
    } else {
      return null;
    }
    const path = `ops/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("task_images").upload(path, bytes, {
      cacheControl: "3600", upsert: false, contentType,
    });
    if (error) throw new Error(error.message);
    const { data } = supabase.storage.from("task_images").getPublicUrl(path);
    return data.publicUrl;
  } catch (e) {
    console.error("[staff-ops-webhook] image upload failed (non-blocking — task is still created):", (e as Error).message);
    return null;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const senderPhone = String((body as Record<string, unknown>)?.sender_phone ?? "").trim();
    const messageText = typeof (body as Record<string, unknown>)?.message_text === "string"
      ? ((body as Record<string, unknown>).message_text as string).trim() : "";
    const imageBase64 = typeof (body as Record<string, unknown>)?.image_base64 === "string"
      ? (body as Record<string, unknown>).image_base64 as string : undefined;
    const imageUrl = typeof (body as Record<string, unknown>)?.image_url === "string"
      ? (body as Record<string, unknown>).image_url as string : undefined;

    if (!senderPhone) {
      return new Response(JSON.stringify({ ok: false, error: "missing_sender_phone" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    if (!messageText && !imageBase64 && !imageUrl) {
      return new Response(JSON.stringify({ ok: false, error: "empty_message" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Phone format tolerance — same "try +972.../972.../0..." convention
    // already used for guests.phone elsewhere in this codebase.
    const digits = senderPhone.replace(/\D/g, "");
    const local  = digits.startsWith("972") ? "0" + digits.slice(3) : digits;
    const phoneVariants = [senderPhone, digits, local];

    const { data: reporterProfile } = await supabase
      .from("profiles")
      .select("id, name, department")
      .in("phone", phoneVariants)
      .maybeSingle();

    const imageUrlStored = await uploadStaffImage(supabase, imageBase64, imageUrl);

    let parsed: ParsedReport;
    if (!messageText) {
      // Photo-only — zero AI calls (Mike's explicit decision).
      parsed = { room_number: null, sla_category: null, description: "📷 Photo Only — Uncategorized" };
    } else {
      parsed = parseStructured(messageText) ?? await parseStaffReport(messageText).catch((e) => {
        console.error("[staff-ops-webhook] parseStaffReport failed, filing under default category:", (e as Error).message);
        return { room_number: null, sla_category: DEFAULT_SLA_CATEGORY, description: messageText } as ParsedReport;
      });
    }

    const slaDeadline = parsed.sla_category
      ? new Date(Date.now() + (SLA_THRESHOLDS[parsed.sla_category] ?? SLA_THRESHOLDS[DEFAULT_SLA_CATEGORY]) * 60000).toISOString()
      : null;

    const { data: task, error: insertErr } = await supabase
      .from("tasks")
      .insert([{
        room_number:          parsed.room_number,
        department:           reporterProfile?.department || "תפעול",
        description:          parsed.description,
        priority:              parsed.sla_category === "pest_control" ? "urgent" : "normal",
        image_url:             imageUrlStored,
        status:                "open",
        sla_category:          parsed.sla_category,
        sla_deadline:          slaDeadline,
        source:                "whatsapp_staff",
        reporter_profile_id:   reporterProfile?.id ?? null,
        reporter_raw_text:     messageText || null,
      }])
      .select()
      .single();

    if (insertErr) throw new Error(`tasks_insert_error: ${insertErr.message}`);

    // Best-effort interactive buttons back to the reporter, 1:1 — the only
    // Meta-supported delivery channel (see file header). Only actually
    // deliverable if this phone has an open 24h session window with our
    // business number; failure here is logged but never blocks task creation
    // — the in-app Operations Board's claim/done buttons are the reliable
    // primary path, this is a best-effort bonus on top.
    try {
      await sendInteractiveButtons(
        senderPhone,
        `✅ Logged: ${parsed.description}${parsed.room_number ? ` (Room ${parsed.room_number})` : ""}`,
        [
          { type: "quick_reply", label: "🙋‍♂️ אני מטפל", id: `ops_claim_${task.id}` },
          { type: "quick_reply", label: "✅ בוצע",        id: `ops_done_${task.id}` },
        ],
      );
    } catch (e) {
      console.warn(`[staff-ops-webhook] could not deliver claim/done buttons to ${senderPhone} (task still created):`, (e as Error).message);
    }

    return new Response(
      JSON.stringify({ ok: true, taskId: task.id, sla_category: parsed.sla_category, sla_deadline: slaDeadline }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[staff-ops-webhook] error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
