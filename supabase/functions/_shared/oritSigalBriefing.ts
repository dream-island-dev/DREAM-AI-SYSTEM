// Sigal → Orit human briefing copy (analyze first, then one warm package).

import { buildStaffAppDeepLink } from "./guestAlertWhapiNotify.ts";
import {
  resolveOritReplyEmail,
  resolveOritReplyName,
} from "./oritGuestContactExtract.ts";
import type { OritAlertThread } from "./oritAgentWhapiAlert.ts";
import {
  composeSigalWaBridgeAdvice,
  normalizeOritGuestPhoneDigits,
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

function urgencyLead(urgency: string): string {
  if (urgency === "critical") return "זו תלונה חמורה שדורשת אותך";
  if (urgency === "high") return "זו תלונה דחופה";
  return "יש פנייה שכדאי לטפל בה";
}

/** Initial complaint briefing — ack + full reply ready before WA to Orit. */
export function composeSigalComplaintBriefing(
  thread: SigalBriefingThread,
  ackDraft: string,
  fullReplyDraft: string,
): string {
  const guest = sigalGuestLabel(thread);
  const summary = thread.ai_summary?.trim() || thread.subject?.trim() || "פנייה שדורשת טיפול";
  const link = buildStaffAppDeepLink({ page: "orit_cs_agent", threadId: thread.id });
  const channel = resolveOritOutboundChannel(thread);

  const lines = [
    "היי אורית 💜",
    `קראתי את המייל מ־${guest}. ${urgencyLead(thread.urgency)}.`,
    "",
    "בקצרה מה שקרה:",
    summary,
    "",
  ];

  if (channel === "whatsapp_bridge") {
    lines.push(composeSigalWaBridgeAdvice(thread), "");
    lines.push("הכנתי הודעה מסוגננת לוואטסאפ:", "─────────────");
    lines.push(truncate(ackDraft, 800), "─────────────", "");
    lines.push(
      "«שלחי בוואטסאפ» → «כן שלחי»",
      "אחרי שטיפלת — «סיימתי».",
      "",
      link,
    );
    return lines.join("\n");
  }

  if (channel === "blocked") {
    lines.push(
      "⚠ חסרים מייל וטלפון תקינים — הוסיפי פרטי קשר במערכת:",
      link,
    );
    return lines.join("\n");
  }

  lines.push(
    "הכנתי לך הכל בסגנון שלך — קודם מייל קצר «קיבלנו את פנייתך», ואחריו מכתב מלא שמטפל בנקודות שהעלו.",
    "",
    "א׳ — אישור קבלה (לשליחה ראשונה):",
    "─────────────",
    truncate(ackDraft, 600),
    "─────────────",
    "",
    "ב׳ — מכתב תשובה מלא (אחרי שאישור הקבלה יצא):",
    "─────────────",
    truncate(fullReplyDraft, 1000),
    "─────────────",
    "",
    "איך נתקדם?",
    "• לשלוח את הקבלה — «תראי לי» ואז «כן שלחי»",
    "• לראות שוב את התשובה המלאה — «תשובה מלאה»",
    "• אחרי שטיפלת (גם בטלפון) — «סיימתי» או «טיפלתי בזה»",
    "",
    "לעריכה נוחה במחשב:",
    link,
  );
  return lines.join("\n");
}

/** Simpler briefing for non-urgent complaints / single-step replies. */
export function composeSigalSimpleBriefing(
  thread: SigalBriefingThread,
  replyDraft: string,
): string {
  const guest = sigalGuestLabel(thread);
  const summary = thread.ai_summary?.trim() || thread.subject?.trim() || "פנייה חדשה";
  const link = buildStaffAppDeepLink({ page: "orit_cs_agent", threadId: thread.id });

  const channel = resolveOritOutboundChannel(thread);
  const lines = [
    "היי אורית 💜",
    `הגיע מייל מ־${guest}.`,
    "",
    summary,
    "",
  ];

  if (channel === "whatsapp_bridge") {
    lines.push(composeSigalWaBridgeAdvice(thread), "", "הכנתי טיוטה:", "─────────────");
    lines.push(truncate(replyDraft, 1200), "─────────────", "", "«שלחי בוואטסאפ» → «כן שלחי»", "", link);
    return lines.join("\n");
  }

  return [
    ...lines,
    "הכנתי לך טיוטת מענה:",
    "─────────────",
    truncate(replyDraft, 1200),
    "─────────────",
    "",
    "«תראי לי» / «תשובה מלאה» — ואז «כן שלחי» לשליחה.",
    "«סיימתי» כשסגרנו את הנושא.",
    "",
    link,
  ].join("\n");
}

/** Guest replied after outbound — warm coaching with draft. */
export function composeSigalGuestReplyBriefing(
  thread: SigalBriefingThread,
  guestMessage: string,
  followUpDraft: string | null,
): string {
  const guest = sigalGuestLabel(thread);
  const link = buildStaffAppDeepLink({ page: "orit_cs_agent", threadId: thread.id });

  const lines = [
    "היי אורית 💜",
    `${guest} השיב/ה למייל:`,
    "─────────────",
    guestMessage.trim(),
    "─────────────",
    "",
  ];

  const hasPhone = Boolean(normalizeOritGuestPhoneDigits(thread.guest_contact_phone));
  const waHint = hasPhone ? " · «שלחי בוואטסאפ» — מכשיר הסוויטות" : "";

  if (followUpDraft?.trim()) {
    lines.push(
      "הכנתי לך המשך בסגנון שלך:",
      "─────────────",
      truncate(followUpDraft, 1000),
      "─────────────",
      "",
      `«תשובה מלאה» לראות שוב · «כן שלחי» למייל${waHint} · «סיימתי» אם סגרת.`,
      "",
      link,
    );
  } else {
    lines.push(
      "אני מסיימת לנסח את התשובה — אפשר כבר לפתוח בממשק.",
      "",
      `«תשובה מלאה» בעוד רגע${waHint} · «סיימתי» אם סגרת.`,
      "",
      link,
    );
  }

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
  const lines = [
    "היי אורית 💜",
    `${guest} השיב/ה בוואטסאפ:`,
    "─────────────",
    guestMessage.trim(),
    "─────────────",
    "",
    "בואי נסגור את זה במייל כשאפשר.",
  ];

  if (followUpDraft?.trim()) {
    lines.push(
      "",
      "הכנתי לך המשך בסגנון שלך:",
      "─────────────",
      truncate(followUpDraft, 1000),
      "─────────────",
      "",
      "«תשובה מלאה» · «כן שלחי» · «סיימתי»",
    );
  }

  if (inboxLink) {
    lines.push("", "👉 לשיחה באינבוקס:", inboxLink);
  }

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
  lines.push("", "▶️ לכל התיבה:", buildStaffAppDeepLink({ page: "orit_cs_agent" }));

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
  lines.push("", "מחר בבוקר אשלח שוב תוכנית פעולה.", "");
  lines.push("▶️ לכל התיבה:", buildStaffAppDeepLink({ page: "orit_cs_agent" }));

  return lines.join("\n");
}

export function composeSigalAckSentFollowUp(guest: string): string {
  return [
    `✓ שלחתי ל־${guest} את אישור הקבלה.`,
    "",
    "המכתב המלא כבר מוכן מראש (ראית אותו בהודעה הראשונה).",
    "כשתרצי לשלוח — «תשובה מלאה» ואז «כן שלחי».",
    "אם טיפלת בטלפון או סגרת אחרת — «סיימתי».",
  ].join("\n");
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
    return "אישור הקבלה יצא — מכתב התשובה המלא עדיין ממתין";
  }
  if (resolveOritOutboundChannel(thread) === "whatsapp_bridge") {
    return "עדיין לא יצאה הודעה לוואטסאפ";
  }
  return "עדיין לא יצא אישור קבלה לאורח/ת";
}

