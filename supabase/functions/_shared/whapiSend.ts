// supabase/functions/_shared/whapiSend.ts
//
// Direct Whapi (whapi.cloud) outbound sender — the XOS Core provider pivot.
//
// WHY THIS EXISTS ALONGSIDE _shared/interactiveSend.ts:
//   interactiveSend.ts talks to Meta's WhatsApp *Business Cloud* API, which has
//   no concept of reading from or writing into a real WhatsApp *group* chat
//   (CLAUDE.md §6 / session 21). Whapi is connected to a real WhatsApp account
//   and CAN post straight into a group by its chat_id (e.g.
//   "120363xxxxxxxxxxx@g.us"). Per the Sprint-1 architectural instruction, the
//   staff operations group is replied to through Whapi DIRECTLY — no Make.com
//   webhook on the outbound path.
//
// Required Supabase secret:  WHAPI_TOKEN    (channel token from the Whapi dashboard)
// Optional Supabase secret:  WHAPI_API_URL  (defaults to https://gate.whapi.cloud)
//
// Same FAIL-VISIBLE conventions as every other sender in this repo (CLAUDE.md
// §0.3): 25s AbortSignal.timeout; a distinct "timeout_no_response" tag on abort
// (a timeout is "unknown delivery", NOT a confirmed rejection); a non-2xx
// surfaces the provider's error body (truncated) instead of failing silently.
//
// NOTE (Sprint 1): this module is the outbound *architecture* the plan asks us
// to stand up now. It is intentionally NOT yet called from whapi-webhook — the
// structured in-group task reply that uses it is Sprint 2. Keeping it here (and
// exported) means Sprint 2 wires a reply with one import, zero new plumbing.

function _isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
}

function _whapiBase(): string {
  return (Deno.env.get("WHAPI_API_URL") ?? "https://gate.whapi.cloud").replace(/\/+$/, "");
}

function _tokenOrThrow(): string {
  const token = Deno.env.get("WHAPI_TOKEN");
  if (!token) throw new Error("missing_whapi_token");
  return token;
}

// Plain-text message. `to` may be a group chat_id ("...@g.us") OR a contact
// phone (Whapi accepts bare digits / its "<digits>@s.whatsapp.net" form).
// Returns the sent message id on success (best-effort — shape varies by Whapi
// version, so we read defensively and fall back to null rather than throw).
export async function sendWhapiText(
  to: string,
  body: string,
  opts: { noLinkPreview?: boolean } = {},
): Promise<string | null> {
  const token = _tokenOrThrow();
  // `no_link_preview` is a real Whapi body field (verified against live docs).
  // Sprint 2 sets it on the task-card reply so WhatsApp's link-preview crawler
  // does NOT pre-fetch the Accept/Complete URLs (that pre-fetch could otherwise
  // hit our callback before any human taps — the GET stays render-only too, so
  // this is belt-and-suspenders). Omitted by default → fully backward compatible.
  const payload: Record<string, unknown> = { to, body };
  if (opts.noLinkPreview) payload.no_link_preview = true;

  try {
    const res = await fetch(`${_whapiBase()}/messages/text`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`whapi_text_${res.status}: ${detail}`);
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    return (data?.message?.id ?? data?.id ?? null) as string | null;
  } catch (e) {
    if (_isAbortError(e)) {
      throw new Error("timeout_no_response: Whapi did not respond within 25s — message may have still been delivered");
    }
    throw e;
  }
}
