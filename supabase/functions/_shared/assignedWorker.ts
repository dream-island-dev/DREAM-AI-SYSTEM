// supabase/functions/_shared/assignedWorker.ts
//
// Department → on-duty worker lookup for Whapi task cards.
// Reads live from `profiles` (name + phone E.164, migration 070) — fully
// dynamic, not a hardcoded map. No shift/availability signal exists yet, so
// this is "first phone on file for the department" — best-effort; a miss just
// means the card has no assignee line.
//
// Kept for future shift-aware assignment. Task cards no longer show
// 👤 Assigned (best-effort first-phone-per-department mislabeled leadership).
// Do not wire assigneeCardLine back into Whapi cards without a real roster.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type AssignedWorker = {
  name: string;
  phone: string;
};

export async function findAssignedWorker(
  supabase: ReturnType<typeof createClient>,
  department: string | null,
  logTag = "assigned-worker",
): Promise<AssignedWorker | null> {
  if (!department) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("name, phone")
    .eq("department", department)
    .not("phone", "is", null)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(`[${logTag}] lookup failed for department "${department}":`, error.message);
    return null;
  }
  const phone = String(data?.phone ?? "").trim();
  if (!phone) return null;
  const name = String(data?.name ?? "").trim();
  return { phone, name: name || "Staff" };
}

export function assigneeCardLine(worker: AssignedWorker | null): string | null {
  if (!worker) return null;
  return `👤 Assigned: ${worker.name}`;
}
