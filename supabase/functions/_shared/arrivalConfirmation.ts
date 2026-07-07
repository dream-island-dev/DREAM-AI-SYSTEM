import { israelYmd } from "./automationSchedule.ts";

/**
 * Arrival confirmation detection + guest phone lookup + inbox backfill.
 * Shared by whatsapp-webhook (live) and whatsapp-cron (reconcile).
 */

export const ARRIVAL_CONFIRM_GUEST_FIELDS =
  "id, name, phone, arrival_confirmed, arrival_confirmed_at, msg_stage_2_arrival_sent, wa_window_expires_at, payment_amount, payment_link_url, direct_payment_url, ezgo_portal_url, payment_link_resolution_pending, msg_pre_arrival_2d_sent, needs_callback, requires_attention, attention_reason, arrival_date, departure_date, arrival_time, room, room_type, spa_time, spa_date, status, guest_notes, guest_profile, portal_token, automation_muted, automation_scope, claimed_by";

/** Strip WhatsApp markdown / zero-width noise before matching. */
export function normalizeInboundConfirmText(raw: string): string {
  return String(raw ?? "")
    .replace(/\*+/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

export function normalizePhoneSuffix(phoneStr: unknown): string {
  return String(phoneStr ?? "").replace(/\D/g, "").slice(-9);
}

function hebrewOnlyLetters(s: string): string {
  return s.replace(/[^א-ת]/g, "");
}

const CONFIRMATION_RE =
  /^[\s🎉✨😊🙂🙏💫🌴]*(?:כן[,!\s.]*)?(?:מגיעים|אנחנו מגיעים|כן מגיעים|כן,מגיעים|כן! מגיעים|כן|אישור|yes|מאשר|מאשרת|כן תודה|כן אישור|אישורי)[\s🎉✨😊🙂🙏💫🌴!.,✨]*$/iu;

/** Explicit negatives — template «לא, שינוי בתאריך» must never confirm. */
function isExplicitArrivalDecline(raw: string): boolean {
  const t = normalizeInboundConfirmText(raw);
  if (!t) return false;
  if (t.includes("שינוי בתאריך")) return true;
  const heb = hebrewOnlyLetters(t);
  if (heb.startsWith("לא") && !heb.includes("כן")) return true;
  return false;
}

/** Button taps + typed «כן מגיעים» (Meta emoji/punctuation tolerant). */
export function isArrivalConfirmationMessage(
  raw: string,
  opts?: { buttonTitle?: string; buttonId?: string },
): boolean {
  const text = normalizeInboundConfirmText(raw);
  if (text && isExplicitArrivalDecline(text)) return false;

  if (text && CONFIRMATION_RE.test(text)) return true;

  const titleHeb = hebrewOnlyLetters(opts?.buttonTitle ?? text);
  const idHeb = hebrewOnlyLetters(opts?.buttonId ?? "");
  if (
    titleHeb &&
    ((titleHeb.includes("כן") && titleHeb.includes("מגיעים")) ||
      titleHeb === "כןמגיעים" ||
      titleHeb === "מגיעים")
  ) {
    return true;
  }
  if (
    idHeb.includes("כןמגיעים") ||
    (opts?.buttonId ?? "").toLowerCase().includes("confirm") ||
    (opts?.buttonId ?? "").toLowerCase().includes("arriving") ||
    (opts?.buttonId ?? "").toLowerCase().includes("yes_arrive")
  ) {
    return true;
  }
  if (text) {
    const heb = hebrewOnlyLetters(text);
    if (
      (heb.includes("כן") && heb.includes("מגיעים")) ||
      heb === "כןמגיעים" ||
      heb === "מגיעים"
    ) {
      return true;
    }
  }
  return false;
}

export function buildPhoneVariants(from: string): { phone: string; variants: string[] } {
  const phone = from.startsWith("+") ? from : `+${from}`;
  const phoneDigits = phone.replace(/\D/g, "");
  const phoneLocal = phoneDigits.startsWith("972") ? "0" + phoneDigits.slice(3) : phoneDigits;
  const variants = [...new Set([phone, phoneDigits, phoneLocal, `+${phoneDigits}`].filter(Boolean))];
  return { phone, variants };
}

function pickGuestFromRows(
  rows: Record<string, unknown>[],
  phone: string,
): Record<string, unknown> | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0];

  const todayYmd = israelYmd(new Date());
  const active = rows.filter((g) => g.status !== "cancelled");
  const pool = active.length ? active : rows;
  const upcoming = pool
    .filter((g) => typeof g.arrival_date === "string" && String(g.arrival_date) >= todayYmd)
    .sort((a, b) => String(a.arrival_date).localeCompare(String(b.arrival_date)));
  const pick = upcoming[0] ?? pool[0];
  console.warn(
    `[arrivalConfirmation] duplicate phone ${phone} — picked guest id=${pick.id} arrival=${pick.arrival_date}`,
  );
  return pick;
}

