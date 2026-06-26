// supabase/functions/_shared/whapiMedia.ts
//
// Inbound media retrieval from Whapi (whapi.cloud) — the read-side counterpart
// to whapiSend.ts's outbound sender. Built for voice-note transcription
// (whapi-webhook): a Whapi "voice" message arrives with a media `id`, NOT
// inline bytes — the payload's `voice.link` field only exists when the
// channel has "Auto Download" enabled (a settings toggle, not guaranteed), so
// this always fetches by id instead of depending on that.
//
// Verified against live Whapi docs: GET {base}/media/{id} with the channel's
// Bearer token returns the RAW FILE BYTES directly in the response body —
// not JSON, not a redirect.
//
// Required Supabase secret: WHAPI_TOKEN (same one whapiSend.ts uses).

// NOTE: std@0.168.0 (the version pinned across this repo's Deno functions)
// exports `encode`/`decode` here, NOT `encodeBase64`/`decodeBase64` (that
// rename happened in a later std release) — verified directly against this
// exact module version after a deploy failed with BOOT_ERROR on the wrong name.
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { _whapiBase, _tokenOrThrow } from "./whapiSend.ts";

function _isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
}

// Returns standard base64 of the raw media bytes — same encoding Gemini's
// inline_data expects (process-knowledge/index.ts's established convention).
export async function fetchWhapiMedia(mediaId: string): Promise<string> {
  const token = _tokenOrThrow();

  let res: Response;
  try {
    res = await fetch(`${_whapiBase()}/media/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(25000),
    });
  } catch (e) {
    if (_isAbortError(e)) {
      throw new Error("timeout_no_response: Whapi media fetch did not respond within 25s");
    }
    throw e;
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`whapi_media_${res.status}: ${detail}`);
  }

  // encode() takes ArrayBuffer | string directly — pass the raw buffer, no
  // Uint8Array wrapping needed (that's not one of its accepted types here).
  return encodeBase64(await res.arrayBuffer());
}
