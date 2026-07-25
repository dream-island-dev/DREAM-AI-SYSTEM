// Orit ↔ Sigal Whapi outbound — URL in a separate message (iOS RTL-safe).

import {
  composeOritCsMobileLinkUrl,
  messageExpectsOritCsLinkFollowUp,
} from "./oritGuestOutbound.ts";
import { sendWhapiText } from "./whapiSend.ts";

export type OritSigalWhapiSendOpts = { threadId?: string | null };

/** Second message: URL only with LTR mark — tappable on iOS Hebrew chats. */
export async function sendOritCsMobileLinkFollowUp(
  phone: string,
  threadId: string | null | undefined,
): Promise<boolean> {
  const id = threadId?.trim();
  if (!id) return true;
  const whapiId = await sendWhapiText(phone, composeOritCsMobileLinkUrl(id), { noLinkPreview: true });
  return Boolean(whapiId);
}

async function maybeSendLinkFollowUp(
  phone: string,
  body: string,
  opts?: OritSigalWhapiSendOpts,
): Promise<boolean> {
  const threadId = opts?.threadId?.trim();
  if (!threadId || !messageExpectsOritCsLinkFollowUp(body)) return true;
  return sendOritCsMobileLinkFollowUp(phone, threadId);
}

export async function sendOritSigalWhapiText(
  phone: string,
  body: string,
  opts?: OritSigalWhapiSendOpts,
): Promise<boolean> {
  const trimmed = body.trim();
  if (!trimmed) return false;
  const whapiId = await sendWhapiText(phone, trimmed, { noLinkPreview: true });
  if (!whapiId) return false;
  return maybeSendLinkFollowUp(phone, trimmed, opts);
}

/** Chunk long Sigal briefings; optional URL follow-up after the last chunk. */
export async function sendOritSigalWhapiLongText(
  phone: string,
  text: string,
  opts?: OritSigalWhapiSendOpts,
): Promise<boolean> {
  const max = 3400;
  const body = text.trim();
  if (!body) return false;

  const sendChunk = async (chunk: string): Promise<boolean> => {
    const whapiId = await sendWhapiText(phone, chunk, { noLinkPreview: true });
    return Boolean(whapiId);
  };

  if (body.length <= max) {
    if (!await sendChunk(body)) return false;
    return maybeSendLinkFollowUp(phone, body, opts);
  }

  const paragraphs = body.split(/\n{2,}/);
  let chunk = "";
  for (const p of paragraphs) {
    const next = chunk ? `${chunk}\n\n${p}` : p;
    if (next.length > max) {
      if (chunk) {
        if (!await sendChunk(chunk)) return false;
      }
      if (p.length > max) {
        for (let i = 0; i < p.length; i += max) {
          if (!await sendChunk(p.slice(i, i + max))) return false;
        }
        chunk = "";
      } else {
        chunk = p;
      }
    } else {
      chunk = next;
    }
  }
  if (chunk && !await sendChunk(chunk)) return false;
  return maybeSendLinkFollowUp(phone, body, opts);
}
