import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildMicrosoftAuthUrl,
  exchangeAuthCode,
  fetchGraphProfileEmail,
  getMicrosoftOAuthConfig,
} from "../_shared/microsoftGraph.ts";
import { isMicrosoftConfigured } from "../_shared/oritAgentMail.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function htmlPage(title: string, body: string): Response {
  return new Response(
    `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><title>${title}</title></head><body style="font-family:Heebo,sans-serif;padding:24px;">${body}</body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function triggerInitialSync(): Promise<void> {
  const base = Deno.env.get("SUPABASE_URL");
  if (!base) return;
  try {
    await fetch(`${base}/functions/v1/manager-mail-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(55_000),
    });
  } catch (e) {
    console.warn("[manager-mail-oauth] post-connect sync failed:", (e as Error).message);
  }
}

async function beginOAuthForMailbox(
  supabase: ReturnType<typeof createClient>,
  mailboxId: string,
  profileId?: string | null,
): Promise<Response> {
  if (!isMicrosoftConfigured()) {
    return htmlPage("שגיאה", "<h2>Microsoft OAuth לא מוגדר בשרת</h2><p>פנה למייק.</p>");
  }
  const { clientId } = getMicrosoftOAuthConfig();
  if (!clientId) {
    return htmlPage("שגיאה", "<h2>חסר Client ID</h2>");
  }

  const patch: Record<string, unknown> = {
    connection_status: "pending",
    connection_error: null,
  };
  if (profileId) patch.profile_id = profileId;

  await supabase.from("orit_agent_mailbox").update(patch).eq("id", mailboxId);

  const authUrl = buildMicrosoftAuthUrl(mailboxId);
  return Response.redirect(authUrl, 302);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    if (url.pathname.endsWith("/callback")) {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const err = url.searchParams.get("error_description") || url.searchParams.get("error");
      if (err) {
        return htmlPage("שגיאת חיבור", `<h2>❌ החיבור נכשל</h2><p>${err}</p>`);
      }
      if (!code || !state) {
        return htmlPage("שגיאה", "<h2>חסר code/state</h2>");
      }

      const { data: mailbox } = await supabase
        .from("orit_agent_mailbox")
        .select("id")
        .eq("id", state)
        .maybeSingle();
      if (!mailbox) {
        return htmlPage("שגיאה", "<h2>תיבת דואר לא נמצאה</h2>");
      }

      const tokens = await exchangeAuthCode(code);
      const profileEmail = await fetchGraphProfileEmail(tokens.access_token);
      const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000 - 60_000).toISOString();

      await supabase.from("orit_agent_mailbox").update({
        connection_status: "active",
        oauth_refresh_token: tokens.refresh_token ?? null,
        token_expires_at: expiresAt,
        email_address: profileEmail,
        connection_error: null,
      }).eq("id", state);

      await triggerInitialSync();

      return htmlPage(
        "חובר בהצלחה",
        `<h2>✅ תיבת Outlook חוברה בהצלחה</h2>
         <p>מחובר: <strong>${profileEmail ?? ""}</strong></p>
         <p>המיילים מסתנכרנים עכשיו. אפשר לסגור ולפתוח את XOS → סוכן שירות לקוחות.</p>`,
      );
    }

    // One-click setup link (no XOS login / console): GET ?key=ORIT_MAIL_SETUP_KEY
    if (req.method === "GET") {
      const key = url.searchParams.get("key") ?? "";
      const setupKey = Deno.env.get("ORIT_MAIL_SETUP_KEY") ?? "";
      if (!setupKey || key !== setupKey) {
        return htmlPage("גישה נדחתה", "<h2>קישור לא תקין או פג תוקף</h2><p>בקש קישור חדש ממייק.</p>");
      }

      const { data: mailbox } = await supabase
        .from("orit_agent_mailbox")
        .select("id")
        .eq("owner_email", "orit@dream-island.co.il")
        .maybeSingle();
      if (!mailbox?.id) {
        const { data: fallback } = await supabase
          .from("orit_agent_mailbox")
          .select("id")
          .eq("connection_status", "active")
          .order("last_sync_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!fallback?.id) {
          return htmlPage("שגיאה", "<h2>תיבת הסוכן לא נמצאה ב-DB</h2>");
        }
        return beginOAuthForMailbox(supabase, fallback.id);
      }

      return beginOAuthForMailbox(supabase, mailbox.id);
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const mailboxId = body.mailboxId as string | undefined;
    if (!mailboxId) {
      return new Response(JSON.stringify({ ok: false, error: "mailboxId required" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    if (!isMicrosoftConfigured()) {
      return new Response(JSON.stringify({
        ok: false,
        status: "not_configured",
        error: "Microsoft OAuth עדיין לא הוגדר בשרת. פנה למייק.",
      }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const { clientId } = getMicrosoftOAuthConfig();
    if (!clientId) {
      return new Response(JSON.stringify({ ok: false, error: "missing_client_id" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const authUrl = buildMicrosoftAuthUrl(mailboxId);
    await supabase.from("orit_agent_mailbox").update({
      profile_id: userData.user.id,
      connection_status: "pending",
    }).eq("id", mailboxId);

    return new Response(JSON.stringify({ ok: true, authUrl }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[manager-mail-oauth]", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
