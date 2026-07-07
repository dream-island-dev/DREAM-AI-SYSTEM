// Microsoft Graph helpers for Orit CS Agent mailbox (Outlook / M365).

import type { OritMailboxRow } from "./oritAgentMail.ts";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

export function getMicrosoftOAuthConfig() {
  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID") ?? "";
  const tenantId = Deno.env.get("MICROSOFT_TENANT_ID") ?? "common";
  const redirectUri = Deno.env.get("MICROSOFT_REDIRECT_URI")
    ?? `${Deno.env.get("SUPABASE_URL")}/functions/v1/manager-mail-oauth/callback`;
  return { clientId, tenantId, redirectUri };
}

export function buildMicrosoftAuthUrl(state: string): string {
  const { clientId, tenantId, redirectUri } = getMicrosoftOAuthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: "offline_access Mail.Read Mail.ReadWrite Mail.Send User.Read",
    state,
  });
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`;
}

async function exchangeToken(body: Record<string, string>): Promise<TokenResponse> {
  const { clientId, tenantId, redirectUri } = getMicrosoftOAuthConfig();
  const secret = Deno.env.get("MICROSOFT_CLIENT_SECRET") ?? "";
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      redirect_uri: redirectUri,
      ...body,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`token_exchange_failed: ${txt.slice(0, 300)}`);
  }
  return await res.json();
}

export async function exchangeAuthCode(code: string): Promise<TokenResponse> {
  return exchangeToken({
    grant_type: "authorization_code",
    code,
  });
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  return exchangeToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

export async function resolveGraphAccessToken(
  mailbox: OritMailboxRow,
  onTokenRefresh?: (next: { accessToken: string; refreshToken?: string; expiresAt: string }) => Promise<void>,
): Promise<string> {
  const now = Date.now();
  const expiresAt = mailbox.token_expires_at ? new Date(mailbox.token_expires_at).getTime() : 0;
  if (mailbox.oauth_refresh_token && expiresAt > now + 60_000) {
    // We don't store access token in DB — always refresh when expired/near expiry.
  }

  if (!mailbox.oauth_refresh_token) {
    throw new Error("mailbox_not_connected");
  }

  const refreshed = await refreshAccessToken(mailbox.oauth_refresh_token);
  const expiresInMs = (refreshed.expires_in ?? 3600) * 1000;
  const nextExpiresAt = new Date(Date.now() + expiresInMs - 60_000).toISOString();

  if (onTokenRefresh) {
    await onTokenRefresh({
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresAt: nextExpiresAt,
    });
  }

  return refreshed.access_token;
}

export type GraphMessage = {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  body?: { contentType?: string; content?: string };
};

export async function fetchRecentInboxMessages(accessToken: string, top = 25): Promise<GraphMessage[]> {
  const url = `${GRAPH_BASE}/me/mailFolders/inbox/messages?$top=${top}&$orderby=receivedDateTime desc&$select=id,conversationId,subject,bodyPreview,receivedDateTime,from,body`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`graph_list_failed: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data?.value ?? []) as GraphMessage[];
}

export async function sendGraphReply(
  accessToken: string,
  opts: { toEmail: string; toName?: string | null; subject: string; bodyText: string },
): Promise<string | null> {
  const payload = {
    message: {
      subject: opts.subject.startsWith("Re:") ? opts.subject : `Re: ${opts.subject}`,
      body: { contentType: "Text", content: opts.bodyText },
      toRecipients: [{
        emailAddress: {
          address: opts.toEmail,
          name: opts.toName ?? undefined,
        },
      }],
    },
    saveToSentItems: true,
  };

  const res = await fetch(`${GRAPH_BASE}/me/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25000),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`graph_send_failed: ${txt.slice(0, 300)}`);
  }

  return `sent-${Date.now()}`;
}

export async function fetchGraphProfileEmail(accessToken: string): Promise<string | null> {
  const res = await fetch(`${GRAPH_BASE}/me?$select=mail,userPrincipalName`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.mail || data?.userPrincipalName || null;
}
