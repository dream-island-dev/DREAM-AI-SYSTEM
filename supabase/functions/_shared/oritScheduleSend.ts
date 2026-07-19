// Orit CS — scheduled guest outbound (email / WhatsApp), Israel quiet hours 21:00–05:00.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  ISRAEL_UTC_OFFSET_HOURS,
  israelLocalHour,
  israelYmd,
} from "./automationSchedule.ts";
import { getIsraelTimeGreeting } from "./guestTimeGreeting.ts";
import type { OritMailboxRow } from "./oritAgentMail.ts";
import { deliverOritThreadEmail } from "./oritAgentSend.ts";
import { deliverOritGuestWhatsapp } from "./oritGuestOutbound.ts";
import { closeOritThread } from "./closeOritThread.ts";
import { fetchOritThreadInbound } from "./oritThreadAnalysis.ts";
import {
  notifyOritFullReplyReady,
  sendOritAckEmail,
} from "./oritAgentWorkflow.ts";
import {
  notifyOritScheduleCreated,
  notifyOritScheduledDispatched,
} from "./oritSigalUiNotify.ts";
import type { OritAlertMailbox } from "./oritAgentWhapiAlert.ts";
import type { SigalBriefingThread } from "./oritSigalBriefing.ts";

export const ORIT_QUIET_HOUR_START = 21;
export const ORIT_QUIET_HOUR_END = 5;
export const ORIT_DEFAULT_SCHEDULE_HOUR = 8;

export type OritScheduleChannel = "email" | "whatsapp_bridge";
export type OritScheduleDraftKind = "ack" | "full_reply";

export type OritScheduledSendRow = {
  id: string;
  thread_id: string;
  mailbox_id: string;
  channel: OritScheduleChannel;
  draft_kind: OritScheduleDraftKind;
  body_text: string;
  scheduled_for: string;
  mark_handled: boolean;
  draft_id: string | null;
  status: string;
  source?: string;
};

/** Orit staff quiet window — suggest schedule instead of immediate guest send. */
export function isOritQuietHours(now: Date = new Date()): boolean {
  const h = israelLocalHour(now);
  return h >= ORIT_QUIET_HOUR_START || h < ORIT_QUIET_HOUR_END;
}

