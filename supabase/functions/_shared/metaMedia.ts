// supabase/functions/_shared/metaMedia.ts
//
// Inbound media retrieval from Meta Cloud API (WhatsApp Business).
// Meta delivers webhooks with a media `id` only — the download URL is
// short-lived (~minutes). Callers must persist bytes to Storage immediately.
//
// Flow (verified Meta Cloud API v20):
//   1. GET graph.facebook.com/v20.0/{media-id}  → { url, mime_type, ... }
//   2. GET {url} with same Bearer token         → raw file bytes
//
// Required secret: META_WHATSAPP_TOKEN (or legacy WHATSAPP_TOKEN).

const GRAPH_VERSION = "v20.0";

function _metaToken(): string {
  const token = Deno.env.get("META_WHATSAPP_TOKEN") ?? Deno.env.get("WHATSAPP_TOKEN");
  if (!token) throw new Error("missing_secret: META_WHATSAPP_TOKEN");
  return token;
}

function _isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
}

function _extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  if (m.includes("heic") || m.includes("heif")) return "heic";
  return "jpg";
}

/** Download guest media bytes from Meta by media id. */
export async function downloadMetaMediaById(
  mediaId: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const token = _metaToken();

  let metaRes: Response;
  try {
    metaRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    if (_isAbortError(e)) throw new Error("timeout_no_response: Meta media metadata fetch");
    throw e;
  }

  if (!metaRes.ok) {
    const detail = (await metaRes.text().catch(() => "")).slice(0, 300);
    throw new Error(`meta_media_meta_${metaRes.status}: ${detail}`);
  }

  const meta = await metaRes.json() as Record<string, unknown>;
  const downloadUrl = typeof meta.url === "string" ? meta.url : "";
  const mimeType = typeof meta.mime_type === "string" && meta.mime_type
    ? meta.mime_type
    : "image/jpeg";
  if (!downloadUrl) throw new Error("meta_media_missing_url");

  let fileRes: Response;
  try {
    fileRes = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(25000),
    });
  } catch (e) {
    if (_isAbortError(e)) throw new Error("timeout_no_response: Meta media byte download");
    throw e;
  }

  if (!fileRes.ok) {
    const detail = (await fileRes.text().catch(() => "")).slice(0, 300);
    throw new Error(`meta_media_download_${fileRes.status}: ${detail}`);
  }

  return { bytes: new Uint8Array(await fileRes.arrayBuffer()), mimeType };
}

/** Persist Meta media to wa_inbox_media bucket; returns public URL or null on failure. */
export async function persistGuestWaMedia(
  supabase: { storage: { from: (bucket: string) => {
    upload: (path: string, body: Uint8Array, opts: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    getPublicUrl: (path: string) => { data: { publicUrl: string } };
  } } },
  opts: { mediaId: string; phone: string; waMessageId: string },
): Promise<{ url: string | null; mime: string | null }> {
  try {
    const { bytes, mimeType } = await downloadMetaMediaById(opts.mediaId);
    const ext = _extFromMime(mimeType);
    const safePhone = opts.phone.replace(/\D/g, "") || "unknown";
    const safeMsgId = opts.waMessageId.replace(/[^a-zA-Z0-9_-]/g, "") || String(Date.now());
    const path = `guest/${safePhone}/${safeMsgId}.${ext}`;

    const { error } = await supabase.storage.from("wa_inbox_media").upload(path, bytes, {
      cacheControl: "31536000",
      upsert: true,
      contentType: mimeType,
    });
    if (error) throw new Error(error.message);

    const { data } = supabase.storage.from("wa_inbox_media").getPublicUrl(path);
    return { url: data.publicUrl, mime: mimeType };
  } catch (e) {
    console.error("[metaMedia] persistGuestWaMedia failed:", (e as Error).message);
    return { url: null, mime: null };
  }
}
