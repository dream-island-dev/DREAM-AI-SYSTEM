// supabase/functions/_shared/taskCard.ts
// Structured English Whapi ops-group task card — shared by whapi-webhook (staff
// group reports) and notify-manual-task (in-app / inbox-routed / guest_request).

/** Staff Whapi group card — whapi-webhook staff reports & voice transcriptions. */
export function buildTaskCard(
  room: string | null,
  desc: string,
  assigneeLine: string | null,
  fromVoice = false,
): string {
  return [
    `📌 New Task Opened: Suite ${room ?? "—"}`,
    ...(fromVoice ? [`🎤 Transcribed from voice:`] : []),
    `📋 Task: ${desc}`,
    `⏰ Status: Pending`,
    ...(assigneeLine ? [assigneeLine] : []),
    `👉 Please react with 👍🏼 to complete this task.`,
  ].join("\n");
}

/** In-app / inbox-routed / HITL-approved guest tasks — same layout + source tag. */
export function buildStaffDispatchedTaskCard(
  room: string | null,
  desc: string,
  assigneeLine: string | null,
  source: string | null,
): string {
  // guest_request = bot/portal HITL path — must stay visually distinct from
  // inbox_routed (staff manually routed from Inbox). Same card layout either way.
  const sourceTag =
    source === "guest_request" ? "[BOT]"
      : source === "inbox_routed" ? "[GUEST WA]"
      : source === "manual" ? "[MANUAL TASK]"
      : null;

  return [
    `📌 New Task Opened: Suite ${room ?? "—"}`,
    ...(sourceTag ? [`📍 Source: ${sourceTag}`] : []),
    `📋 Task: ${desc}`,
    `⏰ Status: Pending`,
    ...(assigneeLine ? [assigneeLine] : []),
    `👉 Please react with 👍🏼 to complete this task.`,
  ].join("\n");
}
