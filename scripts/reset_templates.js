/**
 * reset_templates.js
 * ───────────────────────────────────────────────────────────────
 * מוחק ומיצר מחדש את כל 13 תבניות דרים איילנד ב-Meta.
 * כולל נוסח מחודש: ללא מחירים, שמות נכונים, שפה יוקרתית.
 *
 * שימוש:
 *   node scripts/reset_templates.js            (מחק + צור)
 *   node scripts/reset_templates.js --create-only (צור בלבד)
 *   node scripts/reset_templates.js --dry-run     (תצוגה בלבד)
 *
 * דרישות: Node 18+ | .env עם REACT_APP_WHATSAPP_TOKEN + REACT_APP_WABA_ID
 * ───────────────────────────────────────────────────────────────
 */

require("dotenv").config();

const TOKEN         = process.env.REACT_APP_WHATSAPP_TOKEN;
const WABA_ID       = process.env.REACT_APP_WABA_ID;
const GRAPH_VERSION = "v19.0";
const API_URL       = `https://graph.facebook.com/${GRAPH_VERSION}/${WABA_ID}/message_templates`;

const ARGS        = process.argv.slice(2);
const CREATE_ONLY = ARGS.includes("--create-only");
const DRY_RUN     = ARGS.includes("--dry-run");

// ── Validate env ─────────────────────────────────────────────────────────────
if (!TOKEN || !WABA_ID) {
  console.error("\n❌  חסרים משתני סביבה. ודא שב-.env יש:");
  console.error("    REACT_APP_WHATSAPP_TOKEN");
  console.error("    REACT_APP_WABA_ID\n");
  process.exit(1);
}

