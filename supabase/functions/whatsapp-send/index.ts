import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

function maxVarInText(text: string): number {
  const nums: Set<number> = new Set();
  for (const m of text.matchAll(/\{\{(\d+)\}\}/g)) nums.add(Number(m[1]));
  return nums.size === 0 ? 0 : Math.max(...nums);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const TOKEN    = Deno.env.get("WHATSAPP_TOKEN");
    const PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const WABA_ID  = Deno.env.get("WHATSAPP_WABA_ID");

    if (!TOKEN || !PHONE_ID) {
      return json({ ok: false, error: "Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID" }, 500);
    }

    const body = await req.json();

    // ── list_templates ────────────────────────────────────────────────────────
    if (body.action === "list_templates") {
      if (!WABA_ID) return json({ ok: false, error: "Missing WHATSAPP_WABA_ID" }, 500);
      const res  = await fetch(
        `https://graph.facebook.com/v19.0/${WABA_ID}/message_templates?limit=100`,
        { headers: { Authorization: `Bearer ${TOKEN}` } },
      );
      const data = await res.json();
      if (!res.ok) return json({ ok: false, error: data.error?.message ?? "Meta API error" }, 400);
      return json({ ok: true, templates: data.data ?? [] });
    }

    // ── register_template ─────────────────────────────────────────────────────
    if (body.action === "register_template") {
      if (!WABA_ID) return json({ ok: false, error: "Missing WHATSAPP_WABA_ID" }, 500);
      const { name, bodyText, category = "MARKETING" } = body;
      if (!name || !bodyText) return json({ ok: false, error: "Missing 'name' or 'bodyText'" }, 400);

      const maxVar = maxVarInText(bodyText);
      const exampleValues = Array.from(
        { length: maxVar },
        (_, i) => i === 0 ? "אורח יקר" : "ערך לדוגמה",
      );

      const payload = {
        name, category, language: "he",
        components: [{
          type: "BODY",
          text: bodyText,
          ...(maxVar > 0 ? { example: { body_text: [exampleValues] } } : {}),
        }],
      };

      const res  = await fetch(
        `https://graph.facebook.com/v19.0/${WABA_ID}/message_templates`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (res.ok && data.id) return json({ ok: true, id: data.id, status: data.status ?? "PENDING" });
      return json({ ok: false, error: data.error?.message ?? "Meta API error", details: data }, 400);
    }

    // ── delete_template ───────────────────────────────────────────────────────
    if (body.action === "delete_template") {
      if (!WABA_ID) return json({ ok: false, error: "Missing WHATSAPP_WABA_ID" }, 500);
      const { name } = body;
      if (!name) return json({ ok: false, error: "Missing 'name'" }, 400);
      const res = await fetch(
        `https://graph.facebook.com/v19.0/${WABA_ID}/message_templates?name=${encodeURIComponent(name)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${TOKEN}` } },
      );
      const data = await res.json();
      if (res.ok && data.success) return json({ ok: true });
      return json({ ok: false, error: data.error?.message ?? "Meta API error", details: data }, 400);
    }

    // ── send message ──────────────────────────────────────────────────────────
    const { to, message, template } = body;
    if (!to || (!message && !template)) {
      return json({ ok: false, error: "Missing 'to' and 'message' or 'template'" }, 400);
    }

    let payload: Record<string, unknown>;

    if (template) {
      payload = {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name:     template.name,
          language: { code: template.language ?? "he" },
          ...(template.params?.length ? {
            components: [{
              type: "body",
              parameters: template.params.map((t: string) => ({ type: "text", text: t })),
            }],
          } : {}),
        },
      };
    } else {
      payload = { messaging_product: "whatsapp", to, type: "text", text: { body: message } };
    }

    const waRes  = await fetch(`https://graph.facebook.com/v19.0/${PHONE_ID}/messages`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(payload),
    });
    const waJson = await waRes.json();

    if (waRes.ok && waJson.messages?.[0]?.id) return json({ ok: true, messages: waJson.messages });
    return json({ ok: false, error: waJson.error?.message ?? "WhatsApp API error", details: waJson }, 400);

  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
