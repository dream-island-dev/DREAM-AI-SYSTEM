// Sigal → Orit human briefing copy (analyze first, then one warm package).

import {
  resolveOritReplyEmail,
  resolveOritReplyName,
} from "./oritGuestContactExtract.ts";
import type { OritAlertThread } from "./oritAgentWhapiAlert.ts";
import {
  composeOritCsMobileLinkLine,
  resolveOritOutboundChannel,
} from "./oritGuestOutbound.ts";

export type SigalBriefingThread = OritAlertThread & {
  received_at?: string | null;
  auto_ack_sent_at?: string | null;
  full_reply_sent_at?: string | null;
  orit_wa_contact_at?: string | null;
  workflow_step?: string | null;
  sigal_last_reminder_at?: string | null;
};

export type MorningActionRow = {
  id: string;
  subject: string;
  from_name: string | null;
  guest_contact_name?: string | null;
  guest_contact_phone?: string | null;
  guest_contact_email?: string | null;
  from_email?: string;
  urgency: string;
  ai_summary: string | null;
  overdue: boolean;
  hours_over?: number;
  hours_left?: number;
  hasAckDraft: boolean;
  hasFullDraft: boolean;
  channel: ReturnType<typeof resolveOritOutboundChannel>;
  initialSent: boolean;
};