// ── Sleep helper ─────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 17 תבניות (13 מחודשות + 4 חדשות לאוטומציית הגעות) ──────────────────────
const TEMPLATES = [
  // ── STAGE 1: יצירת קשר ──────────────────────────────────────────────────
  {
    label:    "1. זמינות / תגובה ראשונה",
    name:     "dream_availability_offer",
    category: "MARKETING",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT",
        text: "תאריך פנוי בדרים איילנד" },
      { type: "BODY",
        text: "בשורה מצוינת, {{1}} — התאריך שעניין אתכם פנוי בדרים איילנד! יש לנו חבילות לכל טעם. לפרטים ולהזמנה: {{2}} — מהרו לפני שיתפס",
        example: { body_text: [["שם לקוח", "https://dream-island.co.il/spa_deals"]] } },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },
  {
    label:    "2. חיזור / ללא מענה",
    name:     "dream_followup_no_response",
    category: "MARKETING",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT",
        text: "דרים איילנד ממתינה לכם" },
      { type: "BODY",
        text: "שלום {{1}}, פנינו אליכם לאחרונה ולא שמענו. ההצעה עדיין בתוקף — דרים איילנד ממתינה לכם עם 60 דונם של חוויה שלא תשכחו. נשמח לענות על כל שאלה",
        example: { body_text: [["שם לקוח"]] } },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },
  {
    label:    "3. הצעה אחרונה / Last Minute",
    name:     "dream_last_minute",
    category: "MARKETING",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT",
        text: "הצעה אחרונה מדרים איילנד" },
      { type: "BODY",
        text: "שלום {{1}}, יש לנו בשורה — ל-{{2}} נפתחו מקומות אחרונים בדרים איילנד! הצעה מיוחדת לתאריך הזה, תוקף עד {{3}}. להזמנה מהירה: {{4}} — אל תפספסו",
        example: { body_text: [["שם לקוח", "שישי הקרוב", "31.12.2026", "https://dream-island.co.il"]] } },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },
  // ── STAGE 2: שיווק חכם ──────────────────────────────────────────────────
  {
    label:    "4. מבצע עונתי",
    name:     "dream_seasonal_offer",
    category: "MARKETING",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT",
        text: "מבצע מיוחד מדרים איילנד" },
      { type: "BODY",
        text: "שלום {{1}}, לכבוד {{2}} יש לנו הפתעה מדרים איילנד — הצעה בלעדית שנוצרה במיוחד עבורכם. כמות מוגבלת, לזמן קצוב. לפרטים ולהזמנה: {{3}} — מחכים לכם",
        example: { body_text: [["שם לקוח", "חופשת הקיץ", "https://dream-island.co.il"]] } },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },
  {
    label:    "5. חבילות ספא",
    name:     "dream_spa_package",
    category: "MARKETING",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT",
        text: "חבילות ספא של דרים איילנד" },
      { type: "BODY",
        text: "שלום {{1}}, חבילות הספא שלנו מחכות לכם — Classic & More, Deluxe עם טיפול ספא, Special Dream זוגי עם ואטסו או חמאם. הכל כולל מסעדת ערמונים. לפרטים ולהזמנה: {{2}} — שמרו מקום",
        example: { body_text: [["שם לקוח", "https://dream-island.co.il/spa_deals"]] } },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },
  {
    label:    "6. אירוע מיוחד / חגיגה",
    name:     "dream_special_occasion",
    category: "MARKETING",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT",
        text: "חגיגה בדרים איילנד" },
      { type: "BODY",
        text: "שלום {{1}}, ב-דרים איילנד אוהבים לחגוג! ימי הולדת, נישואין, אירועים מיוחדים — סוויטות עם בריכה פרטית, חצר מלכותית, ספא וחבילות מותאמות. לפרטים: {{2}} — שיהיה מזל טוב",
        example: { body_text: [["שם לקוח", "https://dream-island.co.il"]] } },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },
  {
    label:    "7. שדרוג סוויטה",
    name:     "dream_suite_upsell",
    category: "MARKETING",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT",
        text: "סוויטות יוקרה בדרים איילנד" },
      { type: "BODY",
        text: "שלום {{1}}, הסוויטות שלנו הן עולם בפני עצמן — רובי עם בריכה פרטית, אקוומרין עם גינה, אמטיסט עם נוף פנורמי. כולן עם ג׳קוזי פרטי וגישה לטרקלין VIP Symphony. לפרטים: {{2}} — מחכים לכם",
        example: { body_text: [["שם לקוח", "https://dream-island.co.il/suites"]] } },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },
  {
    label:    "8. חוויית יין",
    name:     "dream_wine_experience",
    category: "MARKETING",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT",
        text: "חוויית יין בדרים איילנד" },
      { type: "BODY",
        text: "שלום {{1}}, דרים איילנד מזמינה אתכם לחוויית יין ייחודית — יינות ישראליים מובחרים, אווירה קסומה, לצד בריכות, ספא ומסעדת ערמונים. ערב שלא תשכחו. לפרטים ולהזמנה: {{2}} — לחיים",
        example: { body_text: [["שם לקוח", "https://dream-island.co.il"]] } },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },
  // ── STAGE 3: לפני ובמהלך השהות ─────────────────────────────────────────
  {
    label:    "9. תזכורת לפני הגעה",
    name:     "dream_checkin_reminder",
    category: "UTILITY",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT",
        text: "תזכורת לקראת הגעתכם לדרים איילנד" },
      { type: "BODY",
        text: "שלום {{1}}, תזכורת לקראת הגעתכם מחר לדרים איילנד! המתחם פתוח מ-9:00, צ׳ק אין לסוויטות מ-15:00. הבריכות, הספא ומסעדת ערמונים פתוחים מרגע ההגעה. לכל שאלה: {{2}} — נתראה מחר",
        example: { body_text: [["שם לקוח", "08-6705600"]] } },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },
  {
    label:    "10. ביום ההגעה",
    name:     "dream_arrival_tomorrow",
    category: "UTILITY",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT",
        text: "היום מגיעים לדרים איילנד" },
      { type: "BODY",
        text: "שלום {{1}}, דרים איילנד שמחה לראותכם היום! המתחם פתוח מ-9:00, צ׳ק אין לסוויטות מ-15:00. הבריכות, הספא ומסעדת ערמונים מוכנים עבורכם. לבעלי סוויטה — הטרקלין Symphony מוכן. מחכים לכם בחום",
        example: { body_text: [["שם לקוח"]] } },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },
  {
    label:    "11. תזכורת סדנה / אירוע",
    name:     "dream_workshop_reminder",
    category: "UTILITY",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT",
        text: "תזכורת לאירוע בדרים איילנד" },
      { type: "BODY",
        text: "תזכורת מדרים איילנד, {{1}}! אתם רשומים לסדנת {{2}}. מיקום: {{3}} שעה: {{4}} — מצפים לכם בשמחה",
        example: { body_text: [["שם לקוח", "יוגה בבוקר", "לובי ראשי", "10:00"]] } },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },
  // ── STAGE 4: אחרי הביקור ────────────────────────────────────────────────
  {
    label:    "12. תודה אחרי ביקור",
    name:     "dream_post_visit",
    category: "MARKETING",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT",
        text: "תודה מדרים איילנד" },
      { type: "BODY",
        text: "תודה שבחרתם בדרים איילנד, {{1}}! מקווים שנהניתם מכל רגע — מהמים, הספא ומסעדת ערמונים. נשמח לשמוע מכם, וכבר מחכים לביקור הבא. אתם תמיד מוזמנים",
        example: { body_text: [["שם לקוח"]] } },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },
  // ── STAGE 5: תשתית אוטומציה ─────────────────────────────────────────────
  {
    label:    "13. העברה לצוות",
    name:     "dream_handover_agent",
    category: "UTILITY",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT",
        text: "צוות דרים איילנד לשירותך" },
      { type: "BODY",
        text: "תודה על פנייתך, {{1}}. העברנו את בקשתך לאחד מהצוות שיחזור אליך בהקדם. דרים איילנד — תמיד לשירותך",
        example: { body_text: [["שם לקוח"]] } },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },
  // ── STAGE 6: אוטומציית הגעות ─────────────────────────────────────────────
  {
    label:    "14. אישור הגעה (יומיים לפני)",
    name:     "dream_arrival_confirm",
    category: "UTILITY",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT",
        text: "אישור הגעה לדרים איילנד" },
      { type: "BODY",
        text: "שלום {{1}}, נשמח לראותכם בדרים איילנד ב-{{2}}! כדי שנוכל להכין הכל עבורכם — אנא אשרו הגעתכם. כתבו כן לאישור, לא לביטול. מחכים לכם",
        example: { body_text: [["שם לקוח", "שישי 27.06"]] } },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },
  {
    label:    "15. קישור לתשלום (אחרי אישור)",
    name:     "dream_payment_link",
    category: "UTILITY",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT",
        text: "קישור לתשלום — דרים איילנד" },
      { type: "BODY",
        text: "תודה על האישור, {{1}}! להשלמת ההזמנה לתאריך {{2}}, לחצו על הקישור לתשלום מאובטח: {{3}} — לאחר התשלום תקבלו אישור סופי. מחכים לכם",
        example: { body_text: [["שם לקוח", "שישי 27.06", "https://pay.dream-island.co.il/abc123"]] } },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },
  {
    label:    "16. הרשמה לסדנאות (אופציונלי)",
    name:     "dream_workshop_signup",
    category: "MARKETING",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT",
        text: "סדנאות מיוחדות בדרים איילנד" },
      { type: "BODY",
        text: "שלום {{1}}, לביקורכם ב-{{2}} יש לנו סדנאות מיוחדות שאפשר להצטרף אליהן. לקישור ההרשמה: {{3}} — מקומות מוגבלים, אל תפספסו",
        example: { body_text: [["שם לקוח", "שישי 27.06", "https://dream-island.co.il/workshops"]] } },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },
  {
    label:    "17. בוקר ההגעה — מדריך ואיחולים",
    name:     "dream_arrival_morning",
    category: "UTILITY",
    language: "he",
    components: [
      { type: "HEADER", format: "TEXT",
        text: "בוקר טוב מדרים איילנד" },
      { type: "BODY",
        text: "בוקר טוב {{1}}! היום מגיעים לדרים איילנד — ממש מחכים לכם! כמה דברים שכדאי לדעת: המתחם פתוח מ-9:00, חניה חינם בכניסה, חלוקי רחצה ממתינים לכם. לאורחי סוויטות — צ׳ק אין מ-15:00, הטרקלין Symphony מוכן. שיהיה יום מושלם",
        example: { body_text: [["שם לקוח"]] } },
      { type: "FOOTER", text: "Dream Island Resort | 08-6705600" },
    ],
  },
];