function escalationPrefix(level: 1 | 2 | 3): string {
  if (level === 3) return "אורית, זה דחוף — עדיין פתוח 🔴";
  if (level === 2) return "אורית, עדיין ממתין לטיפול שלך 🟠";
  return "אורית, רק מזכירה בעדינות 💜";
}

function phaseCtas(phase: SigalLoopPhase): string {
  if (phase === "guest_replied") {
    return "«תשובה מלאה» — טיוטת המשך · «כן שלחי» · «סיימתי» לסגירה.";
  }
  if (phase === "awaiting_close") {
    return "«מה המצב» — איפה אנחנו · «סיימתי» — לסגור את הפנייה.";
  }
  if (phase === "awaiting_full_reply") {
    return "«תשובה מלאה» — לראות טיוטה · «כן שלחי» לשלוח · «סיימתי» לסגור.";
  }
  return "«תראי לי» — אישור קבלה · «תשובה מלאה» — מכתב מלא · «סיימתי» לסגור.";
}

/** Phase-aware Sigal loop nudge until Orit marks handled. */
export function composeSigalLoopNudge(
  thread: SigalBriefingThread,
  phase: SigalLoopPhase,
  level: 1 | 2 | 3,
): string {
  const guest = sigalGuestLabel(thread);
  const summary = truncate(thread.ai_summary?.trim() || thread.subject || "תלונה פתוחה", 200);
  const link = buildStaffAppDeepLink({ page: "orit_cs_agent", threadId: thread.id });

  return [
    escalationPrefix(level),
    "",
    `תלונה פתוחה מ־${guest}: ${summary}`,
    `${phaseNudge(phase, thread)}.`,
    "",
    phaseCtas(phase),
    "",
    link,
  ].join("\n");
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
