// supabase/functions/whapi-bulk-dispatch/index.ts
// Enqueue API for any staff UI sending an identical (name-personalized)
// message to several Whapi recipients at once — replaces browser for-loops
// (WaiterPulseDispatchPanel) with one request; whapi-queue-drain (1-min
// pg_cron, migration 274) does the actual paced sending.
//
// POST {
//   phones: [{ phone: string, name?: string }],
//   message_template: string,   // must contain {{שם}} once phones.length >= 3
//   trigger: string,
//   source: string,
// }
// -> { ok: true, batchId, queued, etaMinutes } | { ok: false, error }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enqueueWhapiBulkJob } from "../_shared/whapiOutboundQueue.ts";
import { normalizeOritGuestPhoneDigits } from "../_shared/oritGuestOutbound.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json() as {
      phones?: Array<{ phone?: string; name?: string }>;
      message_template?: string;
      trigger?: string;
      source?: string;
    };

    const messageTemplate = String(body.message_template ?? "").trim();
    const trigger = String(body.trigger ?? "").trim() || "manual_bulk";
    const source = String(body.source ?? "").trim() || "whapi-bulk-dispatch";

    if (!messageTemplate) {
      return new Response(
        JSON.stringify({ ok: false, error: "message_template_required" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const recipients = (body.phones ?? [])
      .map((p) => ({ phone: normalizeOritGuestPhoneDigits(p.phone), name: p.name ?? null }))
      .filter((p): p is { phone: string; name: string | null } => !!p.phone);

    if (recipients.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "no_valid_recipients" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const result = await enqueueWhapiBulkJob(supabase, {
      recipients, messageTemplate, trigger, source,
    });

    return new Response(
      JSON.stringify({ ok: true, ...result }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[whapi-bulk-dispatch] error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
