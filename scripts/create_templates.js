/**
 * create_templates.js
 * ───────────────────────────────────────────────────────────────
 * מרשם את כל 15 תבניות WhatsApp של Dream Island ב-Meta.
 *
 * שימוש:
 *   node scripts/create_templates.js              # כל התבניות
 *   node scripts/create_templates.js --skip-existing  # רק חדשות
 *   node scripts/create_templates.js --dry-run    # בדיקה ללא שליחה
 *
 * Node 18+ נדרש (fetch מובנה).
 * ───────────────────────────────────────────────────────────────
 */

require("dotenv").config();

const TOKEN         = process.env.REACT_APP_WHATSAPP_TOKEN;
const WABA_ID       = process.env.REACT_APP_WABA_ID;
const PHONE_ID      = process.env.REACT_APP_PHONE_NUMBER_ID;
const GRAPH_VER     = "v19.0";
const API_URL       = `https://graph.facebook.com/${GRAPH_VER}/${WABA_ID}/message_templates`;
const SKIP_EXISTING = process.argv.includes("--skip-existing");
const DRY_RUN       = process.argv.includes("--dry-run");

if (!TOKEN || !WABA_ID || !PHONE_ID) {
  console.error("\n❌  Missing env variables. Make sure .env contains:");
  console.error("    REACT_APP_WHATSAPP_TOKEN");
  console.error("    REACT_APP_WABA_ID");
  console.error("    REACT_APP_PHONE_NUMBER_ID\n");
  process.exit(1);
}

// ─── Template definitions ────────────────────────────────────────────────────
// exists: true  = כבר רשום ב-Meta (מדלגים עם --skip-existing)
// Variables: {{1}}, {{2}}, … כמו שמופיע בגוף ההודעה

