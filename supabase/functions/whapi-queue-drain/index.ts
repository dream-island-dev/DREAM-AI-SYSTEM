// supabase/functions/whapi-queue-drain/index.ts
// pg_cron consumer for whapi_outbound_jobs (migration 274, scheduled every
// 1 minute — deliberately separate from whatsapp-cron's 15-min guest-
// automation cadence, since a UI-triggered bulk send needs to finish in
// minutes). Claims due jobs one at a time and sends them through the
// velocity guard; a rate_limited outcome just reschedules the row for the
// next tick instead of failing the batch.
//
// Enqueue-time jitter (whapiOutboundQueue.ts) already spaces scheduled_after
// roughly at the guard's global_min_gap_sec cadence, so most claimed jobs
// should already clear the live guard check — it's a safety net here, not
// the primary pacing mechanism.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  claimNextDueWhapiJob,
  finalizeWhapiJobSent,
  rescheduleOrFailWhapiJob,
} from "../_shared/whapiOutboundQueue.ts";
import { loadWhapiVelocityLimits, sendWhapiTextGuarded, WhapiRateLimitedError } from "../_shared/whapiVelocityGuard.ts";
import { personalizeWhapiBody } from "../_shared/whapiMessagePersonalize.ts";
import { cleanPhoneForMention } from "../_shared/whapiSend.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TICK_BUDGET_MS = 50_000; // headroom before the next 1-min cron tick fires
const MAX_JOBS_PER_TICK = 40; // safety valve independent of the wall-clock budget

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const limits = await loadWhapiVelocityLimits(supabase);
    const tickStart = Date.now();

    let processed = 0, sent = 0, rescheduled = 0, failed = 0;

    while (processed < MAX_JOBS_PER_TICK && Date.now() - tickStart < TICK_BUDGET_MS) {
      const job = await claimNextDueWhapiJob(supabase);
      if (!job) break;
      processed++;

      // Every row in this queue exists because it was part of a >=1
      // multi-recipient enqueue — always fingerprint the body so a batch
      // never reproduces the 2026-07-23 identical-text pattern.
      const body = personalizeWhapiBody(job.message_template, { name: job.name, appendUniqueRef: true });

      try {
        const wamid = await sendWhapiTextGuarded(
          supabase,
          cleanPhoneForMention(job.phone),
          body,
          { sendClass: "guest", trigger: job.trigger ?? undefined, source: job.source ?? undefined },
        );
        await finalizeWhapiJobSent(supabase, job.id, wamid);
        sent++;
        // Pace ourselves before claiming the next one, mirroring
        // whatsapp-cron's sequential INTER_SEND_DELAY_MS convention.
        await new Promise((r) => setTimeout(r, limits.global_min_gap_sec * 1000));
      } catch (e) {
        const outcome = e instanceof WhapiRateLimitedError
          ? await rescheduleOrFailWhapiJob(supabase, job, e.message, e.retryAfterSec)
          : await rescheduleOrFailWhapiJob(supabase, job, (e as Error).message, 60);
        if (outcome === "failed") failed++; else rescheduled++;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, processed, sent, rescheduled, failed }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[whapi-queue-drain] error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
