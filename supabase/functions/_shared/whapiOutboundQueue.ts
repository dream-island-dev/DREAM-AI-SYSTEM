// supabase/functions/_shared/whapiOutboundQueue.ts
//
// Durable multi-recipient Whapi send queue — any UI action that would fan
// out to >=3 recipients (WaiterPulseDispatchPanel today) enqueues here
// instead of looping sends in the browser. whapi-queue-drain (1-min pg_cron,
// migration 274) claims and sends one row at a time through
// _shared/whapiVelocityGuard.ts, so a closed tab or a mid-batch rate-limit
// can't leave a send half-applied — the row just waits for the next tick.

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

import { loadWhapiVelocityLimits } from "./whapiVelocityGuard.ts";
import { hasWhapiNamePlaceholder } from "./whapiMessagePersonalize.ts";

export type WhapiBulkRecipient = { phone: string; name?: string | null };

export type WhapiOutboundJobRow = {
  id: string;
  batch_id: string;
  status: "pending" | "sending" | "sent" | "failed" | "cancelled";
  phone: string;
  name: string | null;
  message_template: string;
  risk_tier: string | null;
  trigger: string | null;
  source: string | null;
  scheduled_after: string;
  attempts: number;
  last_error: string | null;
  wamid: string | null;
  created_at: string;
  sent_at: string | null;
};

/** After this many failed attempts a job is marked 'failed' instead of rescheduled again. */
export const MAX_WHAPI_JOB_ATTEMPTS = 6;

export async function enqueueWhapiBulkJob(
  supabase: SupabaseClient,
  params: {
    recipients: WhapiBulkRecipient[];
    messageTemplate: string;
    trigger: string;
    source: string;
  },
): Promise<{ batchId: string; queued: number; etaMinutes: number }> {
  const recipients = params.recipients ?? [];
  if (recipients.length === 0) throw new Error("whapi_bulk_no_recipients: אין נמענים לתזמן.");

  const limits = await loadWhapiVelocityLimits(supabase);
  if (recipients.length > limits.bulk_max_recipients_per_job) {
    throw new Error(
      `whapi_bulk_too_large: ${recipients.length} נמענים חורג מהתקרה (${limits.bulk_max_recipients_per_job}) — פצל לכמה שליחות.`,
    );
  }
  if (recipients.length >= 3 && !hasWhapiNamePlaceholder(params.messageTemplate)) {
    throw new Error(
      "whapi_bulk_requires_name_placeholder: תפוצה ל-3 נמענים ומעלה חייבת לכלול {{שם}} בטקסט ההודעה.",
    );
  }

  const batchId = crypto.randomUUID();
  const nowMs = Date.now();
  let cumulativeOffsetMs = 0;
  const rows = recipients.map((r, idx) => {
    if (idx > 0) {
      const jitterSec = limits.jitter_min_sec + Math.random() * (limits.jitter_max_sec - limits.jitter_min_sec);
      cumulativeOffsetMs += jitterSec * 1000;
    }
    return {
      batch_id: batchId,
      phone: r.phone,
      name: r.name?.trim() || null,
      message_template: params.messageTemplate,
      trigger: params.trigger,
      source: params.source,
      scheduled_after: new Date(nowMs + cumulativeOffsetMs).toISOString(),
    };
  });

  const { error } = await supabase.from("whapi_outbound_jobs").insert(rows);
  if (error) throw new Error(`whapi_bulk_enqueue_failed: ${error.message}`);

  return { batchId, queued: rows.length, etaMinutes: Math.ceil(cumulativeOffsetMs / 60_000) };
}

/**
 * Claims exactly one due job for this drain tick. The `.eq("status","pending")`
 * on the UPDATE (re-checked, not assumed from the prior SELECT) means a second
 * overlapping drain invocation that raced to the same row simply gets `null`
 * back instead of double-sending it — same optimistic-claim shape as
 * _shared/automationClaim.ts.
 */
export async function claimNextDueWhapiJob(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<WhapiOutboundJobRow | null> {
  const { data: candidate } = await supabase
    .from("whapi_outbound_jobs")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_after", now.toISOString())
    .order("scheduled_after", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!candidate) return null;

  const { data: claimed, error } = await supabase
    .from("whapi_outbound_jobs")
    .update({ status: "sending" })
    .eq("id", candidate.id)
    .eq("status", "pending")
    .select()
    .maybeSingle();
  if (error || !claimed) return null;
  return claimed as WhapiOutboundJobRow;
}

export async function finalizeWhapiJobSent(supabase: SupabaseClient, jobId: string, wamid: string | null): Promise<void> {
  await supabase.from("whapi_outbound_jobs").update({
    status: "sent", wamid, sent_at: new Date().toISOString(),
  }).eq("id", jobId);
}

/** rate_limited outcome: reschedule for retry_after_sec unless attempts are exhausted. */
export async function rescheduleOrFailWhapiJob(
  supabase: SupabaseClient,
  job: WhapiOutboundJobRow,
  errorMessage: string,
  retryAfterSec: number,
): Promise<"rescheduled" | "failed"> {
  const attempts = (job.attempts ?? 0) + 1;
  if (retryAfterSec > 0 && attempts < MAX_WHAPI_JOB_ATTEMPTS) {
    await supabase.from("whapi_outbound_jobs").update({
      status: "pending",
      scheduled_after: new Date(Date.now() + retryAfterSec * 1000).toISOString(),
      attempts,
      last_error: errorMessage,
    }).eq("id", job.id);
    return "rescheduled";
  }
  await supabase.from("whapi_outbound_jobs").update({
    status: "failed", attempts, last_error: errorMessage,
  }).eq("id", job.id);
  return "failed";
}

export type WhapiJobBatchStatus = {
  total: number;
  pending: number;
  sending: number;
  sent: number;
  failed: number;
  cancelled: number;
  done: number;
};

export async function getWhapiJobBatchStatus(supabase: SupabaseClient, batchId: string): Promise<WhapiJobBatchStatus> {
  const { data } = await supabase.from("whapi_outbound_jobs").select("status").eq("batch_id", batchId);
  const rows: Array<{ status: string }> = data ?? [];
  const counts = { pending: 0, sending: 0, sent: 0, failed: 0, cancelled: 0 };
  for (const r of rows) {
    if (r.status in counts) (counts as Record<string, number>)[r.status] += 1;
  }
  return { total: rows.length, ...counts, done: counts.sent + counts.failed + counts.cancelled };
}
