// Guest feedback digest stats + Sigal copy for Orit (guest_feedback table).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  FEEDBACK_DASHBOARD_LINK_LABEL,
  feedbackDashboardNegativeInlineLinkLine,
} from "./feedbackDashboardLink.ts";

export type GuestFeedbackDigestRow = {
  sentiment: string;
  status: string;
  source: string;
  created_at: string;
};

export type GuestFeedbackDigestStats = {
  last24hTotal: number;
  last24hNegative: number;
  openNegative: number;
  last24hWaNegative: number;
};

const WA_FEEDBACK_SOURCES = new Set([
  "freeform_reflection",
  "severe_complaint",
  "facility_review",
  "bot_tool",
]);

export function computeGuestFeedbackDigestStats(
  last24hRows: GuestFeedbackDigestRow[],
  openNegative: number,
): GuestFeedbackDigestStats {
  const rows = last24hRows ?? [];
  const last24hNegative = rows.filter((r) => r.sentiment === "negative").length;
  const last24hWaNegative = rows.filter(
    (r) => r.sentiment === "negative" && WA_FEEDBACK_SOURCES.has(r.source),
  ).length;

  return {
    last24hTotal: rows.length,
    last24hNegative,
    openNegative: Math.max(0, openNegative),
    last24hWaNegative,
  };
}

export async function fetchGuestFeedbackDigestStats(
  supabase: SupabaseClient,
): Promise<GuestFeedbackDigestStats> {
  const since24h = new Date(Date.now() - 24 * 3_600_000).toISOString();

  const [{ data: recent, error: recentErr }, { count: openNegative, error: openErr }] = await Promise.all([
    supabase
      .from("guest_feedback")
      .select("sentiment, status, source, created_at")
      .gte("created_at", since24h),
    supabase
      .from("guest_feedback")
      .select("id", { count: "exact", head: true })
      .eq("sentiment", "negative")
      .eq("status", "open"),
  ]);

  if (recentErr) {
    console.warn("[guestFeedbackDigest] last24h fetch failed:", recentErr.message);
  }
  if (openErr) {
    console.warn("[guestFeedbackDigest] open negative count failed:", openErr.message);
  }

  return computeGuestFeedbackDigestStats(
    (recent ?? []) as GuestFeedbackDigestRow[],
    openNegative ?? 0,
  );
}

function shouldMentionWaHint(stats: GuestFeedbackDigestStats): boolean {
  return stats.last24hWaNegative > 0 || stats.openNegative > 0;
}

/** Daily morning block — appended to Sigal morning plan (not a push alert). */
export function composeSigalGuestFeedbackMorningNudge(stats: GuestFeedbackDigestStats): string {
  if (stats.last24hTotal === 0 && stats.openNegative === 0) return "";

  const lines: string[] = ["", "💬 משוב אורחים (מייל + וואטסאפ)"];

  if (stats.last24hTotal > 0) {
    const attention = stats.last24hNegative > 0
      ? ` — ${stats.last24hNegative} דורש${stats.last24hNegative === 1 ? "" : "ים"} תשומת לב`
      : "";
    lines.push(`ב-24 השעות האחרונות: ${stats.last24hTotal} משובים${attention}.`);
  } else {
    lines.push(
      `יש ${stats.openNegative} משוב${stats.openNegative === 1 ? "" : "ים"} שלילי${stats.openNegative === 1 ? "" : "ים"} פתוח${stats.openNegative === 1 ? "" : "ים"} בלוח.`,
    );
  }

  if (shouldMentionWaHint(stats)) {
    lines.push(
      "חלק מהתלונות מגיעות רק בוואטסאפ — כדאי לעבור על השליליים ולהגיב שם, לא רק במייל.",
    );
  }

  lines.push(FEEDBACK_DASHBOARD_LINK_LABEL);
  return lines.join("\n");
}

