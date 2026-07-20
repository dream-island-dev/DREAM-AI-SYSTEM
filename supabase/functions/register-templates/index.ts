// supabase/functions/register-templates/index.ts
// Registers all Dream Island WhatsApp templates with Meta Graph API.
// Reads META_WHATSAPP_TOKEN + META_BUSINESS_ACCOUNT_ID from Supabase Secrets.
// Invoke: supabase functions invoke register-templates --no-verify-jwt

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface QuickReplyButton { type: "QUICK_REPLY"; text: string; }
interface UrlButton        { type: "URL"; text: string; url: string; example?: string[]; }
type Button = QuickReplyButton | UrlButton;
interface BodyComponent    { type: "BODY"; text: string; example?: { body_text: string[][] }; }
interface ButtonsComponent { type: "BUTTONS"; buttons: Button[]; }
type Component = BodyComponent | ButtonsComponent;
interface Template { name: string; category: string; language: string; components: Component[]; }

const TEMPLATES: Template[] = [

  // ── Stage 1: Discovery ────────────────────────────────────────────────────
  {
    name: "dream_availability_offer", category: "MARKETING", language: "he",
    components: [{ type: "BODY",
      text: "שלום {{1}}, תודה שפנית לדרים איילנד! התאריך שעניין אתכם פנוי ואנחנו שמחים לשמור מקום. לפרטים על החבילות ולהשלמת ההזמנה: {{2}} — מחכים לכם",
      example: { body_text: [["ישראל ישראלי", "https://dream-island.co.il"]] } }],
  },
  {
    name: "dream_followup_no_response", category: "MARKETING", language: "he",
    components: [{ type: "BODY",
      text: "שלום {{1}}, דרים איילנד בודקת מה שלומכם — פנינו אליכם לפני כמה ימים ולא שמענו. ה-60 דונם שלנו עדיין מחכים לכם. נשמח לענות על כל שאלה ולמצוא את החבילה המושלמת",
      example: { body_text: [["ישראל ישראלי"]] } }],
  },

  // ── Stage 2: Consideration ────────────────────────────────────────────────
  {
    name: "dream_last_minute", category: "MARKETING", language: "he",
    components: [{ type: "BODY",
      text: "שלום {{1}}, יש לנו בשורה — ל-{{2}} נפתחו מקומות אחרונים בדרים איילנד! הצעה מיוחדת לתאריך הזה, תוקף עד {{3}}. לפרטים ולשריון מיידי: {{4}} — אל תפספסו",
      example: { body_text: [["ישראל ישראלי", "5 ביולי", "יום שישי 18:00", "https://dream-island.co.il"]] } }],
  },
  {
    name: "dream_seasonal_offer", category: "MARKETING", language: "he",
    components: [{ type: "BODY",
      text: "שלום {{1}}, לכבוד {{2}} יש לנו הפתעה מדרים איילנד — הצעה בלעדית שנוצרה במיוחד עבורכם. כמות מוגבלת, לזמן קצוב. לפרטים ולהזמנה: {{3}} — מחכים לכם",
      example: { body_text: [["ישראל ישראלי", "קיץ 2026", "https://dream-island.co.il"]] } }],
  },
  {
    name: "dream_spa_package", category: "MARKETING", language: "he",
    components: [{ type: "BODY",
      text: "היי {{1}} 💆\nלקראת הגעתכם למתחם, נשמח להציע לכם עיסוי מרגיע של 45 דק׳ להזמנה שלכם ב-300 ₪ לאדם בלבד (מחיר מלא 370 ₪).\nהשיבו לנו כאן וניצור עימכם קשר לצורך תיאום 🙏",
      example: { body_text: [["ישראל ישראלי"]] } }],
  },
  {
    name: "dream_special_occasion", category: "MARKETING", language: "he",
    components: [{ type: "BODY",
      text: "שלום {{1}}, שמענו שיש לכם סיבה לחגוג! דרים איילנד היא המקום המושלם — סוויטות עם בריכה פרטית, ספא ומסעדת ערמונים. נכין עבורכם חוויה שלא תשכחו. לפרטים ולתיאום: {{2}} — שיהיה מזל טוב",
      example: { body_text: [["ישראל ישראלי", "https://dream-island.co.il/events"]] } }],
  },
  {
    name: "dream_suite_upsell", category: "MARKETING", language: "he",
    components: [{ type: "BODY",
      text: "שלום {{1}}, יש לנו הצעה שלא תוכלו לסרב — הסוויטות שלנו הן עולם אחר לגמרי. רובי עם בריכה פרטית, אקוומרין עם גינה, אמטיסט עם נוף פנורמי. כולן עם ג'קוזי פרטי וגישה לטרקלין VIP Symphony. לפרטים: {{2}} — מחכים לכם",
      example: { body_text: [["ישראל ישראלי", "https://dream-island.co.il/suites"]] } }],
  },
  {
    name: "dream_wine_experience", category: "MARKETING", language: "he",
    components: [{ type: "BODY",
      text: "שלום {{1}}, דרים איילנד מזמינה אתכם לחוויית יין ייחודית — יינות ישראליים מובחרים, אווירה קסומה, לצד בריכות, ספא ומסעדת ארמונים. ערב שלא תשכחו. לפרטים ולהזמנה: {{2}} — לחיים",
      example: { body_text: [["ישראל ישראלי", "https://dream-island.co.il/wine"]] } }],
  },

  // ── Stage 3: Pre-arrival (UTILITY) ───────────────────────────────────────
  {
    name: "dream_arrival_confirmation", category: "UTILITY", language: "he",
    components: [
      { type: "BODY",
        text: "היי {{1}}! כבר ממש סופרים את הימים... 🥳\nרק רצינו לוודא שהכל כרגיל לקראת השהות שלכם אצלנו בריזורט בעוד יומיים. נשמח אם תאשרו לנו את הגעתכם כאן למטה:",
        example: { body_text: [["ישראל ישראלי"]] } },
      { type: "BUTTONS", buttons: [
        { type: "QUICK_REPLY", text: "כן, מגיעים!" },
        { type: "QUICK_REPLY", text: "לא, שינוי בתאריך" },
      ]},
    ],
  },
  {
    name: "dream_payment_and_workshops", category: "UTILITY", language: "he",
    components: [
      { type: "BODY",
        text: "היי {{1}}! איזה כיף, אנחנו כבר מחכים לכם! 🥰\nכדי שהצ'ק-אין שלכם בריזורט יהיה מהיר, חלק וללא המתנה מיותרת בדלפק הקבלה, נשמח אם תסדירו את יתרת השהות על סך {{2}} ₪ בקישור המאובטח שלכם.\n\nבנוסף, מקומות היין והסדנאות הייחודיות שלנו בריזורט כבר כמעט מלאים! שווה לשריין מקום מראש בקישור המצורף. נתראה ממש בקרוב! 🥂",
        example: { body_text: [["ישראל ישראלי", "1200"]] } },
      { type: "BUTTONS", buttons: [
        { type: "URL", text: "תשלום מהיר", url: "https://pay.dream-island.co.il/r/{{1}}", example: ["session_abc123"] },
        { type: "URL", text: "שריון סדנאות", url: "https://go.oncehub.com/DreamIsland" },
      ]},
    ],
  },
  {
    // ⚠️ REWRITTEN, NOT YET RESUBMITTED — "STAGE 2.5 UPDATE, SABBATH LOGIC"
    // session. Was still PENDING with completely different (older) content
    // when this changed (1 var = name, URL button to workshops) — this is
    // the new exact wording from the directive, {{1}}=entry_time/{{2}}=
    // check_in_time (Sabbath/Holiday-aware values, computed in whatsapp-send's
    // resolveNightBeforeTimes()). Still MISSING the required image header
    // (image_3cde8f.jpg isn't in the repo yet, and Meta header images need a
    // separate resumable-upload call this codebase doesn't have yet either)
    // — do NOT invoke register-templates for this entry until both exist,
    // or Meta will approve a text-only version that then needs a second
    // resubmission to add the image later.
    name: "dream_checkin_reminder_v2", category: "UTILITY", language: "he",
    components: [{ type: "BODY",
      text: "היי מה שלומכם?🌸\nמצפים להגעה שלכם לדרים איילנד.\nמעדכנים שהכניסה למתחם תיהיה דרך הכניסה של dream suites🙏\nתגיעו לשער ותצלצלו בפעמון יפתחו לכם.\nממליצים להגיע מוכנים עם בגדי ים וכפכפים.\nכניסה למתחם החל מהשעה - {{1}}\nוקבלת החדרים החל משעה - {{2}}\nמחכים לכם\nצוות דרים איילנד🌸",
      example: { body_text: [["12:00", "15:00"]] } }],
  },

  // ── Stage 4: On-property (UTILITY) ───────────────────────────────────────
  {
    name: "suite_welcome_morning", category: "UTILITY", language: "he",
    components: [{ type: "BODY",
      text: "בוקר אור {{1}}! ✨ היום זה היום!\nהריזורט מוכן, השמש בחוץ, וכל הצוות שלנו כבר מחכה להעניק לכם חוויה בלתי נשכחת.\n\nכמה פרטים קטנים וחשובים לדרך:\n🌸 מתקני הריזורט, הבריכות והמתחמים פתוחים עבורכם כבר מהשעה 09:00 בבוקר.\n🔑 קבלת החדרים והסוויטות היא החל מהשעה 15:00.\n\nאם יש לכם שאלה כלשהי בדרך, אנחנו זמינים כאן בצ'אט. נסיעה טובה ובטוחה! 🚗❤️",
      example: { body_text: [["ישראל ישראלי"]] } }],
  },
  {
    name: "suite_welcome_morning_shabbat", category: "UTILITY", language: "he",
    components: [{ type: "BODY",
      text: "בוקר אור {{1}}! ✨ היום זה היום!\nהריזורט מוכן, השמש בחוץ, וכל הצוות שלנו כבר מחכה להעניק לכם חוויה בלתי נשכחת.\n\nכמה פרטים קטנים וחשובים לדרך:\n🌸 כניסה למתחם החל מהשעה 12:00.\n🔑 קבלת החדרים והסוויטות היא החל מהשעה 18:00.\n\nאם יש לכם שאלה כלשהי בדרך, אנחנו זמינים כאן בצ'אט. נסיעה טובה ובטוחה! 🚗❤️",
      example: { body_text: [["ישראל ישראלי"]] } }],
  },
  {
    name: "dream_mid_stay_check", category: "UTILITY", language: "he",
    components: [
      { type: "BODY",
        text: "היי {{1}}, הזמן עף כשנהנים... 🤍\nרק רצינו לעצור לרגע ולוודא שאתם נרגעים, נהנים ומנצלים את כל הטוב שיש לדרים איילנד להציע.\n\nאם חסר לכם משהו בסוויטה, או אם יש כל דבר שנוכל לעשות כדי להפוך את השהות שלכם לעוד יותר מושלמת — פשוט תכתבו לנו כאן תגובה חופשית, או לחצו על הכפתור למטה ונציג יצור איתכם קשר מיד. תמשיכו ליהנות! ✨",
        example: { body_text: [["ישראל ישראלי"]] } },
      { type: "BUTTONS", buttons: [
        { type: "QUICK_REPLY", text: "ספא וטיפולים" },
        { type: "QUICK_REPLY", text: "דברו איתי" },
      ]},
    ],
  },
  {
    name: "dream_workshop_reminder", category: "UTILITY", language: "he",
    components: [{ type: "BODY",
      text: "תזכורת מדרים איילנד, {{1}}! אתם רשומים לסדנת {{2}}. מיקום: {{3}} שעה: {{4}} — מצפים לכם",
      example: { body_text: [["ישראל ישראלי", "בישול ים-תיכוני", "מסעדת ערמונים", "11:00"]] } }],
 
  },
  {
    // Session 29 — dedicated Room-Ready template (Sprint 5.1.3). Previously
    // the manual "room ready" approval reused dream_welcome_morning, which
    // is also the scheduled morning-of-arrival template — a guest could get
    // the literal same wording twice from two unrelated triggers. This gives
    // the manual key-handover moment its own isolated copy.
    name: "dream_room_ready", category: "UTILITY", language: "he",
    components: [{ type: "BODY",
      text: "🔑 {{1}}, יש לנו בשורה — הסוויטה {{2}} שלך מוכנה ומחכה לך! אפשר לגשת לדלפק הקבלה לקבלת המפתח ולהתחיל את החוויה. מצפים לראותכם 🌴",
      example: { body_text: [["ישראל ישראלי", "רובי 3"]] } }],
  },
  {
    // ⚠️ No longer dispatched by any automated stage (Stage 3.5 purged session
    // 29) — retained here only as the historical Meta registration record.
    // Removing this entry would not "unregister" the template from Meta; it
    // can still be sent manually (e.g. WhatsAppInbox broadcast picker).
    name: "dream_handover_agent_v2", category: "UTILITY", language: "he",
    components: [{ type: "BODY",
      text: "תודה על פנייתך, {{1}}. העברנו את בקשתך לאחד מהצוות שיחזור אליך בהקדם. דרים איילנד — תמיד לשירותך",
      example: { body_text: [["ישראל ישראלי"]] } }],
  },

  // ── Stage 5: Post-visit ───────────────────────────────────────────────────
  {
    name: "dream_checkout_feedback", category: "UTILITY", language: "he",
    components: [
      { type: "BODY",
        text: "היי {{1}}, השערים של הריזורט נסגרו מאחוריכם, ורצינו להגיד תודה ענקית שהתארחתם אצלנו. 🙏 החיוך והחוויה שלכם הם הכל עבורנו.\nנשמח מאוד לשמוע בכנות — איך היתה השהות שלכם אצלנו?",
        example: { body_text: [["ישראל ישראלי"]] } },
      { type: "BUTTONS", buttons: [
        { type: "QUICK_REPLY", text: "היה מושלם!" },
        { type: "QUICK_REPLY", text: "יש מקום לשיפור" },
      ]},
    ],
  },

  // Day-pass evening cold-start — Quick Reply opens Meta 24h window (Option C).
  {
    name: "dream_daypass_eve", category: "UTILITY", language: "he",
    components: [
      { type: "BODY",
        text: "היי {{1}}, מחר מחכה לכם יום מדהים בדרים איילנד! ☀️\n\nכל הצוות כבר מתארגן לקראתכם.\nרק לוודא שאתם איתנו — לחצו על הכפתור ונשמח לקבל אישור 🤍",
        example: { body_text: [["ישראל ישראלי"]] } },
      { type: "BUTTONS", buttons: [
        { type: "QUICK_REPLY", text: "מחכים לכם!" },
      ]},
    ],
  },

  // Day-pass spa warm-up — Meta/Dream Bot backup when Whapi fails or window closed.
  {
    name: "dream_spa_warmup", category: "UTILITY", language: "he",
    components: [
      { type: "BODY",
        text: "היי {{1}}, עוד קצת ומתחיל הטיפול המפנק שלכם בספא 🧘‍♀️✨\nזה הזמן להירגע, לנשום עמוק ולהתחיל לעבור למצב פינוק. ניפגש בקרוב!",
        example: { body_text: [["ישראל ישראלי"]] } },
    ],
  },

  // Day-pass spa upsell — manual DataSync dispatch (Dream Bot path; Whapi = bot_scripts).
  {
    name: "spa_upsell_daypass", category: "MARKETING", language: "he",
    components: [{ type: "BODY",
      text: "היי 💆\nלקראת הגעתכם לריזורט , נשמח להציע לכם טיפול ספא מרגיע של 45 דק׳ להזמנה שלכם במחיר מיוחד. עבורכם -300 ₪ לאדם בלבד (מחיר מלא 370 ₪).\nהשיבו לנו כאן וניצור עימכם קשר לצורך תיאום 🙏",
      example: { body_text: [[]] } }],
  },

  // Day-pass + spa survey invite (Mike lock 2026-07-13). Body exact — no
  // space after היי; send-time {{1}} is " FirstName". URL button → portal/#survey.
  {
    name: "dream_survey_invite", category: "UTILITY", language: "he",
    components: [
      { type: "BODY",
        text: "היי{{1}}, תודה שביליתם איתנו היום! 🌴\n\nנשמח שתדרגו את החוויה שלכם במתחם 🙏🏽",
        example: { body_text: [[" ישראל ישראלי"]] } },
      { type: "BUTTONS", buttons: [
        {
          type: "URL",
          text: "למילוי הסקר",
          url: "https://dream-ai-system.vercel.app/portal/{{1}}",
          example: ["00000000-0000-0000-0000-000000000001#survey"],
        },
      ]},
    ],
  },

  // Whapi outage / SOS — opens Meta 24h window for in-resort service (Option B, 2026-07-14).
  {
    name: "dream_service_fallback", category: "UTILITY", language: "he",
    components: [
      { type: "BODY",
        text: "היי {{1}}, אנחנו זמינים לכם בצ'אט לכל מה שצריך במהלך השהות בדרים איילנד 🌴\n\nבקשות חדר, מגבות, ניקיון, שאלות על המתחם — פשוט כתבו לנו כאן.\n\nלחצו «יש לי בקשה» או כתבו הודעה חופשית.",
        example: { body_text: [["ישראל ישראלי"]] } },
      { type: "BUTTONS", buttons: [
        { type: "QUICK_REPLY", text: "יש לי בקשה" },
        { type: "QUICK_REPLY", text: "הכל בסדר, תודה" },
      ]},
    ],
  },

];