/** Multi-format phone match — exact variants first, then last-9 suffix (no full-table scan). */
export async function lookupGuestByPhone(
  supabaseClient: { from: (t: string) => unknown },
  phoneVariants: string[],
  phone: string,
): Promise<Record<string, unknown> | null> {
  const supabase = supabaseClient as {
    from: (t: string) => {
      select: (cols: string) => {
        in: (col: string, vals: string[]) => {
          order: (col: string, opts: { ascending: boolean }) => Promise<{
            data: Record<string, unknown>[] | null;
            error: { message: string } | null;
          }>;
        };
        or: (filter: string) => {
          order: (col: string, opts: { ascending: boolean }) => Promise<{
            data: Record<string, unknown>[] | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };

  const { data: exactRows, error: exactErr } = await supabase
    .from("guests")
    .select(ARRIVAL_CONFIRM_GUEST_FIELDS)
    .in("phone", phoneVariants)
    .order("arrival_date", { ascending: false });

  if (exactErr) console.warn("[arrivalConfirmation] guest lookup error:", exactErr.message);

  const exactPick = pickGuestFromRows((exactRows ?? []) as Record<string, unknown>[], phone);
  if (exactPick) return exactPick;

  const suffix = normalizePhoneSuffix(phone);
  if (suffix.length < 8) return null;

  const { data: suffixRows, error: suffixErr } = await supabase
    .from("guests")
    .select(ARRIVAL_CONFIRM_GUEST_FIELDS)
    .or(`phone.ilike.%${suffix}`)
    .order("arrival_date", { ascending: false });

  if (suffixErr) {
    console.warn("[arrivalConfirmation] suffix lookup error:", suffixErr.message);
    return null;
  }

  const matched = ((suffixRows ?? []) as Record<string, unknown>[]).filter(
    (g) => normalizePhoneSuffix(g.phone) === suffix,
  );
  const pick = pickGuestFromRows(matched, phone);
  if (pick) {
    console.info(
      `[arrivalConfirmation] guest matched via last-9 suffix — phone:${phone} guestId:${pick.id}`,
    );
  }
  return pick;
}

type GuestConfirmCandidate = {
  id: number | string;
  phone?: string | null;
  status?: string | null;
  arrival_confirmed?: boolean | null;
  arrival_confirmed_at?: string | null;
  msg_pre_arrival_2d_sent?: boolean | null;
};

/**
 * Backfill guests who tapped/typed confirm in Inbox but arrival_confirmed stayed false
 * (dedup skip, lookup miss, or webhook timeout after claim).
 */
export async function reconcileMissedArrivalConfirmations(
  supabaseClient: { from: (t: string) => unknown },
  guests: GuestConfirmCandidate[],
  opts?: { sinceDays?: number },
): Promise<number> {
  const sinceDays = opts?.sinceDays ?? 14;
  const since = new Date(Date.now() - sinceDays * 24 * 3600 * 1000).toISOString();

  const candidates = guests.filter(
    (g) =>
      g.status !== "cancelled" &&
      !g.arrival_confirmed &&
      !g.arrival_confirmed_at &&
      g.msg_pre_arrival_2d_sent === true,
  );
  if (!candidates.length) return 0;

  const supabase = supabaseClient as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          in: (col: string, vals: string[]) => {
            gte: (col: string, val: string) => {
              order: (col: string, opts: { ascending: boolean }) => Promise<{
                data: Array<{ message: string; created_at: string }> | null;
              }>;
            };
          };
        };
      };
      update: (patch: Record<string, unknown>) => {
        eq: (col: string, val: unknown) => Promise<{ error: { message: string } | null }>;
      };
    };
  };

  let fixed = 0;
  for (const guest of candidates) {
    if (!guest.phone) continue;
    const { variants } = buildPhoneVariants(
      String(guest.phone).startsWith("+") ? String(guest.phone).slice(1) : String(guest.phone),
    );
    const phoneSet = [...new Set([guest.phone, ...variants])];

    const { data: convs } = await supabase
      .from("whatsapp_conversations")
      .select("message, created_at")
      .eq("direction", "inbound")
      .in("phone", phoneSet)
      .gte("created_at", since)
      .order("created_at", { ascending: false });

    const confirmRow = (convs ?? []).find((c) => isArrivalConfirmationMessage(c.message));
    if (!confirmRow) continue;

    const confirmedAt = confirmRow.created_at ?? new Date().toISOString();
    const windowExpires = new Date(
      new Date(confirmedAt).getTime() + 24 * 3600 * 1000,
    ).toISOString();

    const { error } = await supabase
      .from("guests")
      .update({
        arrival_confirmed: true,
        arrival_confirmed_at: confirmedAt,
        wa_window_expires_at: windowExpires,
        ...(guest.status === "pending" ? { status: "expected" } : {}),
      })
      .eq("id", guest.id);

    if (error) {
      console.warn(
        `[arrivalConfirmation] reconcile update failed guest_id=${guest.id}:`,
        error.message,
      );
      continue;
    }

    fixed++;
    console.log(
      `[arrivalConfirmation] reconcile backfilled guest_id=${guest.id} from inbound at ${confirmedAt}`,
    );
  }
  return fixed;
}