// ── API: Delete template ──────────────────────────────────────────────────────
async function deleteTemplate(name) {
  const res  = await fetch(`${API_URL}?name=${encodeURIComponent(name)}`, {
    method:  "DELETE",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const json = await res.json();
  if (res.ok && json.success) return { ok: true };
  // 100 = template not found — that's fine
  if (json.error?.code === 100) return { ok: true, note: "לא קיימת" };
  return { ok: false, error: json.error?.message ?? JSON.stringify(json) };
}

// ── API: Create template ──────────────────────────────────────────────────────
async function createTemplate(tpl) {
  const payload = {
    name:       tpl.name,
    category:   tpl.category,
    language:   tpl.language,
    components: tpl.components,
  };
  const res  = await fetch(API_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (res.ok && json.id) return { ok: true, id: json.id, status: json.status ?? "PENDING" };
  return {
    ok:      false,
    code:    json.error?.code,
    message: json.error?.message ?? JSON.stringify(json),
    full:    JSON.stringify(json, null, 2),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log("\n🏝️  Dream Island — איפוס תבניות WhatsApp");
  console.log(`   WABA ID    : ${WABA_ID}`);
  console.log(`   תבניות     : ${TEMPLATES.length}`);
  console.log(`   מצב        : ${DRY_RUN ? "DRY RUN בלבד" : CREATE_ONLY ? "יצירה בלבד" : "מחיקה + יצירה"}`);
  console.log("─────────────────────────────────────────────────────\n");

  let passed = 0;
  let failed = 0;

  for (const tpl of TEMPLATES) {
    console.log(`  ${tpl.label}`);
    console.log(`  ${tpl.name}`);

    if (DRY_RUN) {
      const bodyComp = tpl.components.find((c) => c.type === "BODY");
      console.log(`  → ${bodyComp?.text?.slice(0, 80)}...`);
      console.log("");
      passed++;
      continue;
    }

    // Step 1: Delete
    if (!CREATE_ONLY) {
      process.stdout.write("  🗑️  מוחק... ");
      const del = await deleteTemplate(tpl.name);
      if (del.ok) {
        console.log(del.note ? `דולג (${del.note})` : "✓");
      } else {
        console.log(`⚠️  ${del.error}`);
      }
      await sleep(1000);
    }

    // Step 2: Create
    process.stdout.write("  ➕  יוצר...  ");
    const cr = await createTemplate(tpl);
    if (cr.ok) {
      console.log(`✅  id=${cr.id}  status=${cr.status}`);
      passed++;
    } else {
      console.log(`❌  code=${cr.code}  ${cr.message}`);
      console.log(`       ${cr.full}`);
      failed++;
    }

    console.log("");
    await sleep(300);
  }

  console.log("─────────────────────────────────────────────────────");
  console.log(`  ✅ הצליח: ${passed}   ❌ נכשל: ${failed}`);
  console.log("─────────────────────────────────────────────────────\n");

  if (failed > 0) {
    console.log("⚠️  חלק מהתבניות לא נוצרו. בדוק שגיאות למעלה.");
    process.exit(1);
  }
  console.log("🎉  כל התבניות נשלחו לאישור מטא. ממתינים עד 48 שעות.\n");
})();