interface TemplateResult { name: string; ok: boolean; status?: string; id?: string; error?: string; }

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const token  = Deno.env.get("META_WHATSAPP_TOKEN") ?? Deno.env.get("WHATSAPP_TOKEN");
  const wabaId = Deno.env.get("META_BUSINESS_ACCOUNT_ID");

  if (!token)  return new Response(JSON.stringify({ ok: false, error: "missing META_WHATSAPP_TOKEN" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
  if (!wabaId) return new Response(JSON.stringify({ ok: false, error: "missing META_BUSINESS_ACCOUNT_ID" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });

  const base = `https://graph.facebook.com/v20.0/${wabaId}/message_templates`;
  const results: TemplateResult[] = [];

  for (const tpl of TEMPLATES) {
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: tpl.name, language: tpl.language, category: tpl.category, components: tpl.components }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json() as Record<string, unknown>;
      if (res.ok && data.id) {
        results.push({ name: tpl.name, ok: true, id: String(data.id), status: String(data.status ?? "PENDING") });
      } else {
        const errObj = data?.error as Record<string, unknown> | undefined;
        const msg = String(errObj?.error_user_msg ?? errObj?.message ?? JSON.stringify(data));
        if ((errObj?.code === 100) && msg.toLowerCase().includes("already")) {
          results.push({ name: tpl.name, ok: true, status: "ALREADY_EXISTS" });
        } else {
          results.push({ name: tpl.name, ok: false, error: msg });
        }
      }
    } catch (e) {
      results.push({ name: tpl.name, ok: false, error: (e as Error).message });
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  return new Response(
    JSON.stringify({ ok: failed === 0, total: TEMPLATES.length, passed, failed, results }, null, 2),
    { headers: { ...CORS, "Content-Type": "application/json" } }
  );
});
