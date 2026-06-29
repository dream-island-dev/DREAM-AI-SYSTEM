// supabase/functions/_shared/interactiveSend.ts
//
// Meta WhatsApp Cloud API senders for *interactive* (non-template) session
// messages — shared so whatsapp-send (BRANCH D, automation_stages-driven
// pipeline triggers) and whatsapp-webhook (Stage 2 Pay) call the exact same
// code instead of two copies that could silently diverge.
//
// Same conventions as every other Meta sender in this codebase: 25s
// AbortSignal.timeout, "timeout_no_response" tagging on abort/timeout
// (FAIL VISIBLE — CLAUDE.md §0.3, distinct from a confirmed Meta rejection),
// META_WHATSAPP_TOKEN/META_PHONE_NUMBER_ID with WHATSAPP_TOKEN/
// WHATSAPP_PHONE_NUMBER_ID fallback. _isAbortError is intentionally
// duplicated here rather than imported — every other Edge Function in this
// project (whatsapp-send, whatsapp-webhook) already keeps its own copy of
// this exact 2-line helper rather than sharing it across Deno bundles.

import { sanitizeMetaRecipientPhone } from "./metaPhone.ts";

function _isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
}

function _credsOrThrow(): { token: string; phoneId: string } {
  const token   = Deno.env.get("META_WHATSAPP_TOKEN")  ?? Deno.env.get("WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("META_PHONE_NUMBER_ID") ?? Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneId) throw new Error("missing_meta_whatsapp_creds");
  return { token, phoneId };
}

// ── Reply-buttons message (Phase 4 — hybrid fallback) ───────────────────────
// Meta's free-form "interactive" message type supports up to 3 reply buttons
// (type:"reply"), title capped at 20 chars — there is no free-form "URL
// button" equivalent for MULTIPLE links (that only exists on approved
// templates). Any interactive_buttons entries of type "url" are appended as
// a plain text line instead of a tappable button — documented limitation,
// not a bug. Moved here unchanged from whatsapp-send/index.ts.
export async function sendInteractiveButtons(
  to: string,
  bodyText: string,
  buttons: Array<{ type: string; label: string; url?: string; id?: string }>,
): Promise<void> {
  const { token, phoneId } = _credsOrThrow();
  const recipient = sanitizeMetaRecipientPhone(to);

  const urlLines = buttons
    .filter((b) => b.type === "url" && b.url)
    .map((b) => `🔗 ${b.label}: ${b.url}`);
  const fullBody = urlLines.length > 0 ? `${bodyText}\n\n${urlLines.join("\n")}` : bodyText;

  // `id` is optional — callers that don't pass one (every caller before the
  // staff-ops board) keep getting the original positional `btn_${i}` id, so
  // this is purely additive. staff-ops-webhook passes explicit
  // ops_claim_{taskId}/ops_done_{taskId} ids so whatsapp-webhook's button
  // router can tell which task a tap refers to.
  const replyButtons = buttons
    .filter((b) => b.type === "quick_reply" && b.label?.trim())
    .slice(0, 3)
    .map((b, i) => ({ type: "reply", reply: { id: b.id ?? `btn_${i}`, title: b.label.trim().slice(0, 20) } }));

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(
        replyButtons.length > 0
          ? {
              messaging_product: "whatsapp",
              to: recipient,
              type: "interactive",
              interactive: { type: "button", body: { text: fullBody }, action: { buttons: replyButtons } },
            }
          : { messaging_product: "whatsapp", to: recipient, type: "text", text: { body: fullBody, preview_url: false } },
      ),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`meta_interactive_${res.status}: ${detail}`);
    }
  } catch (e) {
    if (_isAbortError(e)) throw new Error("timeout_no_response: Meta did not respond within 25s — message may have still been delivered");
    throw e;
  }
}

// ── Image + caption message (Stage 2.5 / night_before reminder) ────────────
// Meta's "image" message type — a plain image with optional caption text.
// Distinct from sendInteractiveButtons() above: that function's two shapes
// (interactive-button / plain text) have no header-image slot at all, so a
// stage that needs a picture with no buttons (today: just night_before) uses
// this instead. If a future stage needs BOTH an image AND tappable buttons,
// that's a real Meta interactive-message header — not handled here yet,
// deliberately: no caller needs it today, guessing at the shape would be
// exactly the "generic shape" anti-pattern this file's other functions
// already warn against (see sendInteractiveButtons' header comment).
export async function sendImageMessage(
  to: string,
  imageUrl: string,
  caption: string,
): Promise<string> {
  const { token, phoneId } = _credsOrThrow();
  const recipient = sanitizeMetaRecipientPhone(to);
  const link = String(imageUrl ?? "").trim();
  if (!link) throw new Error("meta_image_missing_link");

  const image: Record<string, string> = { link };
  const cap = String(caption ?? "").trim();
  if (cap) image.caption = cap;

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipient,
        type: "image",
        image,
      }),
      signal: AbortSignal.timeout(25000),
    });
    const detail = await res.text();
    if (!res.ok) {
      throw new Error(`meta_image_${res.status}: ${detail.slice(0, 300)}`);
    }
    return detail;
  } catch (e) {
    if (_isAbortError(e)) throw new Error("timeout_no_response: Meta did not respond within 25s — message may have still been delivered");
    throw e;
  }
}

// ── Single call-to-action URL button (Stage 2 Pay) ──────────────────────────
// Meta's "cta_url" interactive type — the only free-form (non-template) way
// to send a genuinely tappable URL button. Exactly one button per message;
// Meta does not support more than one in this interactive type. buttonLabel
// is capped at 20 chars for consistency with the reply-button cap above
// (Meta doesn't document a hard limit for cta_url specifically, but every
// other button label in this codebase follows the same cap).
export async function sendCtaUrlButton(
  to: string,
  bodyText: string,
  buttonLabel: string,
  url: string,
): Promise<void> {
  const { token, phoneId } = _credsOrThrow();
  const recipient = sanitizeMetaRecipientPhone(to);

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipient,
        type: "interactive",
        interactive: {
          type: "cta_url",
          body: { text: bodyText },
          action: {
            name: "cta_url",
            parameters: { display_text: buttonLabel.trim().slice(0, 20), url },
          },
        },
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`meta_cta_url_${res.status}: ${detail}`);
    }
  } catch (e) {
    if (_isAbortError(e)) throw new Error("timeout_no_response: Meta did not respond within 25s — message may have still been delivered");
    throw e;
  }
}
