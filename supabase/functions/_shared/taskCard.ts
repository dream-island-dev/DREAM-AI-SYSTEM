// supabase/functions/_shared/taskCard.ts
// Compact English Whapi ops-group task card — shared by whapi-webhook and
// notify-manual-task. Completion is 👍🏼 on the message id, not this wording.

function sourceTag(source: string | null): string | null {
  if (source === "guest_request") return "[BOT]";
  if (source === "inbox_routed") return "[GUEST WA]";
  if (source === "manual") return "[MANUAL TASK]";
  if (source === "front_desk_voice") return "[FRONT DESK]";
  if (source === "executive_voice") return "[EXEC VOICE]";
  return null;
}

function joinCard(lines: Array<string | null | false | undefined>): string {
  return lines.filter((l): l is string => typeof l === "string" && l.length > 0).join("\n");
}

/** Staff Whapi group card — whapi-webhook staff reports & voice transcriptions. */
export function buildTaskCard(
  room: string | null,
  desc: string,
  assigneeLine: string | null,
  fromVoice = false,
): string {
  return joinCard([
    `📌 Suite ${room ?? "—"}`,
    fromVoice ? "🎤 voice" : null,
    desc,
    assigneeLine,
    "👉 Please react with 👍🏼 to complete this task.",
  ]);
}

/** In-app / inbox-routed / HITL-approved guest tasks — same layout + source tag. */
export function buildStaffDispatchedTaskCard(
  room: string | null,
  desc: string,
  assigneeLine: string | null,
  source: string | null,
): string {
  return joinCard([
    `📌 Suite ${room ?? "—"}`,
    sourceTag(source),
    desc,
    assigneeLine,
    "👉 Please react with 👍🏼 to complete this task.",
  ]);
}