function truncate(text: string, max: number): string {
  const t = (text || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export function sigalGuestLabel(thread: SigalBriefingThread): string {
  const name = resolveOritReplyName(thread.from_name, thread.guest_contact_name);
  if (name && !name.includes("@")) return name;
  const email = resolveOritReplyEmail(thread.from_email ?? "", thread.guest_contact_email);
  return email || "האורח/ת";
}

function urgencyEmoji(urgency: string): string {
  if (urgency === "critical") return "🔴";
  if (urgency === "high") return "🟠";
  return "🟡";
}

function draftReadyLabel(text: string | null | undefined): string {
  return text?.trim() ? "מוכן" : "בהכנה";
}

function sigalMobileAppLink(thread: SigalBriefingThread): string | null {
  const id = thread.id?.trim();
  return id ? composeOritCsMobileLinkLine(id) : null;
}

function hasInitialAckSent(thread: SigalBriefingThread): boolean {
  return Boolean(thread.auto_ack_sent_at || thread.orit_wa_contact_at);
}

/** Guest-facing ack line — what Orit approves first (before full letter). */
export const SIGAL_ACK_GUEST_PHRASE = "קיבלנו את פנייתך";

/** Initial complaint alert — pulse only; drafts on demand via «תראי לי» / «תשובה מלאה». */
export function composeSigalComplaintBriefing(
  thread: SigalBriefingThread,
  ackDraft: string,
  fullReplyDraft: string,
): string {
  const guest = sigalGuestLabel(thread);
  const summary = truncate(thread.ai_summary?.trim() || thread.subject?.trim() || "תלונה", 120);
  const channel = resolveOritOutboundChannel(thread);
  const urg = urgencyEmoji(thread.urgency);

  const appLink = sigalMobileAppLink(thread);

  if (channel === "blocked") {
    return [
      `${urg} תלונה מ${guest}`,
      summary,
      "⚠ חסרים מייל וטלפון — כתבי לי את פרטי האורח/ת",
    ].join("\n");
  }

  if (channel === "whatsapp_bridge") {
    if (!hasInitialAckSent(thread)) {
      const lines = [
        `היי אורית 💜 ${urg} תלונה מ${guest}`,
        summary,
        `שלב 1 — האורח מחכה להודעה קצרה (${draftReadyLabel(ackDraft)}).`,
        `"שלחי בוואטסאפ" ואז "כן שלחי".`,
        "אחרי זה נכין את המכתב המלא.",
      ];
      if (appLink) lines.push(appLink);
      return lines.join("\n");
    }
    const lines = [
      `היי אורית 💜 ${guest} — ההודעה הראשונה בוואטסאפ יצאה ✓`,
      `עכשיו המכתב המלא (${draftReadyLabel(fullReplyDraft)}) — "תשובה מלאה".`,
      '"סיימתי" לסגירה',
    ];
    if (appLink) lines.push(appLink);
    return lines.join("\n");
  }

  if (!hasInitialAckSent(thread)) {
    const lines = [
      `היי אורית 💜 ${urg} תלונה מ${guest}`,
      summary,
      `שלב 1 (דחוף): הודעה קצרה «${SIGAL_ACK_GUEST_PHRASE}» — ${draftReadyLabel(ackDraft)}.`,
      '"תראי לי" לראות ולשלוח · אחר כך נכין את המכתב המלא.',
      '"תסדרי…" לשינוי נוסח',
    ];
    if (appLink) lines.push(appLink);
    return lines.join("\n");
  }

  if (!thread.full_reply_sent_at) {
    const lines = [
      `היי אורית 💜 ${guest} — «${SIGAL_ACK_GUEST_PHRASE}» כבר נשלח ✓`,
      `שלב 2: המכתב המלא (${draftReadyLabel(fullReplyDraft)}) — "תשובה מלאה".`,
      '"סיימתי" לסגירה',
    ];
    if (appLink) lines.push(appLink);
    return lines.join("\n");
  }

  const lines = [
    `היי אורית 💜 ${guest} — נשלחו שתי ההודעות ✓`,
    'רק לוודא שסגרנו — "סיימתי"',
  ];
  if (appLink) lines.push(appLink);
  return lines.join("\n");
}

/** Simpler briefing for non-urgent complaints / single-step replies. */
export function composeSigalSimpleBriefing(
  thread: SigalBriefingThread,
  replyDraft: string,
): string {
  const guest = sigalGuestLabel(thread);
  const summary = truncate(thread.ai_summary?.trim() || thread.subject?.trim() || "פנייה חדשה", 120);
  const channel = resolveOritOutboundChannel(thread);
  const ready = draftReadyLabel(replyDraft);

  const appLink = sigalMobileAppLink(thread);

  if (channel === "whatsapp_bridge") {
    const lines = [
      `היי אורית 💜 פנייה מ${guest}`,
      summary,
      `טיוטה ${ready} — "שלחי בוואטסאפ" ואז "כן שלחי".`,
    ];
    if (appLink) lines.push(appLink);
    return lines.join("\n");
  }

  const lines = [
    `היי אורית 💜 פנייה מ${guest}`,
    summary,
    `טיוטה ${ready} — "תראי לי" לשליחה · "סיימתי" לסגירה`,
  ];
  if (appLink) lines.push(appLink);
  return lines.join("\n");
}

/** Guest replied after outbound — pulse + on-demand draft. */
export function composeSigalGuestReplyBriefing(
  thread: SigalBriefingThread,
  guestMessage: string,
  followUpDraft: string | null,
): string {
  const guest = sigalGuestLabel(thread);
  const snippet = truncate(guestMessage.trim(), 160);
  const ready = draftReadyLabel(followUpDraft);

  const appLink = sigalMobileAppLink(thread);
  const lines = [
    `היי אורית 💜 ${guest} השיב/ה:`,
    `"${snippet}"`,
    `טיוטת המשך ${ready} — "תשובה מלאה" ואז "כן שלחי".`,
    '"סיימתי" לסגירה',
  ];
  if (appLink) lines.push(appLink);
  return lines.join("\n");
}

/** Guest replied on WhatsApp bridge thread. */
export function composeSigalGuestWaReplyBriefing(
  thread: SigalBriefingThread,
  guestMessage: string,
  followUpDraft: string | null,
  inboxLink: string | null,
): string {
  const guest = sigalGuestLabel(thread);
  const snippet = truncate(guestMessage.trim(), 160);
  const ready = draftReadyLabel(followUpDraft);
  const lines = [
    `היי אורית 💜 ${guest} בוואטסאפ:`,
    `«${snippet}»`,
    `טיוטת המשך ${ready} — «תשובה מלאה» → «כן שלחי»`,
  ];
  if (inboxLink) lines.push(inboxLink);
  return lines.join("\n");
}

function morningUrgencyEmoji(urgency: string): string {
  if (urgency === "critical") return "🔴";
  if (urgency === "high") return "🟠";
  return "🟡";
}

function morningGuestLabel(row: MorningActionRow): string {
  const name = row.guest_contact_name?.trim() || row.from_name?.trim();
  if (name && !name.includes("@")) return name;
  return "אורח/ת";
}

function morningActionLine(row: MorningActionRow): string {
  const guest = morningGuestLabel(row);
  const sla = row.overdue
    ? `(עבר SLA · ${row.hours_over}ש')`
    : row.hours_left != null
      ? `(נשארו ${row.hours_left}ש')`
      : "";

  if (row.channel === "blocked") {
    return `⚠ ${guest} — חסרים מייל וטלפון`;
  }
  if (!row.initialSent) {
    if (row.channel === "whatsapp_bridge" && row.hasAckDraft) {
      return `📱 ${guest} ${sla} — טיוטת וואטסאפ מוכנה · «שלחי בוואטסאפ»`;
    }
    if (row.hasAckDraft && row.hasFullDraft) {
      return `${morningUrgencyEmoji(row.urgency)} ${guest} ${sla} — קבלה + מכתב מוכנים · «תראי לי»`;
    }
    if (row.hasFullDraft) {
      return `${morningUrgencyEmoji(row.urgency)} ${guest} ${sla} — טיוטה מוכנה · «תשובה מלאה»`;
    }
    return `${morningUrgencyEmoji(row.urgency)} ${guest} ${sla} — מכינה טיוטות…`;
  }
  if (!row.hasFullDraft || !row.initialSent) {
    return `${morningUrgencyEmoji(row.urgency)} ${guest} — ממתינה לתשובה המלאה · «תשובה מלאה»`;
  }
  return `${morningUrgencyEmoji(row.urgency)} ${guest} — נשלחה תשובה · «סיימתי» לסגירה`;
}

/** Morning action plan — what Orit should do first today. */
export function composeSigalMorningActionPlan(data: {
  openComplaints: MorningActionRow[];
  leadsLast24h: number;
  otherOpenCount: number;
  handledYesterday: number;
}): string {
  const lines: string[] = [
    "היי אורית 💜",
    "כאן סיגל — תוכנית הבוקר שלך.",
    `📅 ${new Date().toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" })}`,
    "",
  ];

  if (data.openComplaints.length) {
    lines.push(`😤 לטיפול היום (${data.openComplaints.length}):`);
    for (const row of data.openComplaints.slice(0, 6)) {
      const summary = (row.ai_summary || row.subject || "").split("\n")[0].slice(0, 80);
      lines.push(morningActionLine(row));
      if (summary) lines.push(`   ${summary}`);
    }
    lines.push("", `התחילי מ־${morningGuestLabel(data.openComplaints[0])} ↑`, "");
  } else {
    lines.push("✅ אין תלונות פתוחות — יופי!", "");
  }

  if (data.leadsLast24h > 0) {
    lines.push(`📈 לידים ב-24 שעות: ${data.leadsLast24h} — לא דחוף.`, "");
  }

  if (data.otherOpenCount > 0) {
    lines.push(`📬 פניות אחרות פתוחות: ${data.otherOpenCount}`, "");
  }

  lines.push(`✅ טופל אתמול: ${data.handledYesterday}`);
  lines.push("", "«מה המצב» לסטטוס + לינק לממשק · «עזרה» לפקודות");

  return lines.join("\n");
}

function eveningStatusLine(row: MorningActionRow): string {
  const guest = morningGuestLabel(row);
  if (!row.initialSent) {
    if (row.channel === "whatsapp_bridge") {
      return `• ${guest} — עדיין לא יצאה הודעה בוואטסאפ`;
    }
    return `• ${guest} — ממתינה לאישור קבלה ראשון`;
  }
  if (!row.hasFullDraft) {
    return `• ${guest} — אישור יצא, מכתב מלא עדיין בהכנה`;
  }
  return `• ${guest} — טיוטה מוכנה, עדיין פתוח`;
}

/** Evening wrap-up — what's still open before tomorrow. */
export function composeSigalEveningActionPlan(data: {
  openComplaints: MorningActionRow[];
  otherOpenCount: number;
  handledToday: number;
}): string {
  const weekday = new Date().toLocaleDateString("he-IL", {
    timeZone: "Asia/Jerusalem",
    weekday: "long",
  });
  const dateStr = new Date().toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" });

  const lines: string[] = [
    "היי אורית 💜",
    "כאן סיגל — סיכום ערב.",
    `📅 ${weekday}, ${dateStr}`,
    "",
  ];

  if (data.openComplaints.length) {
    lines.push(`📌 נשאר פתוח (${data.openComplaints.length}):`);
    for (const row of data.openComplaints.slice(0, 8)) {
      lines.push(eveningStatusLine(row));
      const summary = (row.ai_summary || row.subject || "").split("\n")[0].slice(0, 70);
      if (summary) lines.push(`   ${summary}`);
    }
    lines.push("");
  } else {
    lines.push("✅ הכל סגור להיום — יופי!", "");
  }

  if (data.otherOpenCount > 0) {
    lines.push(`📬 פניות אחרות פתוחות: ${data.otherOpenCount}`, "");
  }

  lines.push(`✅ טופל היום: ${data.handledToday}`);
  lines.push("", "מחר בבוקר אשלח שוב תוכנית פעולה.", "«עזרה» לפקודות");

  return lines.join("\n");
}

export function composeSigalAckSentFollowUp(guest: string, threadId?: string | null): string {
  const lines = [
    `✓ «${SIGAL_ACK_GUEST_PHRASE}» נשלח ל${guest}.`,
    "עכשיו שלב 2 — המכתב המלא: \"תשובה מלאה\" או ערכי בממשק.",
    '"סיימתי" כשסגרנו את הנושא',
  ];
  const id = threadId?.trim();
  if (id) lines.push(composeOritCsMobileLinkLine(id));
  return lines.join("\n");
}

export function composeSigalStaleReminder(thread: SigalBriefingThread): string {
  return composeSigalLoopNudge(thread, resolveSigalLoopPhase(thread), sigalReminderEscalationLevel(thread));
}

export type SigalLoopPhase =
  | "awaiting_ack"
  | "awaiting_full_reply"
  | "guest_replied"
  | "awaiting_close";

export function resolveSigalLoopPhase(thread: SigalBriefingThread): SigalLoopPhase {
  if (thread.workflow_step === "guest_replied") return "guest_replied";
  if (thread.full_reply_sent_at) return "awaiting_close";
  if (thread.auto_ack_sent_at || thread.orit_wa_contact_at) return "awaiting_full_reply";
  return "awaiting_ack";
}

export function sigalLoopTiming(urgency: string): { staleHours: number; cooldownHours: number } {
  if (urgency === "critical") return { staleHours: 1.5, cooldownHours: 2 };
  if (urgency === "high") return { staleHours: 2.5, cooldownHours: 3 };
  return { staleHours: 4, cooldownHours: 4 };
}

export function sigalReminderEscalationLevel(thread: SigalBriefingThread): 1 | 2 | 3 {
  const received = thread.received_at ? new Date(thread.received_at).getTime() : Date.now();
  const hoursOpen = (Date.now() - received) / 3_600_000;
  const urgency = thread.urgency || "normal";

  if (urgency === "critical") {
    if (hoursOpen >= 8) return 3;
    if (hoursOpen >= 4) return 2;
    return 1;
  }
  if (urgency === "high") {
    if (hoursOpen >= 12) return 3;
    if (hoursOpen >= 6) return 2;
    return 1;
  }
  if (hoursOpen >= 24) return 3;
  if (hoursOpen >= 12) return 2;
  return 1;
}

function phaseNudge(phase: SigalLoopPhase, thread: SigalBriefingThread): string {
  if (phase === "guest_replied") {
    return "האורח/ת השיב/ה למייל — צריך מענה המשך";
  }
  if (phase === "awaiting_close") {
    return "נשלחה תשובה — רק לוודא שסגרנו את הנושא";
  }
  if (phase === "awaiting_full_reply") {
    return `«${SIGAL_ACK_GUEST_PHRASE}» כבר יצא — המכתב המלא עדיין ממתין`;
  }
  if (resolveOritOutboundChannel(thread) === "whatsapp_bridge") {
    return "האורח עדיין לא קיבל הודעה ראשונה בוואטסאפ";
  }
  return `האורח עדיין לא קיבל «${SIGAL_ACK_GUEST_PHRASE}»`;
}

function phaseCtas(phase: SigalLoopPhase): string {
  if (phase === "guest_replied") return '"תשובה מלאה" · "סיימתי"';
  if (phase === "awaiting_close") return '"סיימתי" לסגירה';
  if (phase === "awaiting_full_reply") return '"תשובה מלאה" למכתב המלא';
  return '"תראי לי" לשליחת «קיבלנו את פנייתך»';
}

function escalationPrefix(level: 1 | 2 | 3): string {
  if (level === 3) return "אורית, זה דחוף — עדיין פתוח 🔴";
  if (level === 2) return "אורית, עדיין ממתין לטיפול שלך 🟠";
  return "אורית, רק מזכירה בעדינות 💜";
}

/** Phase-aware Sigal loop nudge until Orit marks handled. */
export function composeSigalLoopNudge(
  thread: SigalBriefingThread,
  phase: SigalLoopPhase,
  level: 1 | 2 | 3,
): string {
  const guest = sigalGuestLabel(thread);
  const summary = truncate(thread.ai_summary?.trim() || thread.subject || "תלונה פתוחה", 200);

  const lines = [
    escalationPrefix(level),
    "",
    `תלונה פתוחה מ${guest}: ${summary}`,
    `${phaseNudge(phase, thread)}.`,
    "",
    phaseCtas(phase),
  ];
  const appLink = sigalMobileAppLink(thread);
  if (appLink) lines.push("", appLink);
  return lines.join("\n");
}

export function areSigalBriefingDraftsReady(
  ackText: string | null | undefined,
  fullText: string | null | undefined,
  workflowComplaint: boolean,
): boolean {
  if (workflowComplaint) {
    return Boolean(ackText?.trim() && fullText?.trim());
  }
  return Boolean(fullText?.trim() || ackText?.trim());
}
