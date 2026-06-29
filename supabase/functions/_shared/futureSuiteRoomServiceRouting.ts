// Shared routing for future suite room-service / F&B portal requests.
// Mike directive: future Armonim/suite room-service alerts → dedicated Suites
// management Whapi group, not the general ops group or Adir DM.

/** Whapi group chat_id — used as `to` in sendWhapiText (same as WHAPI_GROUP_ID pattern). */
export const SUITES_ROOM_SERVICE_GROUP_ID = "120363429859248777@g.us";

export function futureArrivalDaysAway(
  arrivalDateStr: string | null | undefined,
  status: string | null | undefined,
): number | null {
  if (!arrivalDateStr || status === "checked_in") return null;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const arrival = new Date(`${arrivalDateStr}T00:00:00Z`);
  if (Number.isNaN(arrival.getTime())) return null;
  const daysAway = Math.round((arrival.getTime() - today.getTime()) / 86400000);
  return daysAway > 0 ? daysAway : null;
}

export function futureArrivalTag(
  arrivalDateStr: string | null | undefined,
  status: string | null | undefined,
): string | null {
  const daysAway = futureArrivalDaysAway(arrivalDateStr, status);
  if (daysAway == null) return null;
  return `⚠️ בקשה עתידית לתאריך ${arrivalDateStr} - בעוד ${daysAway} ימים`;
}

export function isFbRoomServiceDepartment(department: string | null | undefined): boolean {
  if (!department) return false;
  return department.includes("F&B") || department.includes('מזמ"ש');
}

export function isSuiteRoomServiceContext(opts: {
  roomType?: string | null;
  labelOrDescription?: string | null;
  source?: string | null;
}): boolean {
  if (opts.source === "portal_room_service") return true;
  const text = opts.labelOrDescription ?? "";
  if (/ארמונים|סוויט/i.test(text)) return true;
  const rt = opts.roomType ?? "";
  return rt === "suite" || /suite|סוויט|vip|penthouse/i.test(rt);
}

/** True when WhatsApp should go to SUITES_ROOM_SERVICE_GROUP_ID, not ops group / Adir. */
export function shouldRouteFutureSuiteRoomServiceToDedicatedPhone(opts: {
  arrivalDateStr?: string | null;
  status?: string | null;
  department?: string | null;
  labelOrDescription?: string | null;
  roomType?: string | null;
  source?: string | null;
}): boolean {
  if (futureArrivalDaysAway(opts.arrivalDateStr, opts.status) == null) return false;
  if (!isSuiteRoomServiceContext(opts)) return false;
  if (opts.source === "portal_room_service") return true;
  return isFbRoomServiceDepartment(opts.department);
}

/** SLA / task-level check when only task row fields are available. */
export function isFutureSuiteRoomServiceTask(task: {
  source?: string | null;
  department?: string | null;
  description?: string | null;
}): boolean {
  if (!(task.description ?? "").includes("בקשה עתידית")) return false;
  if (task.source === "portal_room_service") return true;
  return (
    isFbRoomServiceDepartment(task.department) &&
    isSuiteRoomServiceContext({ labelOrDescription: task.description, source: task.source })
  );
}
