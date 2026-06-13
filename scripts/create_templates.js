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
//   ✗ BODY: cannot start OR end with {{n}}
//   ✗ QUICK_REPLY button text: max 20 chars
//   ✗ URL button text: max 25 chars
//   ✓ Max 3 buttons per template
//   ✓ ALREADY_EXISTS is not an error

"use strict";

const TOKEN   = process.env.META_WHATSAPP_TOKEN;
const WABA_ID = process.env.META_WABA_ID;
const API_VER = "v20.0";
const BASE    = `https://graph.facebook.com/${API_VER}/${WABA_ID}/message_templates`;

if (!TOKEN || !WABA_ID) {
  console.error("❌ Missing credentials. Set META_WHATSAPP_TOKEN and META_WABA_ID before running.");
  process.exit(1);
}

// ── Template definitions ──────────────────────────────────────────────────────
//
// Funnel stage key:
//   Stage 1 — Discovery / Awareness
//   Stage 2 — Consideration / Offers
//   Stage 3 — Pre-arrival (confirmation + payment — UTILITY)
//   Stage 4 — On-property (welcome + mid-stay — UTILITY)
//   Stage 5 — Post-visit / Loyalty (UTILITY)
//
const TEMPLATES = [

  // ── STAGE 1: Discovery ────────────────────────────────────────────────────

  {
    name: "dream_availability_offer", category: "MARKETING", language: "he",
    components: [{
      type: "BODY",
      text: "שלום {{1}}, תודה שפנית לדרים איילנד! " +
            "התאריך שעניין אתכם פנוי ואנחנו שמחים לשמור מקום. " +
            "לפרטים על החבילות ולהשלמת ההזמנה: {{2}} — מחכים לכם",
      example: { body_text: [["ישראל ישראלי", "https://dream-island.co.il"]] },
    }],
  },

  {
    name: "dream_followup_no_response", category: "MARKETING", language: "he",
    components: [{
      type: "BODY",
      text: "שלום {{1}}, דרים איילנד בודקת מה שלומכם — " +
            "פנינו אליכם לפני כמה ימים ולא שמענו. " +
            "ה-60 דונם שלנו עדיין מחכים לכם. " +
            "נשמח לענות על כל שאלה ולמצוא את החבילה המושלמת",
      example: { body_text: [["ישראל ישראלי"]] },
    }],
  },

  // ── STAGE 2: Consideration / Offers ──────────────────────────────────────

  {
    name: "dream_last_minute", category: "MARKETING", language: "he",
    components: [{
      type: "BODY",
      text: "שלום {{1}}, יש לנו בשורה — ל-{{2}} נפתחו מקומות אחרונים בדרים איילנד! " +
            "הצעה מיוחדת לתאריך הזה, תוקף עד {{3}}. " +
            "לפרטים ולשריון מיידי: {{4}} — אל תפספסו",
      example: { body_text: [["ישראל ישראלי", "5 ביולי", "יום שישי 18:00", "https://dream-island.co.il"]] },
    }],
  },

  {
    name: "dream_seasonal_offer", category: "MARKETING", language: "he",
    components: [{
      type: "BODY",
      text: "שלום {{1}}, לכבוד {{2}} יש לנו הפתעה מדרים איילנד — " +
            "הצעה בלעדית שנוצרה במיוחד עבורכם. כמות מוגבלת, לזמן קצוב. " +
            "לפרטים ולהזמנה: {{3}} — מחכים לכם",
      example: { body_text: [["ישראל ישראלי", "קיץ 2026", "https://dream-island.co.il"]] },
    }],
  },

  {
    name: "dream_spa_package", category: "MARKETING", language: "he",
    components: [{
      type: "BODY",
      text: "שלום {{1}}, חשבנו עליכם — " +
            "חבילות הספא של דרים איילנד מושלמות לבריחה קצרה. " +
            "Classic & More, Deluxe עם טיפול ספא, Special Dream זוגי עם ואטסו או חמאם. " +
            "הכל כולל מסעדת ארמונים. לפרטים ולהזמנה: {{2}} — שמרו מקום",
      example: { body_text: [["ישראל ישראלי", "https://dream-island.co.il/spa"]] },
    }],
  },

  {
    name: "dream_special_occasion", category: "MARKETING", language: "he",
    components: [{
      type: "BODY",
      text: "שלום {{1}}, שמענו שיש לכם סיבה לחגוג! " +
            "דרים איילנד היא המקום המושלם — סוויטות עם בריכה פרטית, ספא ומסעדת ארמונים. " +
            "נכין עבורכם חוויה שלא תשכחו. לפרטים ולתיאום: {{2}} — שיהיה מזל טוב",
      example: { body_text: [["ישראל ישראלי", "https://dream-island.co.il/events"]] },
    }],
  },

  {
    name: "dream_suite_upsell", category: "MARKETING", language: "he",
    components: [{
      type: "BODY",
      text: "שלום {{1}}, יש לנו הצעה שלא תוכלו לסרב — " +
            "הסוויטות שלנו הן עולם אחר לגמרי. " +
            "רובי עם בריכה פרטית, אקוומרין עם גינה, אמטיסט עם נוף פנורמי. " +
            "כולן עם ג'קוזי פרטי וגישה לטרקלין VIP Symphony. " +
            "לפרטים: {{2}} — מחכים לכם",
      example: { body_text: [["ישראל ישראלי", "https://dream-island.co.il/suites"]] },
    }],
  },

  {
    name: "dream_wine_experience", category: "MARKETING", language: "he",
    components: [{
      type: "BODY",
      text: "שלום {{1}}, דרים איילנד מזמינה אתכם לחוויית יין ייחודית — " +
            "יינות ישראליים מובחרים, אווירה קסומה, לצד בריכות, ספא ומסעדת ארמונים. " +
            "ערב שלא תשכחו. לפרטים ולהזמנה: {{2}} — לחיים",
      example: { body_text: [["ישראל ישראלי", "https://dream-island.co.il/wine"]] },
    }],
  },

  // ── STAGE 3: Pre-arrival (UTILITY) ───────────────────────────────────────

  {
    // T-2 days: confirmation request with Quick Reply buttons.
    // "כן, מגיעים! ✨"      → webhook sends dream_payment_and_workshops
    // "לא, שינוי בתאריך 🗓️" → webhook flags guest + asks for new date
    name: "dream_arrival_confirmation", category: "UTILITY", language: "he",
    components: [
      {
        type: "BODY",
        text: "היי {{1}}! כבר ממש סופרים את הימים... 🥳\n" +
              "רק רצינו לוודא שהכל כרגיל לקראת השהות שלכם אצלנו בריזורט בעוד יומיים. " +
              "נשמח אם תאשרו לנו את הגעתכם כאן למטה:",
        example: { body_text: [["ישראל ישראלי"]] },
      },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "כן, מגיעים! ✨" },
          { type: "QUICK_REPLY", text: "לא, שינוי בתאריך 🗓️" },
        ],
      },
    ],
  },

  {
    // Sent immediately after guest taps "כן, מגיעים!".
    // Body: {{1}} = name, {{2}} = payment amount (₪)
    // Button 0 URL (dynamic): payment token → full URL: https://pay.dream-island.co.il/r/{token}
    // Button 1 URL (static): workshop signup
    // NOTE: pay.dream-island.co.il/r/{token} redirect endpoint pending Gama API integration.
    name: "dream_payment_and_workshops", category: "UTILITY", language: "he",
    components: [
      {
        type: "BODY",
        text: "איזה כיף, אנחנו כבר מחכים לכם! 🥰\n" +
              "כדי שהצ'ק-אין שלכם בריזורט יהיה מהיר, חלק וללא המתנה מיותרת בדלפק הקבלה, " +
              "נשמח אם תסדירו את יתרת השהות על סך {{1}} ₪ בקישור המאובטח שלכם.\n\n" +
              "בנוסף, מקומות היין והסדנאות הייחודיות שלנו בריזורט כבר כמעט מלאים! " +
              "שווה לשריין מקום מראש בקישור המצורף. נתראה ממש בקרוב! 🥂",
        example: { body_text: [["ישראל ישראלי", "1200"]] },
      },
      {
        type: "BUTTONS",
        buttons: [
          {
            type: "URL",
            text: "תשלום מהיר 💳",
            url: "https://pay.dream-island.co.il/r/{{1}}",
            example: ["session_abc123"],
          },
          {
            type: "URL",
            text: "שריון סדנאות 🍇",
            url: "https://go.oncehub.com/DreamIsland",
          },
        ],
      },
    ],
  },

  {
    // T-1 night: check-in reminder. {{1}} = name, {{2}} = resort phone.
    name: "dream_checkin_reminder", category: "UTILITY", language: "he",
    components: [{
      type: "BODY",
      text: "שלום {{1}}, מחר מגיעים לדרים איילנד — מחכים לכם! " +
            "המתחם פתוח מ-9:00, צ'ק אין לסוויטות מ-15:00. " +
            "בואו מוקדם ותיהנו מהכל. לכל שאלה: {{2}} — נתראה מחר",
      example: { body_text: [["ישראל ישראלי", "054-0000000"]] },
    }],
  },

  // ── STAGE 4: On-property ──────────────────────────────────────────────────

  {
    // Morning of arrival — all guest types. Replaces dream_morning_welcome + dream_arrival_tomorrow.
    name: "dream_welcome_morning", category: "UTILITY", language: "he",
    components: [{
      type: "BODY",
      text: "בוקר אור {{1}}! ✨ היום זה היום!\n" +
            "הריזורט מוכן, השמש בחוץ, וכל הצוות שלנו כבר מחכה להעניק לכם חוויה בלתי נשכחת.\n\n" +
            "כמה פרטים קטנים וחשובים לדרך:\n" +
            "🌸 מתקני הריזורט, הבריכות והמתחמים פתוחים עבורכם כבר מהשעה 09:00 בבוקר.\n" +
            "🔑 קבלת החדרים והסוויטות היא החל מהשעה 15:00.\n\n" +
            "אם יש לכם שאלה כלשהי בדרך, אנחנו זמינים כאן בצ'אט. נסיעה טובה ובטוחה! 🚗❤️",
      example: { body_text: [["ישראל ישראלי"]] },
    }],
  },

  {
    // Mid-stay check — sent day after arrival (arrival_date + 1).
    // Quick Reply buttons:
    //   "ספא וטיפולים 📜" → webhook sends spa menu as free-text (24h window)
    //   "דברו איתי 📞"    → webhook sets needs_callback=true + alerts staff
    name: "dream_mid_stay_check", category: "UTILITY", language: "he",
    components: [
      {
        type: "BODY",
        text: "היי {{1}}, הזמן עף כשנהנים... 🤍\n" +
              "רק רצינו לעצור לרגע ולוודא שאתם נרגעים, נהנים ומנצלים את כל הטוב שיש לדרים איילנד להציע.\n\n" +
              "אם חסר לכם משהו בסוויטה, או אם יש כל דבר שנוכל לעשות כדי להפוך את השהות שלכם לעוד יותר מושלמת — " +
              "פשוט תכתבו לנו כאן תגובה חופשית, או לחצו על הכפתור למטה ונציג יצור איתכם קשר מיד. תמשיכו ליהנות! ✨",
        example: { body_text: [["ישראל ישראלי"]] },
      },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "ספא וטיפולים 📜" },
          { type: "QUICK_REPLY", text: "דברו איתי 📞" },
        ],
      },
    ],
  },

  {
    name: "dream_workshop_reminder", category: "UTILITY", language: "he",
    components: [{
      type: "BODY",
      text: "תזכורת מדרים איילנד, {{1}}! " +
            "אתם רשומים לסדנת {{2}}. מיקום: {{3}} שעה: {{4}} — מצפים לכם",
      example: { body_text: [["ישראל ישראלי", "בישול ים-תיכוני", "מסעדת ארמונים", "11:00"]] },
    }],
  },

  {
    name: "dream_handover_agent", category: "UTILITY", language: "he",
    components: [{
      type: "BODY",
      text: "תודה על פנייתך, {{1}}. " +
            "העברנו את בקשתך לאחד מהצוות שיחזור אליך בהקדם. " +
            "דרים איילנד — תמיד לשירותך",
      example: { body_text: [["ישראל ישראלי"]] },
    }],
  },

  // ── STAGE 5: Post-visit ───────────────────────────────────────────────────

  {
    // Sent day after departure.
    // "היה מושלם! ✨"        → bot sends Google Review link (GOOGLE_REVIEW_URL secret)
    // "יש מקום לשיפור 💬"   → bot collects free-text feedback + staff alert
    name: "dream_checkout_feedback", category: "UTILITY", language: "he",
    components: [
      {
        type: "BODY",
        text: "היי {{1}}, השערים של הריזורט נסגרו מאחוריכם, ורצינו להגיד תודה ענקית שהתארחתם אצלנו. 🙏 " +
              "החיוך והחוויה שלכם הם הכל עבורנו.\n" +
              "נשמח מאוד לשמוע בכנות — איך היתה השהות שלכם אצלנו?",
        example: { body_text: [["ישראל ישראלי"]] },
      },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "היה מושלם! ✨" },
          { type: "QUICK_REPLY", text: "יש מקום לשיפור 💬" },
        ],
      },
    ],
  },

];

// ── Runner ────────────────────────────────────────────────────────────────────

async function createTemplate(tpl) {
  const res = await fetch(BASE, {
    method:  "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
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
    process.stdout.write(`  ${tpl.name.padEnd(40)}`);
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
