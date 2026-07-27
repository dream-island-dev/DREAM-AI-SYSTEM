// Deep links to Guest Feedback dashboard — zero I/O, shared by digest crons + Sigal WA.

const STAFF_APP_ORIGIN = "https://dream-ai-system.vercel.app";

/** Hebrew hint in the primary message; URL goes in a follow-up Whapi message (iOS RTL-safe). */
export const FEEDBACK_DASHBOARD_LINK_LABEL =
  "👉 לצפייה בלוח משוב אורחים — הקישור בהודעה הבאה ↓";

export function buildFeedbackDashboardDeepLink(opts?: { focus?: "negative" }): string {
  const params = new URLSearchParams({ page: "feedback_dashboard" });
  if (opts?.focus === "negative") params.set("focus", "negative");
  return `${STAFF_APP_ORIGIN}/?${params.toString()}`;
}

/** Eliad / managers — open feedback board on negative tab first. */
export function buildFeedbackDashboardNegativeDeepLink(): string {
  return buildFeedbackDashboardDeepLink({ focus: "negative" });
}

/** URL-only body for follow-up message (LTR mark for iOS WhatsApp). */
export function composeFeedbackDashboardLinkUrl(): string {
  return `\u200E${buildFeedbackDashboardDeepLink()}`;
}

export function messageExpectsFeedbackDashboardLinkFollowUp(body: string): boolean {
  return (body || "").includes(FEEDBACK_DASHBOARD_LINK_LABEL);
}

/** Inline URL for Eliad digest (same pattern as weekly resort digest survey section). */
export function feedbackDashboardInlineLinkLine(): string {
  return `📊 ${buildFeedbackDashboardDeepLink()}`;
}

/** Daily CEO pulse — link + open-negative focus for service improvement. */
export function feedbackDashboardNegativeInlineLinkLine(): string {
  return `📊 ${buildFeedbackDashboardNegativeDeepLink()}`;
}

export function isIsraelSunday(now: Date = new Date()): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    weekday: "short",
  }).format(now);
  return weekday === "Sun";
}