/** Light evening reminder when negative feedback is still open. */
export function composeSigalGuestFeedbackEveningReminder(openNegative: number): string {
  if (openNegative <= 0) return "";

  return [
    "",
    `💬 נשאר${openNegative === 1 ? "" : "ו"} ${openNegative} משוב שלילי פתוח בלוח — כדאי לעבור לפני מחר.`,
    FEEDBACK_DASHBOARD_LINK_LABEL,
  ].join("\n");
}

/** Daily Eliad morning pulse — feedback board link when there is activity or open negatives. */
export function composeEliadDailyFeedbackLinkBlock(stats: GuestFeedbackDigestStats): string {
  if (stats.last24hTotal === 0 && stats.openNegative === 0) return "";

  const lines: string[] = ["", "💬 משוב אורחים — לשיפור שירות"];
  if (stats.openNegative > 0) {
    lines.push(
      `${stats.openNegative} משוב${stats.openNegative === 1 ? "" : "ים"} שלילי${stats.openNegative === 1 ? "" : "ים"} פתוח${stats.openNegative === 1 ? "" : "ים"} בלוח`,
    );
  }
  if (stats.last24hNegative > 0) {
    lines.push(
      `ב-24 שעות: ${stats.last24hNegative} שלילי${stats.last24hNegative === 1 ? "" : "ים"}`,
    );
  } else if (stats.last24hTotal > 0) {
    lines.push(`ב-24 שעות: ${stats.last24hTotal} משובים חדשים`);
  }
  lines.push(feedbackDashboardNegativeInlineLinkLine());
  return lines.join("\n");
}

/** One-shot WA intro — staff-triggered, not tied to digest idempotency. */
export function composeEliadFeedbackIntroOneShot(stats: GuestFeedbackDigestStats): string {
  const lines: string[] = [
    "היי אליעד 👋",
    "",
    "מעכשיו יש לך לוח משוב מרוכז ב-XOS + אפשרות להוריד דוח Excel לשיפור שירות.",
  ];
  if (stats.openNegative > 0) {
    lines.push(
      `כרגע: ${stats.openNegative} משוב${stats.openNegative === 1 ? "" : "ים"} שלילי${stats.openNegative === 1 ? "" : "ים"} פתוח${stats.openNegative === 1 ? "" : "ים"} בלוח.`,
    );
  } else if (stats.last24hTotal > 0) {
    lines.push(`ב-24 שעות האחרונות: ${stats.last24hTotal} משובים חדשים.`);
  }
  lines.push("", "לצפייה (נפתח על השליליים):");
  lines.push(feedbackDashboardNegativeInlineLinkLine().replace(/^📊 /, ""));
  lines.push("", "בלוח למעלה: כפתור «📥 דוח משוב לשיפור שירות» להורדת קובץ מסודר.");
  return lines.join("\n");
}

/** On-demand pulse — «משוב אורחים» in Sigal chat. */
export function composeSigalGuestFeedbackPulse(stats: GuestFeedbackDigestStats): string {
  const lines: string[] = [
    "היי אורית 💜",
    "סיכום משוב אורחים:",
    "",
  ];

  if (stats.last24hTotal === 0 && stats.openNegative === 0) {
    lines.push("✅ אין משוב חדש ב-24 השעות האחרונות ואין שליליים פתוחים — יופי!");
  } else {
    if (stats.last24hTotal > 0) {
      const attention = stats.last24hNegative > 0
        ? ` (${stats.last24hNegative} שלילי${stats.last24hNegative === 1 ? "" : "ים"})`
        : "";
      lines.push(`📥 ב-24 שעות: ${stats.last24hTotal} משובים${attention}`);
    }
    if (stats.openNegative > 0) {
      lines.push(`🔴 פתוחים בלוח: ${stats.openNegative} שלילי${stats.openNegative === 1 ? "" : "ים"}`);
    }
    if (shouldMentionWaHint(stats)) {
      lines.push(
        "חלק מגיע רק בוואטסאפ — עברי על השליליים בלוח והגיבי שם כשיש טלפון.",
      );
    }
  }

  lines.push("", FEEDBACK_DASHBOARD_LINK_LABEL);
  return lines.join("\n");
}
