// supabase/functions/register-templates/index.ts
// ONE-SHOT utility — registers Dream Island WhatsApp Business templates with Meta.
// Deploy once, invoke once, then delete.
//
// Reads META_WHATSAPP_TOKEN + META_BUSINESS_ACCOUNT_ID from Supabase Secrets.
// Returns per-template ✅/❌ report.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const API_VER = "v20.0";

interface TemplateComponent {
  type:    string;
  format?: string;
  text:    string;
  example?: { body_text: string[][] };
}

interface TemplateDef {
  name:       string;
  category:   string;
  language:   string;
  components: TemplateComponent[];
}

// Meta WhatsApp template rules (enforced by API):
//   ✗ HEADER TEXT: no emojis, no formatting, no variables without example
//   ✗ BODY: first token cannot be {{n}} — must start with at least one literal word
//   ✓ BODY: emojis are fine mid-text
//   ✓ HEADER example required when header contains {{n}} — simplest fix: make headers static

const TEMPLATES: TemplateDef[] = [

  {
    name: "dream_arrival_tomorrow",
    category: "UTILITY",
    language: "he",
    components: [
      {
        type: "BODY",
        text:
          "Dream Island שמחה לראותכם מחר, {{1}}! 🌴\n" +
          "צ'ק-אין מ-15:00. כניסה לבריכות ומתקנים מרגע ההגעה.\n" +
          "צ'ק-אאוט עד 11:00. מחכים לכם!",
        example: { body_text: [["שרה כהן"]] },
      },
    ],
  },

  {
    name: "dream_availability_offer",
    category: "MARKETING",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "התאריך שבחרתם פנוי" },
      {
        type: "BODY",
        text:
          "בשורה מצוינת עבורכם, {{1}} — התאריך שעניין אתכם זמין ב-Dream Island.\n" +
          "מהרו לשריין לפני שהמקום יתפס.\n" +
          "לפרטים ולהזמנה: {{2}}\n" +
          "Dream Island — מחכים לכם! 🌴",
        example: { body_text: [["דניאל לוי", "https://dreamisland.co.il"]] },
      },
    ],
  },

  {
    name: "dream_handover_agent",
    category: "UTILITY",
    language: "he",
    components: [
      {
        type: "BODY",
        text:
          "תודה על פנייתך, {{1}}. 🙏\n" +
          "העברנו את בקשתך לנציג שלנו שיצור איתך קשר בהקדם.\n" +
          "Dream Island — תמיד לשירותך.",
        example: { body_text: [["מיכל גולן"]] },
      },
    ],
  },

  {
    name: "dream_checkin_reminder",
    category: "UTILITY",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "מחכים לכם מחר" },
      {
        type: "BODY",
        text:
          "תזכורת לקראת הגעתכם מחר ל-Dream Island, {{1}}.\n" +
          "• צ'ק-אין: מ-15:00\n" +
          "• צ'ק-אאוט: עד 11:00\n" +
          "• בריכות ומתקני הספא פתוחים מרגע ההגעה\n\n" +
          "לשאלות: {{2}}\n" +
          "Dream Island — מחכים לכם! 🌊",
        example: { body_text: [["אבי ורדי", "054-0000000"]] },
      },
    ],
  },

  {
    name: "dream_workshop_reminder",
    category: "UTILITY",
    language: "he",
    components: [
      {
        type: "BODY",
        text:
          "תזכורת מ-Dream Island, {{1}}! 📅\n" +
          "אתם רשומים לסדנת {{2}}.\n" +
          "מיקום: {{3}}\n" +
          "שעה: {{4}}\n\n" +
          "מצפים לכם!",
        example: {
          body_text: [["רונית מזרחי", "בישול ים-תיכוני", "מסעדת ערמונים", "11:00"]],
        },
      },
    ],
  },

  {
    name: "dream_followup_no_response",
    category: "MARKETING",
    language: "he",
    components: [
      {
        type: "BODY",
        text:
          "שלום {{1}}, שלחנו לכם הצעה לאחרונה ולא שמענו ממכם. 😊\n" +
          "אנחנו כאן לכל שאלה — ההצעה עדיין בתוקף.\n" +
          "נשמח לקבוע ביקור ב-Dream Island בזמן הנוח לכם.",
        example: { body_text: [["יוסי בן-דוד"]] },
      },
    ],
  },

  {
    name: "dream_post_visit",
    category: "MARKETING",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "תודה שביקרתם" },
      {
        type: "BODY",
        text:
          "תודה שבחרתם ב-Dream Island, {{1}}! 🙏\n" +
          "מקווים שנהניתם מכל רגע.\n" +
          "נשמח לשמוע על החוויה שלכם — וכבר מחכים לביקור הבא.",
        example: { body_text: [["נועה שמיר"]] },
      },
    ],
  },

  {
    name: "dream_special_occasion",
    category: "MARKETING",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "חגיגה מיוחדת ב-Dream Island" },
      {
        type: "BODY",
        text:
          "ב-Dream Island אנחנו אוהבים לחגוג עם {{1}}! 🎉\n" +
          "יום הולדת, יום נישואין, בת/בר מצווה — יש לנו חבילות פרמיום מותאמות אישית.\n" +
          "לפרטים ולהזמנה: {{2}}\n" +
          "Dream Island — נשמח לחגוג אתכם! 🎉",
        example: { body_text: [["תמי ואלי", "https://dreamisland.co.il/events"]] },
      },
    ],
  },

  {
    name: "dream_spa_package",
    category: "MARKETING",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "חבילת ספא מיוחדת" },
      {
        type: "BODY",
        text:
          "חבילת הספא המיוחדת שלנו ממתינה לכם, {{1}}. 🧖\n" +
          "טיפולי גוף | חמאם טורקי | עיסויי Watsu\n" +
          "לשריין מקום: {{2}}\n" +
          "Dream Island — הפינוק שמגיע לכם. 🧖",
        example: { body_text: [["גיל אברהם", "https://dreamisland.co.il/spa"]] },
      },
    ],
  },

  {
    name: "dream_suite_upsell",
    category: "MARKETING",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "שדרגו לסוויטת VIP" },
      {
        type: "BODY",
        text:
          "הצעה מיוחדת עבורכם, {{1}} — סוויטת VIP עם בריכה פרטית ב-Dream Island. 🌴\n" +
          "זמינות מוגבלת — הזדמנות שלא תחזור.\n" +
          "לפרטים ומחירים: {{2}}\n" +
          "Dream Island — חוויה ברמה אחרת. 🌴",
        example: { body_text: [["שלמה כץ", "https://dreamisland.co.il/vip"]] },
      },
    ],
  },

  {
    name: "dream_last_minute",
    category: "MARKETING",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "הצעת רגע אחרון" },
      {
        type: "BODY",
        text:
          "Dream Island מציעה: מקום פנוי ל-{{1}} במחיר מיוחד עבורכם, {{2}}! ⚡\n" +
          "הצעה לזמן מוגבל — עד {{3}} בלבד.\n" +
          "לפרטים: {{4}}\n" +
          "Dream Island — מחכה לכם! ⚡",
        example: {
          body_text: [["סוף שבוע", "חן לוי", "יום שישי 18:00", "https://dreamisland.co.il"]],
        },
      },
    ],
  },

  {
    name: "dream_wine_experience",
    category: "MARKETING",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "חוויית יין ייחודית" },
      {
        type: "BODY",
        text:
          "Dream Island מזמינה אתכם, {{1}}, לחוויית יין ייחודית. 🍷\n" +
          "מבחר יינות ישראליים מובחרים לצד נוף מרהיב ואווירה אינטימית.\n" +
          "להזמנה: {{2}}\n" +
          "Dream Island — לחיים! 🍷",
        example: { body_text: [["ורד ואייל", "https://dreamisland.co.il/wine"]] },
      },
    ],
  },

  {
    name: "dream_seasonal_offer",
    category: "MARKETING",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "הצעה עונתית מ-Dream Island" },
      {
        type: "BODY",
        text:
          "Dream Island מציעה חבילות {{1}} מיוחדות עבורכם, {{2}}! 🌟\n" +
          "עכשיו הזמן המושלם לבקר — הנחות בלעדיות לזמן מוגבל.\n" +
          "לפרטים ולהזמנה: {{3}}\n" +
          "Dream Island — מחכה לכם! 🌟",
        example: {
          body_text: [["קיץ", "משפחת לוי", "https://dreamisland.co.il/summer"]],
        },
      },
    ],
  },
];

