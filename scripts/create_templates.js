#!/usr/bin/env node
// scripts/create_templates.js
// Registers Dream Island WhatsApp Business templates with Meta Graph API.
//
// Usage:
//   node scripts/create_templates.js
//
// Required env vars (set before running):
//   META_WHATSAPP_TOKEN   — System User access token from Meta Developer portal
//   META_WABA_ID          — WhatsApp Business Account ID (not the phone number ID)
//
// To get META_WABA_ID: Meta Business Suite → WhatsApp → API Setup → scroll to
//   "WhatsApp Business Account ID" (numeric, e.g. 123456789012345)
//
// Existing templates return status ALREADY_EXISTS (not an error).
//
// Exit codes: 0 = all ok, 1 = missing credentials, 2 = one or more failures
//
// Meta template rules (enforced server-side):
//   ✗ HEADER: no emojis, no formatting characters, no variables without example
//   ✗ BODY: cannot start OR end with {{n}} — must have literal text at both ends
//   ✓ BODY: emojis are fine anywhere except start/end positions next to {{n}}

"use strict";

const TOKEN   = process.env.META_WHATSAPP_TOKEN;
const WABA_ID = process.env.META_WABA_ID;
const API_VER = "v20.0";
const BASE    = `https://graph.facebook.com/${API_VER}/${WABA_ID}/message_templates`;

if (!TOKEN || !WABA_ID) {
  console.error("❌ Missing credentials. Set META_WHATSAPP_TOKEN and META_WABA_ID before running.");
  console.error("\nExample (PowerShell):");
  console.error('  $env:META_WHATSAPP_TOKEN="your_token_here"');
  console.error('  $env:META_WABA_ID="your_waba_id_here"');
  console.error("  node scripts/create_templates.js");
  process.exit(1);
}

// ── Template definitions (all 13) ─────────────────────────────────────────────
const TEMPLATES = [

  // ── UTILITY templates (transactional) ────────────────────────────────────────

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

  // ── MARKETING templates (promotional) ────────────────────────────────────────

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

// ── Runner ────────────────────────────────────────────────────────────────────

async function createTemplate(tpl) {
  const res = await fetch(BASE, {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name:       tpl.name,
      language:   tpl.language,
      category:   tpl.category,
      components: tpl.components,
    }),
  });

  const data = await res.json();

  if (res.ok && data.id) {
    return { ok: true, id: data.id, status: data.status ?? "PENDING" };
  }

  const code = data?.error?.code;
  const msg  = data?.error?.error_user_msg ?? data?.error?.message ?? JSON.stringify(data);

  if (code === 100 && msg.toLowerCase().includes("already")) {
    return { ok: true, id: null, status: "ALREADY_EXISTS" };
  }

  return { ok: false, error: msg, code };
}

async function main() {
  console.log(`\nDream Island — WhatsApp Template Registration`);
  console.log(`WABA: ${WABA_ID}  |  Templates: ${TEMPLATES.length}\n`);
  console.log("─".repeat(60));

  let passed = 0;
  let failed  = 0;

  for (const tpl of TEMPLATES) {
    process.stdout.write(`  ${tpl.name.padEnd(35)}`);
    try {
      const result = await createTemplate(tpl);
      if (result.ok) {
        const tag = result.status === "ALREADY_EXISTS"
          ? "⏭  כבר קיים"
          : `✅  נשלח לאישור (id: ${result.id})`;
        console.log(tag);
        passed++;
      } else {
        console.log(`❌  ${result.error} (code: ${result.code ?? "?"})`);
        failed++;
      }
    } catch (err) {
      console.log(`❌  network error: ${err.message}`);
      failed++;
    }
  }

  console.log("─".repeat(60));
  console.log(`\nסיכום: ${passed} הצליחו  |  ${failed} נכשלו\n`);
  process.exit(failed > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(2);
});