const TEMPLATES = [

  // ══════════════════════════════════════════════════
  //  שלב 1 — אוטומציה לפני הגעה (T-2 days)
  // ══════════════════════════════════════════════════

  {
    stage:     "לפני הגעה",
    localName: "אישור הגעה — T-2 ימים",
    name:      "dream_arrival_confirm",
    category:  "UTILITY",
    language:  "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "בקרוב אצלנו ב-Dream Island!" },
      {
        type: "BODY",
        text: "היי {{1}}! מחכים לכם בשמחה 🏝️\n\nצ׳ק אין: {{2}} מ-15:00\n\nלשאלות — ענו כאן ישירות.",
        example: { body_text: [["שרה", "יום שישי 20.6"]] },
      },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },

  {
    stage:     "לפני הגעה",
    localName: "קישור לתשלום — fallback",
    name:      "dream_payment_link",
    category:  "UTILITY",
    language:  "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "תשלום להזמנה שלכם" },
      {
        type: "BODY",
        text: "היי {{1}}! להשלמת ההכנות לביקורכם ב-{{2}} — לחצו לתשלום המאובטח:\n{{3}}\n\nלאחר התשלום תקבלו אישור במייל. לשאלות — ענו כאן.",
        example: { body_text: [["שרה", "יום שישי 20.6", "https://pay.dream-island.co.il/pay?booking=demo"]] },
      },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },

  {
    stage:     "לפני הגעה",
    localName: "הזמנה לסדנאות — fallback",
    name:      "dream_workshop_signup",
    category:  "UTILITY",
    language:  "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "סדנאות Dream Island" },
      {
        type: "BODY",
        text: "היי {{1}}! במהלך שהייתכם מחכות לכם סדנאות מיוחדות — בישול, יוגה, אמנות ועוד.\n\nלהרשמה ולוח זמנים:\n{{2}}",
        example: { body_text: [["שרה", "https://dream-island.co.il/workshops"]] },
      },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },

  {
    stage:     "לפני הגעה",
    localName: "בוקר יום ההגעה",
    name:      "dream_arrival_morning",
    category:  "UTILITY",
    language:  "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "בוקר טוב — היום מגיעים!" },
      {
        type: "BODY",
        text: "בוקר טוב {{1}}! היום נפגשים 🎉\n\nצ׳ק אין מ-15:00 בקבלה הראשית.\n\nנסיעה טובה — מחכים לכם!",
        example: { body_text: [["שרה"]] },
      },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },

  {
    stage:     "לפני הגעה",
    localName: "תזכורת כניסה — T-1 יום",
    name:      "dream_checkin_reminder",
    category:  "UTILITY",
    language:  "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "תזכורת — מחר מגיעים!" },
      {
        type: "BODY",
        text: "היי {{1}}! תזכורת — מחר צ׳ק אין מ-15:00 בקבלה הראשית.\n\nלכל שאלה — {{2}}",
        example: { body_text: [["שרה", "08-6705600"]] },
      },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },

  // ══════════════════════════════════════════════════
  //  שלב 2 — שהייה
  // ══════════════════════════════════════════════════

  {
    stage:     "שהייה",
    localName: "הסוויטה מוכנה",
    exists:    true,
    name:      "dream_suite_vip",
    category:  "UTILITY",
    language:  "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "הסוויטה שלכם מוכנה" },
      {
        type: "BODY",
        text: "היי {{1}}! הסוויטה שלכם מוכנה ומחכה. בריכה פרטית, ג׳קוזי, וחצר מלכותית רק לכם. Check-in מ-15:00. מחכים לכם! 🏝️",
        example: { body_text: [["שרה"]] },
      },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },

  {
    stage:     "שהייה",
    localName: "תזכורת צ׳ק-אאוט",
    name:      "dream_checkout_reminder",
    category:  "UTILITY",
    language:  "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "תזכורת: צ׳ק אאוט מחר" },
      {
        type: "BODY",
        text: "היי {{1}}! תזכורת — צ׳ק אאוט מחר בשעה 11:00.\n\nרוצים להאריך שהייה? מחירים מיוחדים לדיירים קיימים.\n\nענו כאן להארכה או לסיוע.",
        example: { body_text: [["שרה"]] },
      },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },

  {
    stage:     "שהייה",
    localName: "הודעה לחדרנית — handover",
    name:      "dream_handover_agent",
    category:  "UTILITY",
    language:  "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "משימת ניקיון חדשה" },
      {
        type: "BODY",
        text: "שלום {{1}}! החדר {{2}} ממתין לניקיון. אנא עדכנו בסיום.",
        example: { body_text: [["רחל", "ספיר"]] },
      },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },

  // ══════════════════════════════════════════════════
  //  שלב 3 — שיווק (אורחים נוכחיים ועתידיים)
  // ══════════════════════════════════════════════════

  {
    stage:     "שיווק",
    localName: "בילוי מים וספא",
    exists:    true,
    name:      "dream_water_spa",
    category:  "MARKETING",
    language:  "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "חווית המים של Dream Island" },
      {
        type: "BODY",
        text: "היי {{1}}! הבילוי היומי בדרים איילנד הוא מסע של ניתוק. מחכים לכם 1,500 מ״ר של תענוגות מים, 3 בריכות זרמים, חמאם טורקי וטיפולי ואטסו. לשריון מקום לחצו: {{2}} — נשמח לארח 🏝️",
        example: { body_text: [["שרה", "https://dream-island.co.il/booking"]] },
      },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },

  {
    stage:     "שיווק",
    localName: "קולינריה — ערמונים",
    exists:    true,
    name:      "dream_culinary",
    category:  "MARKETING",
    language:  "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "מסעדת ערמונים פתוחה" },
      {
        type: "BODY",
        text: "היי {{1}}! מסעדת ערמונים פתוחה וממתינה לכם עם תפריט שף מיוחד. בנוסף — פוד טראקים ברחבי הריזורט כל היום. תיאבון! 🍷",
        example: { body_text: [["שרה"]] },
      },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },

  {
    stage:     "שיווק",
    localName: "חווית Premium Day",
    exists:    true,
    name:      "dream_premium_day",
    category:  "MARKETING",
    language:  "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "Premium Day - יום כיף מושלם" },
      {
        type: "BODY",
        text: "היי {{1}}! חוויית ה-Premium Day שלנו כוללת קוטג׳ פרטי, קוקטיילים ופירות טריים + גישה מלאה לכל מתחם הספא. מושלם ליום כיף! לפרטים לחצו: {{2}} — מחכים לכם 🍷",
        example: { body_text: [["שרה", "https://dream-island.co.il/premium-day"]] },
      },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },

  {
    stage:     "שיווק",
    localName: "הזמנה לאירוע מיוחד",
    name:      "dream_event_invite",
    category:  "MARKETING",
    language:  "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "אירוע מיוחד ב-Dream Island" },
      {
        type: "BODY",
        text: "היי {{1}}! אנחנו שמחים להזמין אתכם לאירוע מיוחד:\n\n{{2}}\n📅 {{3}}\n\nלפרטים ורישום:\n{{4}}",
        example: { body_text: [["שרה", "ערב ג׳אז ובריכה", "יום שישי 27.6.2026", "https://dream-island.co.il/events"]] },
      },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },

  // ══════════════════════════════════════════════════
  //  שלב 4 — שימור לקוחות (Post-Stay)
  // ══════════════════════════════════════════════════

  {
    stage:     "שימור",
    localName: "בקשת ביקורת — T+1",
    name:      "dream_post_visit",
    category:  "MARKETING",
    language:  "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "תודה על הביקור ב-Dream Island" },
      {
        type: "BODY",
        text: "היי {{1}}! תודה על שהיית הנפלאה אצלנו 🏝️\n\nנשמח לשמוע מה חשבתם — כל ביקורת חשובה לנו:\nhttps://g.page/r/dream-island/review\n\nמקווים לראותכם שוב בקרוב!",
        example: { body_text: [["שרה"]] },
      },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },

  {
    stage:     "שימור",
    localName: "הצעת חזרה — T+21",
    name:      "dream_return_offer",
    category:  "MARKETING",
    language:  "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "חוזרים לחלום? יש לנו הצעה" },
      {
        type: "BODY",
        text: "היי {{1}}! בגלל שאהבתם את Dream Island — הצעה מיוחדת לחזרה:\n\n{{2}}\n\nבתוקף עד: {{3}}\n\nלפרטים ולהזמנה:\n{{4}}",
        example: { body_text: [["שרה", "לילה + כניסה לספא במחיר מיוחד", "31.7.2026", "https://dream-island.co.il/booking"]] },
      },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },

  {
    stage:     "שימור",
    localName: "ריאקטיבציה — T+90",
    name:      "dream_event_reactivate",
    category:  "MARKETING",
    language:  "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "מתגעגעים ל-Dream Island?" },
      {
        type: "BODY",
        text: "היי {{1}}! זה כבר קצת זמן שלא ראינו אתכם.\n\nאנחנו שמחים להזמין אתכם לאירוע קרוב:\n{{2}}\n\nלפרטים ולהזמנה:\n{{3}}",
        example: { body_text: [["שרה", "ערב גורמה מיוחד — אוגוסט 2026", "https://dream-island.co.il/events"]] },
      },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },

  // ══════════════════════════════════════════════════
  //  שלב 5 — מידע ונהלים (General Utility)
  // ══════════════════════════════════════════════════

  {
    stage:     "מידע",
    localName: "שעות ונהלים",
    exists:    true,
    name:      "dream_policies",
    category:  "UTILITY",
    language:  "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "מידע שימושי - Dream Island" },
      {
        type: "BODY",
        text: "היי {{1}}! תזכורת — הריזורט פתוח א׳-ה׳ 09:00-21:00, שישי 09:00-18:00, שבת 09:00-19:00. הבריכות נסגרות שעה לפני. לכל שאלה — 08-6705600",
        example: { body_text: [["שרה"]] },
      },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },

  {
    stage:     "מידע",
    localName: "עדכון תפעולי לאורח",
    name:      "dream_ops_update",
    category:  "UTILITY",
    language:  "he",
    components: [
      { type: "HEADER", format: "TEXT", text: "הודעה חשובה — Dream Island" },
      {
        type: "BODY",
        text: "היי {{1}}! עדכון חשוב לגבי ביקורכם:\n\n{{2}}\n\nלכל שאלה — ענו כאן ישירות.",
        example: { body_text: [["שרה", "הבריכה הפנימית תהיה סגורה לתחזוקה ב-15.6 בין 10:00-14:00"]] },
      },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },

];

// ─── Create single template ──────────────────────────────────────────────────
async function createTemplate(tpl) {
  const { name, category, language, components } = tpl;
  const res = await fetch(API_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ name, category, language, components }),
  });
  const json = await res.json();

  if (res.ok && json.id) {
    return { ok: true, id: json.id, status: json.status ?? "PENDING" };
  }

  // Meta error 2388085 = template already exists
  const code = json.error?.code;
  const sub  = json.error?.error_subcode;
  if (code === 100 && sub === 2388085) {
    return { ok: true, id: "—", status: "ALREADY_EXISTS" };
  }

  return {
    ok:      false,
    code,
    sub,
    message: json.error?.message ?? JSON.stringify(json),
    full:    JSON.stringify(json, null, 2),
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────
(async () => {
  const newCount      = TEMPLATES.filter(t => !t.exists).length;
  const existingCount = TEMPLATES.filter(t => t.exists).length;
  const toRun         = SKIP_EXISTING ? TEMPLATES.filter(t => !t.exists) : TEMPLATES;

  console.log("\n🏝️  Dream Island — WhatsApp Template Registration");
  console.log(`   WABA ID    : ${WABA_ID}`);
  console.log(`   Phone ID   : ${PHONE_ID}`);
  console.log(`   Total      : ${TEMPLATES.length}  (${newCount} חדשות, ${existingCount} קיימות)`);
  console.log(`   Will send  : ${toRun.length}${SKIP_EXISTING ? "  (--skip-existing)" : ""}`);
  if (DRY_RUN) console.log("   ⚠️  DRY RUN — לא שולח כלום\n");
  else         console.log("");

  let passed = 0, failed = 0, skipped = 0;
  let currentStage = "";

  for (const tpl of toRun) {
    if (tpl.stage !== currentStage) {
      currentStage = tpl.stage;
      console.log(`\n── ${currentStage} ──────────────────────────────`);
    }

    const label = `  ${tpl.localName}`.padEnd(42);
    process.stdout.write(label);

    if (DRY_RUN) {
      console.log(`⏭  ${tpl.name}`);
      skipped++;
      continue;
    }

    const result = await createTemplate(tpl);

    if (result.ok && result.status === "ALREADY_EXISTS") {
      console.log(`⬛  כבר קיים`);
      skipped++;
    } else if (result.ok) {
      console.log(`✅  id=${result.id}  status=${result.status}`);
      passed++;
    } else {
      console.log(`❌  code=${result.code}/${result.sub}  ${result.message}`);
      failed++;
    }
  }

  console.log(`\n─────────────────────────────────────────────`);
  console.log(`  ✅ הצליח: ${passed}   ⬛ קיים: ${skipped}   ❌ נכשל: ${failed}`);
  console.log(`  אישור Meta לוקח ~24-48 שעות (PENDING → APPROVED)`);
  console.log(`─────────────────────────────────────────────\n`);

  if (failed > 0) process.exit(1);
})();
