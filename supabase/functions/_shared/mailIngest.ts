// Fetch inbound messages from configured mailbox provider (IMAP read-only, legacy Graph).

import type { OritMailboxRow } from "./oritAgentMail.ts";
import { stripHtmlToText } from "./oritAgentMail.ts";
import type { InboundMailMessage } from "./mailProvider.ts";
import { fetchImapInboxMessages, isImapConfigured, resolveImapConfig } from "./imapMail.ts";
import { fetchRecentInboxMessages, resolveGraphAccessToken } from "./microsoftGraph.ts";

export type MailFetchContext = {
  mailbox: OritMailboxRow;
  onGraphTokenRefresh?: (next: {
    accessToken: string;
    refreshToken?: string;
    expiresAt: string;
  }) => Promise<void>;
};

function graphToInbound(msg: Awaited<ReturnType<typeof fetchRecentInboxMessages>>[number]): InboundMailMessage | null {
  const fromEmail = msg.from?.emailAddress?.address ?? "";
  if (!fromEmail) return null;
  const bodyText = msg.body?.contentType === "html"
    ? stripHtmlToText(msg.body?.content ?? "")
    : (msg.body?.content ?? msg.bodyPreview ?? "");
  const threadKey = msg.conversationId || msg.id;
  return {
    id: msg.id,
    threadKey,
    subject: msg.subject ?? "",
    fromEmail,
    fromName: msg.from?.emailAddress?.name ?? null,
    receivedAt: msg.receivedDateTime ?? new Date().toISOString(),
    bodyPreview: (msg.bodyPreview ?? bodyText).slice(0, 500),
    bodyText: bodyText.slice(0, 8000),
  };
}

export function isMailboxIngestConfigured(mailbox: OritMailboxRow): boolean {
  if (mailbox.provider === "imap" || isImapConfigured(mailbox)) return isImapConfigured(mailbox);
  if (mailbox.provider === "microsoft") {
    return Boolean(mailbox.oauth_refresh_token);
  }
  return isImapConfigured(mailbox);
}

export async function fetchMailboxInboxMessages(
  ctx: MailFetchContext,
  limit = 30,
): Promise<InboundMailMessage[]> {
  const { mailbox } = ctx;

  if (mailbox.provider === "imap" || isImapConfigured(mailbox)) {
    const cfg = resolveImapConfig(mailbox);
    if (!cfg) throw new Error("imap_not_configured");
    return fetchImapInboxMessages(cfg, limit);
  }

  if (mailbox.provider === "microsoft" && mailbox.oauth_refresh_token) {
    const accessToken = await resolveGraphAccessToken(mailbox, async (next) => {
      if (ctx.onGraphTokenRefresh) {
        await ctx.onGraphTokenRefresh({
          accessToken: next.accessToken,
          refreshToken: next.refreshToken,
          expiresAt: next.expiresAt,
        });
      }
    });
    const graphMsgs = await fetchRecentInboxMessages(accessToken, limit);
    return graphMsgs.map(graphToInbound).filter((m): m is InboundMailMessage => m !== null);
  }

  throw new Error("mailbox_not_configured");
}