export function addIsraelDays(ymd: string, delta: number): string {
  const base = new Date(`${ymd}T12:00:00+03:00`);
  base.setUTCDate(base.getUTCDate() + delta);
  return base.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

export function israelLocalInstant(ymd: string, hour: number, minute = 0): Date {
  const d = ymd.trim().slice(0, 10);
  const utcMidnightMs = new Date(`${d}T00:00:00.000Z`).getTime();
  return new Date(utcMidnightMs + ((hour - ISRAEL_UTC_OFFSET_HOURS) * 60 + minute) * 60_000);
}

export function defaultOritScheduleInstant(now: Date = new Date()): Date {
  const today = israelYmd(now);
  const hour = israelLocalHour(now);
  const targetYmd = hour < ORIT_QUIET_HOUR_END ? today : addIsraelDays(today, 1);
  return israelLocalInstant(targetYmd, ORIT_DEFAULT_SCHEDULE_HOUR, 0);
}

export function formatOritScheduleLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function composeSigalTimeGreeting(name = "אורית"): string {
  return `${getIsraelTimeGreeting()} ${name}`;
}

/** Parse Hebrew schedule hints from Sigal chat (e.g. «תזמני למחר 8»). */
export function parseOritScheduleFromText(text: string, now: Date = new Date()): Date | null {
  const t = (text || "").trim().toLowerCase();
  if (!/(תזמן|תזמני|למחר|בבוקר|בערב|\d{1,2}[:\.]\d{2})/.test(t)) return null;

  const today = israelYmd(now);
  let targetYmd = /מחר/.test(t) ? addIsraelDays(today, 1) : today;
  if (/תזמן|תזמני/.test(t) && !/מחר|היום/.test(t) && isOritQuietHours(now)) {
    targetYmd = addIsraelDays(today, 1);
  }

  const hm = t.match(/(\d{1,2})[:\.](\d{2})/);
  if (hm) {
    const h = parseInt(hm[1], 10);
    const m = parseInt(hm[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      let instant = israelLocalInstant(targetYmd, h, m);
      if (instant.getTime() <= now.getTime() + 60_000) {
        instant = israelLocalInstant(addIsraelDays(targetYmd, 1), h, m);
      }
      return instant;
    }
  }

  const hb = t.match(/(?:ב|ל)\s*(\d{1,2})(?:\s|$|ב)/);
  if (hb) {
    const h = parseInt(hb[1], 10);
    if (h >= 0 && h <= 23) {
      let instant = israelLocalInstant(targetYmd, h, 0);
      if (instant.getTime() <= now.getTime() + 60_000) {
        instant = israelLocalInstant(addIsraelDays(targetYmd, 1), h, 0);
      }
      return instant;
    }
  }

  if (/בבוקר|בוקר/.test(t)) {
    return israelLocalInstant(targetYmd, ORIT_DEFAULT_SCHEDULE_HOUR, 0);
  }
  if (/בערב/.test(t)) {
    return israelLocalInstant(targetYmd, 18, 0);
  }
  if (/תזמן|תזמני/.test(t)) {
    return defaultOritScheduleInstant(now);
  }
  return null;
}

export function pendingActionToScheduleMeta(
  action: string,
): { channel: OritScheduleChannel; draftKind: OritScheduleDraftKind } | null {
  if (action === "confirm_ack") return { channel: "email", draftKind: "ack" };
  if (action === "confirm_full") return { channel: "email", draftKind: "full_reply" };
  if (action === "confirm_whatsapp_ack") return { channel: "whatsapp_bridge", draftKind: "ack" };
  if (action === "confirm_whatsapp_full") return { channel: "whatsapp_bridge", draftKind: "full_reply" };
  return null;
}

async function saveOritStyleSample(
  supabase: SupabaseClient,
  mailboxId: string,
  threadId: string,
  category: string,
  outboundText: string,
): Promise<void> {
  const inbound = await fetchOritThreadInbound(supabase, threadId);
  await supabase.from("orit_agent_style_samples").insert({
    mailbox_id: mailboxId,
    context_category: category || "other",
    inbound_snippet: (inbound || "").slice(0, 300),
    outbound_text: outboundText,
  });
}

export async function cancelPendingScheduledSendsForThread(
  supabase: SupabaseClient,
  threadId: string,
): Promise<void> {
  await supabase
    .from("orit_agent_scheduled_sends")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("thread_id", threadId)
    .eq("status", "pending");
}

export async function getPendingScheduledSendForThread(
  supabase: SupabaseClient,
  threadId: string,
): Promise<OritScheduledSendRow | null> {
  const { data } = await supabase
    .from("orit_agent_scheduled_sends")
    .select("*")
    .eq("thread_id", threadId)
    .eq("status", "pending")
    .order("scheduled_for", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as OritScheduledSendRow | null) ?? null;
}

export async function createOritScheduledSend(
  supabase: SupabaseClient,
  opts: {
    threadId: string;
    mailboxId: string;
    channel: OritScheduleChannel;
    draftKind: OritScheduleDraftKind;
    bodyText: string;
    scheduledFor: Date;
    markHandled?: boolean;
    draftId?: string | null;
    createdBy?: string | null;
    source?: "ui" | "sigal_wa";
  },
): Promise<{ ok: boolean; id?: string; scheduledFor?: string; error?: string }> {
  const body = opts.bodyText.trim();
  if (!body) return { ok: false, error: "empty_body" };
  if (opts.scheduledFor.getTime() <= Date.now() + 60_000) {
    return { ok: false, error: "schedule_too_soon" };
  }

  await cancelPendingScheduledSendsForThread(supabase, opts.threadId);

  const { data, error } = await supabase
    .from("orit_agent_scheduled_sends")
    .insert({
      thread_id: opts.threadId,
      mailbox_id: opts.mailboxId,
      channel: opts.channel,
      draft_kind: opts.draftKind,
      body_text: body,
      scheduled_for: opts.scheduledFor.toISOString(),
      mark_handled: opts.markHandled === true,
      draft_id: opts.draftId ?? null,
      created_by: opts.createdBy ?? null,
      source: opts.source ?? "ui",
      status: "pending",
    })
    .select("id, scheduled_for")
    .maybeSingle();

  if (error || !data) return { ok: false, error: error?.message || "insert_failed" };
  return { ok: true, id: data.id, scheduledFor: data.scheduled_for };
}

export async function executeOritScheduledSend(
  supabase: SupabaseClient,
  row: OritScheduledSendRow,
): Promise<{ ok: boolean; error?: string }> {
  const { data: thread } = await supabase
    .from("orit_agent_threads")
    .select("*, orit_agent_mailbox(*)")
    .eq("id", row.thread_id)
    .maybeSingle();

  if (!thread) {
    await supabase.from("orit_agent_scheduled_sends").update({
      status: "failed",
      error_message: "thread_not_found",
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    return { ok: false, error: "thread_not_found" };
  }

  if (thread.status === "handled" || thread.status === "archived") {
    await supabase.from("orit_agent_scheduled_sends").update({
      status: "cancelled",
      error_message: "thread_closed",
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    return { ok: false, error: "thread_closed" };
  }

  const mailbox = thread.orit_agent_mailbox as OritMailboxRow;
  const finalText = row.body_text.trim();
  const kind = row.draft_kind;
  const sentAt = new Date().toISOString();

  try {
    if (row.channel === "whatsapp_bridge") {
      const waResult = await deliverOritGuestWhatsapp(
        supabase,
        thread.guest_contact_phone as string | null,
        finalText,
        row.thread_id,
      );
      if (!waResult.sent) throw new Error(waResult.error || "whapi_failed");

      const threadUpdate: Record<string, unknown> = {
        status: "awaiting_reply",
        orit_wa_contact_at: thread.orit_wa_contact_at || sentAt,
        orit_decision: thread.orit_decision || "whatsapp",
        orit_decision_at: thread.orit_decision_at || sentAt,
      };
      if (kind === "ack") {
        threadUpdate.auto_ack_sent_at = thread.auto_ack_sent_at || sentAt;
        threadUpdate.workflow_step = "awaiting_reply_approval";
      } else {
        threadUpdate.full_reply_sent_at = sentAt;
        threadUpdate.workflow_step = row.mark_handled ? null : "reply_sent";
      }
      await supabase.from("orit_agent_threads").update(threadUpdate).eq("id", row.thread_id);
      if (row.mark_handled) await closeOritThread(supabase, row.thread_id, { handledAt: sentAt });
    } else if (kind === "ack") {
      if (thread.is_demo) {
        await supabase.from("orit_agent_messages").insert({
          thread_id: row.thread_id,
          external_key: `demo-auto_ack-scheduled-${sentAt}`,
          direction: "outbound",
          body_text: finalText,
          received_at: sentAt,
          message_kind: "auto_ack",
        });
        await supabase.from("orit_agent_threads").update({
          auto_ack_sent_at: sentAt,
          workflow_step: "awaiting_reply_approval",
        }).eq("id", row.thread_id);
      } else if (mailbox.read_only_mode !== false) {
        throw new Error("read_only_mode");
      } else {
        const ackResult = await sendOritAckEmail(
          supabase,
          mailbox,
          thread,
          finalText,
          row.draft_id ?? undefined,
        );
        if (!ackResult.sent) throw new Error(ackResult.error || "ack_send_failed");
      }
      const mailboxAlert: OritAlertMailbox = {
        id: mailbox.id,
        digest_whatsapp_phone: (mailbox as Record<string, unknown>).digest_whatsapp_phone as string | null,
        alert_enabled: (mailbox as Record<string, unknown>).alert_enabled !== false,
        profile_id: mailbox.profile_id,
      };
      try {
        await notifyOritFullReplyReady(supabase, mailboxAlert, row.thread_id);
      } catch { /* non-blocking */ }
    } else {
      const delivery = await deliverOritThreadEmail(
        supabase,
        mailbox,
        {
          id: thread.id,
          from_email: thread.from_email,
          from_name: thread.from_name,
          guest_contact_email: thread.guest_contact_email ?? null,
          guest_contact_name: thread.guest_contact_name ?? null,
          subject: thread.subject,
          is_demo: thread.is_demo,
        },
        finalText,
        "manual_reply",
      );
      if (!delivery.sent && !thread.is_demo && mailbox.read_only_mode === false) {
        throw new Error(delivery.error || "email_send_failed");
      }
      await supabase.from("orit_agent_threads").update({
        workflow_step: row.mark_handled ? null : "reply_sent",
        full_reply_sent_at: sentAt,
        ...(row.mark_handled ? {} : { status: "awaiting_reply" }),
      }).eq("id", row.thread_id);
      if (row.mark_handled) await closeOritThread(supabase, row.thread_id, { handledAt: sentAt });
    }

    if (row.draft_id) {
      await supabase.from("orit_agent_drafts").update({
        status: "sent",
        final_text: finalText,
      }).eq("id", row.draft_id);
    }

    await saveOritStyleSample(
      supabase,
      row.mailbox_id,
      row.thread_id,
      kind === "ack" ? "complaint_ack" : (thread.category || "complaint"),
      finalText,
    );

    await supabase.from("orit_agent_scheduled_sends").update({
      status: "sent",
      sent_at: sentAt,
      updated_at: sentAt,
    }).eq("id", row.id);

    const mailboxAlert: OritAlertMailbox = {
      id: mailbox.id,
      digest_whatsapp_phone: (mailbox as Record<string, unknown>).digest_whatsapp_phone as string | null,
      alert_enabled: (mailbox as Record<string, unknown>).alert_enabled !== false,
      profile_id: mailbox.profile_id,
    };
    try {
      await notifyOritScheduledDispatched(supabase, mailboxAlert, thread as SigalBriefingThread, kind, row.channel);
    } catch { /* non-blocking */ }

    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message;
    await supabase.from("orit_agent_scheduled_sends").update({
      status: "failed",
      error_message: msg.slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    return { ok: false, error: msg };
  }
}

export async function dispatchDueOritScheduledSends(supabase: SupabaseClient): Promise<number> {
  const now = new Date().toISOString();
  const { data: due } = await supabase
    .from("orit_agent_scheduled_sends")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(20);

  let sent = 0;
  for (const row of (due ?? []) as OritScheduledSendRow[]) {
    const result = await executeOritScheduledSend(supabase, row);
    if (result.ok) sent += 1;
  }
  return sent;
}

export async function notifyAfterScheduleCreated(
  supabase: SupabaseClient,
  mailbox: OritAlertMailbox,
  thread: Record<string, unknown>,
  scheduledForIso: string,
  channel: OritScheduleChannel,
  draftKind: OritScheduleDraftKind,
): Promise<void> {
  try {
    await notifyOritScheduleCreated(
      supabase,
      mailbox,
      thread as SigalBriefingThread,
      scheduledForIso,
      channel,
      draftKind,
    );
  } catch { /* non-blocking */ }
}
