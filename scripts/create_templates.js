#!/usr/bin/env node
// scripts/create_templates.js
// Registers Dream Island WhatsApp Business templates with Meta Graph API.
//
// Usage:
//   node scripts/create_templates.js
//
// Required env vars:
//   META_WHATSAPP_TOKEN   — System User access token from Meta Developer portal
//   META_WABA_ID          — WhatsApp Business Account ID (not the phone number ID)
//
// Meta template rules:
//   ✗ BODY: cannot start OR end with {{n}} — must have literal text at both ends
//   ✗ HEADER: no emojis, no formatting characters, no variables without example
//   ✓ BODY: emojis fine; Hebrew RTL fine
//
// Existing templates: Meta returns ALREADY_EXISTS (not an error).

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

// ── Template definitions ──────────────────────────────────────────────────────
//
// Funnel stage key:
//   Stage 1 — Discovery / Awareness
//   Stage 2 — Consideration / Offers
//   Stage 3 — Pre-arrival flow (UTILITY)
//   Stage 4 — On-property
//   Stage 5 — Post-visit / Loyalty
//
const TEMPLATES = [

  // ── STAGE 1: Discovery ────────────────────────────────────────────────────

  {
    name: "dream_availability_offer",
    category: "MARKETING",
    language: "he",
    components: [
      {
        type: "BODY",
        text:
          "שלום {{1}}, תודה שפנית לדרים איילנד! " +
          "התאריך שעניין אתכם פנוי ואנחנו שמחים לשמור מקום. " +
          "לפרטים על החבילות ולהשלמת ההזמנה: {{2}} — מחכים לכם",
        example: { body_text: [["ישראל ישראלי", "https://dream-island.co.il"]] },
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
          "שלום {{1}}, דרים איילנד בודקת מה שלומכם — " +
          "פנינו אליכם לפני כמה ימים ולא שמענו. " +
          "ה-60 דונם שלנו עדיין מחכים לכם. " +
          "נשמח לענות על כל שאלה ולמצוא את החבילה המושלמת",
        example: { body_text: [["ישראל ישראלי"]] },
      },
    ],
  },

  // ── STAGE 2: Consideration / Offers ──────────────────────────────────────

  {
    name: "dream_last_minute",
    category: "MARKETING",
    language: "he",
    components: [
      {
        type: "BODY",
        text:
          "שלום {{1}}, יש לנו בשורה — ל-{{2}} נפתחו מקומות אחרונים בדרים איילנד! " +
          "הצעה מיוחדת לתאריך הזה, תוקף עד {{3}}. " +
          "לפרטים ולשריון מיידי: {{4}} — אל תפספסו",
        example: {
          body_text: [["ישראל ישראלי", "5 ביולי", "יום שישי 18:00", "https://dream-island.co.il"]],
        },
      },
    ],
  },

  {
    name: "dream_seasonal_offer",
    category: "MARKETING",
    language: "he",
    components: [
      {
        type: "BODY",
        text:
          "שלום {{1}}, לכבוד {{2}} יש לנו הפתעה מדרים איילנד — " +
          "הצעה בלעדית שנוצרה במיוחד עבורכם. כמות מוגבלת, לזמן קצוב. " +
          "לפרטים ולהזמנה: {{3}} — מחכים לכם",
        example: {
          body_text: [["ישראל ישראלי", "קיץ 2026", "https://dream-island.co.il"]],
        },
      },
    ],
  },

  {
    name: "dream_spa_package",
    category: "MARKETING",
    language: "he",
    components: [
      {
        type: "BODY",
        text:
          "שלום {{1}}, חשבנו עליכם — " +
          "חבילות הספא של דרים איילנד מושלמות לבריחה קצרה. " +
          "Classic & More, Deluxe עם טיפול ספא, Special Dream זוגי עם ואטסו או חמאם. " +
          "הכל כולל מסעדת ארמונים. לפרטים ולהזמנה: {{2}} — שמרו מקום",
        example: { body_text: [["ישראל ישראלי", "https://dream-island.co.il/spa"]] },
      },
    ],
  },

  {
    name: "dream_special_occasion",
    category: "MARKETING",
    language: "he",
    components: [
      {
        type: "BODY",
        text:
          "שלום {{1}}, שמענו שיש לכם סיבה לחגוג! " +
          "דרים איילנד היא המקום המושלם — סוויטות עם בריכה פרטית, ספא ומסעדת ארמונים. " +
          "נכין עבורכם חוויה שלא תשכחו. לפרטים ולתיאום: {{2}} — שיהיה מזל טוב",
        example: { body_text: [["ישראל ישראלי", "https://dream-island.co.il/events"]] },
      },
    ],
  },

  {
    name: "dream_suite_upsell",
    category: "MARKETING",
    language: "he",
    components: [
      {
        type: "BODY",
        text:
          "שלום {{1}}, יש לנו הצעה שלא תוכלו לסרב — " +
          "הסוויטות שלנו הן עולם אחר לגמרי. " +
          "רובי עם בריכה פרטית, אקוומרין עם גינה, אמטיסט עם נוף פנורמי. " +
          "כולן עם ג'קוזי פרטי וגישה לטרקלין VIP Symphony. " +
          "לפרטים: {{2}} — מחכים לכם",
        example: { body_text: [["ישראל ישראלי", "https://dream-island.co.il/suites"]] },
      },
    ],
  },

  {
    name: "dream_wine_experience",
    category: "MARKETING",
    language: "he",
    components: [
      {
        type: "BODY",
        text:
          "שלום {{1}}, דרים איילנד מזמינה אתכם לחוויית יין ייחודית — " +
          "יינות ישראליים מובחרים, אווירה קסומה, לצד בריכות, ספא ומסעדת ארמונים. " +
          "ערב שלא תשכחו. לפרטים ולהזמנה: {{2}} — לחיים",
        example: { body_text: [["ישראל ישראלי", "https://dream-island.co.il/wine"]] },
      },
    ],
  },

  // ── STAGE 3: Pre-arrival flow (UTILITY) ──────────────────────────────────

  {
    name: "dream_pre_arrival_confirm",
    category: "UTILITY",
    language: "he",
    components: [
      {
        type: "BODY",
        text:
          "שלום {{1}}, אנחנו ב-Dream Island שמחים לקבל אתכם בתאריך {{2}}. " +
          "מאשרים הגעה? השיבו *כן* לאישור ולקבלת פרטי התשלום והמתחם",
        example: { body_text: [["ישראל ישראלי", "15.07.2026"]] },
      },
    ],
  },

  {
    name: "dream_payment_link",
    category: "UTILITY",
    language: "he",
    components: [
      {
        type: "BODY",
        text:
          "מעולה {{1}}! לסיום ההזמנה לדרים איילנד — " +
          "הסכום לתשלום: {{2}} ₪. לתשלום מאובטח: {{3}} — נתראה בקרוב",
        example: {
          body_text: [["ישראל ישראלי", "1200", "https://pay.dream-island.co.il/abc123"]],
        },
      },
    ],
  },

  {
    name: "dream_workshop_signup",
    category: "UTILITY",
    language: "he",
    components: [
      {
        type: "BODY",
        text:
          "דרים איילנד מזמינה אתכם, {{1}}, להירשם לסדנאות המיוחדות שלנו! " +
          "מגוון סדנאות בבישול, יין, ספא ועוד. להרשמה: {{2}} — מחכים לכם",
        example: {
          body_text: [["ישראל ישראלי", "https://dream-island.co.il/workshops"]],
        },
      },
    ],
  },

  {
    name: "dream_checkin_reminder",
    category: "UTILITY",
    language: "he",
    components: [
      {
        type: "BODY",
        text:
          "שלום {{1}}, מחר מגיעים לדרים איילנד — מחכים לכם! " +
          "המתחם פתוח מ-9:00, צ'ק אין לסוויטות מ-15:00. " +
          "בואו מוקדם ותיהנו מהכל. לכל שאלה: {{2}} — נתראה מחר",
        example: { body_text: [["ישראל ישראלי", "054-0000000"]] },
      },
    ],
  },

  // ── STAGE 4: On-property ──────────────────────────────────────────────────

  {
    name: "dream_morning_welcome",
    category: "UTILITY",
    language: "he",
    components: [
      {
        type: "BODY",
        text:
          "בוקר טוב {{1}}! היום מגיעים לדרים איילנד. " +
          "כמה דברים שכדאי לדעת: הכניסה פתוחה מ-9:00, חנייה חינם בכניסה. " +
          "הבריכות והספא פתוחים מרגע ההגעה. צ'ק אין לסוויטות מ-15:00. " +
          "לבעלי סוויטה — הטרקלין Symphony ממתין לכם. נסיעה טובה ומחכים לכם בחום",
        example: { body_text: [["ישראל ישראלי"]] },
      },
    ],
  },

  {
    name: "dream_arrival_tomorrow",
    category: "UTILITY",
    language: "he",
    components: [
      {
        type: "BODY",
        text:
          "שלום {{1}}, היום מגיעים לדרים איילנד! " +
          "המתחם פתוח מ-9:00, צ'ק אין לסוויטות מ-15:00. " +
          "הבריכות, הספא ומסעדת ארמונים מוכנים עבורכם. " +
          "לבעלי סוויטה — הטרקלין Symphony מוכן. מחכים לכם בחום",
        example: { body_text: [["ישראל ישראלי"]] },
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
          "תזכורת מדרים איילנד, {{1}}! " +
          "אתם רשומים לסדנת {{2}}. מיקום: {{3}} שעה: {{4}} — מצפים לכם",
        example: {
          body_text: [["ישראל ישראלי", "בישול ים-תיכוני", "מסעדת ארמונים", "11:00"]],
        },
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
          "תודה על פנייתך, {{1}}. " +
          "העברנו את בקשתך לאחד מהצוות שיחזור אליך בהקדם. " +
          "דרים איילנד — תמיד לשירותך",
        example: { body_text: [["ישראל ישראלי"]] },
      },
    ],
  },

  // ── STAGE 5: Post-visit / Loyalty ─────────────────────────────────────────

  {
    name: "dream_post_visit",
    category: "MARKETING",
    language: "he",
    components: [
      {
        type: "BODY",
        text:
          "תודה שבחרתם בדרים איילנד, {{1}}! " +
          "מקווים שנהניתם מכל רגע — מהמים, הספא ומסעדת ארמונים. " +
          "נשמח לשמוע מכם, וכבר מחכים לביקור הבא. אתם תמיד מוזמנים",
        example: { body_text: [["ישראל ישראלי"]] },
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
    process.stdout.write(`  ${tpl.name.padEnd(38)}`);
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