async function createTemplate(
  wabaId: string,
  token:  string,
  tpl:    TemplateDef
): Promise<{ name: string; ok: boolean; status?: string; id?: string; error?: string }> {
  const url = `https://graph.facebook.com/${API_VER}/${wabaId}/message_templates`;
  const res = await fetch(url, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify({
      name:       tpl.name,
      language:   tpl.language,
      category:   tpl.category,
      components: tpl.components,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const data = await res.json() as Record<string, unknown>;

  if (res.ok && data.id) {
    return { name: tpl.name, ok: true, id: String(data.id), status: String(data.status ?? "PENDING") };
  }

  const err  = data.error as Record<string, unknown> | undefined;
  const code = Number(err?.code ?? 0);
  const msg  = String(err?.error_user_msg ?? err?.message ?? JSON.stringify(data));

  // code 100 = template already exists → treat as success
  if (code === 100 && msg.toLowerCase().includes("already")) {
    return { name: tpl.name, ok: true, status: "ALREADY_EXISTS" };
  }

  return { name: tpl.name, ok: false, error: `${msg} (code ${code})` };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const token  = Deno.env.get("META_WHATSAPP_TOKEN");
  const wabaId = Deno.env.get("META_BUSINESS_ACCOUNT_ID");

  if (!token || !wabaId) {
    return new Response(
      JSON.stringify({ ok: false, error: "META_WHATSAPP_TOKEN or META_BUSINESS_ACCOUNT_ID not set in secrets" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }

  const results = [];
  for (const tpl of TEMPLATES) {
    try {
      const r = await createTemplate(wabaId, token, tpl);
      results.push(r);
      console.log(`[register-templates] ${r.ok ? "✅" : "❌"} ${r.name}: ${r.status ?? r.error}`);
    } catch (e) {
      results.push({ name: tpl.name, ok: false, error: (e as Error).message });
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed  = results.filter((r) => !r.ok).length;

  return new Response(
    JSON.stringify({ ok: failed === 0, passed, failed, results }),
    { headers: { ...CORS, "Content-Type": "application/json" } }
  );
});
