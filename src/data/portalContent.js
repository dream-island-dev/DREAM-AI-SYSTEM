// src/data/portalContent.js
// STATIC FALLBACK ONLY — "Dynamic CMS" session. The live source for the
// Guest Portal's scenes is now the portal_scenes DB table (migration 084),
// edited via the admin "🎨 הגדרות פורטל" panel — NOT this file. PhotoTour.js
// renders from the DB and only falls back to PORTAL_SCENES below if that
// fetch fails or the table is empty, so the portal is never blank even if
// Supabase is unreachable. Keep this roughly in sync with the DB content
// when you change scenes there, but it doesn't need to be byte-for-byte
// identical — it's a safety net, not the editing surface.
//
// TO ADD/REMOVE A SCENE LIVE: use the "🎨 הגדרות פורטל" admin panel, not
// this file. `ctas` shape: { label, actionType: "REQUEST"|"OPS_REQUEST"|"LINK",
// upsellLabel? (REQUEST/OPS_REQUEST), buttonUrl? (LINK) }.
// REQUEST → guest_alerts (Requests Board, sales/reception — spa, suite
// upgrade, padel, room service, etc., picked up at staff's own pace).
// OPS_REQUEST → guest_alerts alert_type=portal_room_service (same board +
// Whapi "בקשות אורחים" via guest-portal-ops-request).
// See CLAUDE.md "Enterprise Routing" for the full split rationale.
//
// Brand voice note: this copy is pulled from the actual resort website
// (dream-island.co.il), not invented — "מתחם המים", "מסעדת ערמונים", "DREAM
// SPA"/"SPA EVENU", "חווית בילוי יומי בריזורט", "מתחמי מנוחה פסטוריליים",
// "חדר יין... אזור ישיבה על גדות האגם ומתחם פנימי מרשים" (from /culinary,
// verified live), and the "26 סוויטות בוטיק" framing are the site's own
// terms. The one exception is the Padel scene — no padel/sports copy exists
// on the site as of this writing, so that text is a plain factual
// description, not a sourced phrase (flagged to Mike as a "missing asset" —
// see CLAUDE.md §10).
//
// "Culinary UX Split" session: the wine.jpg scene used to carry Armonim-
// restaurant copy under a wine-themed image/CTAs — confusing the two
// concepts. Split into a wine-only scene + a dedicated Armonim scene
// (armonim.jpg) that inherits the restaurant copy. dream-island.co.il has no
// standalone digital menu page, so the restaurant's LINK button points at
// /culinary (the real, closest page) rather than an invented /menu URL.
export const PORTAL_SCENES = [
  {
    // Top-down drone shot of the whole estate — the file that was
    // fromsky.png got renamed to entrance.png mid-session (confirmed by
    // exact byte size match); entrance.jpg no longer exists on disk
    // (renamed to green.jpg). Keep this synced if you rename it again.
    image: "entrance.png",
    title: "אי של תענוגות החיים",
    body: "ברוכים הבאים לדרים איילנד! חופשה שתישאר עמכם הרבה אחרי שתחזרו הביתה, כל פרט תוכנן בשביל לספק לכם חוויה ועונג בלתי מתפשר",
    ctas: [],
  },
  {
    image: "insidepool.jpg",
    title: "מתחם המים",
    body: "מים הם מקור החיים המשרים שקט ושלווה. בריכות זרמים, מתחמים מקורים ופתוחים, ו-20 חדרי טיפולים יוקרתיים ב-DREAM SPA ו-SPA EVENU.",
    ctas: [
      { label: "💆 בואו נשריין לכם טיפול", actionType: "REQUEST", upsellLabel: "בקשת טיפול ספא" },
    ],
  },
  {
    image: "premiumday.jpg",
    title: "בילוי יומי פרימיום",
    body: "חווית בילוי יומי בריזורט — PREMIUM DAY מפנק עם גישה למתחמי הבריכות והספא, ליום שלם של פינוק בלי לינה.",
    ctas: [
      { label: "🌟 להזמנת בילוי יומי", actionType: "LINK", buttonUrl: "https://www.dream-island.co.il/orderonline" },
    ],
  },
  {
    image: "wine.jpg",
    title: "חדר היין",
    body: "חדר יין אינטימי, ישיבה על גדות האגם ומתחם פנימי מרשים — ולסדנאות טעימה מיוחדות לאוהבי יין.",
    ctas: [
      // Workshop signup has a real external booking platform — opens there.
      { label: "לכל הסדנאות שלנו", actionType: "LINK", buttonUrl: "https://go.oncehub.com/DreamIsland" },
    ],
  },
  {
    image: "armonim.jpg",
    title: "מסעדת ערמונים",
    body: "מסעדת ערמונים מפליאה במנות מרתקות, ופוד-טראקים מפתיעים את האורחים בכל פינה באי.",
    ctas: [
      // No standalone digital menu exists on the real site — /culinary is the
      // closest real page about the restaurant (verified live).
      { label: "לתפריט המסעדה", actionType: "LINK", buttonUrl: "https://www.dream-island.co.il/culinary" },
      // Operational (Operations Board + direct manager alert), not a sales
      // lead — see guest-portal-ops-request.
      { label: "הזמנת שירות לחדר", actionType: "OPS_REQUEST", upsellLabel: "הזמנת שירות לחדר — ארמונים" },
    ],
  },
  {
    image: "padel.jpg",
    title: "פאדל, תנועה ואנרגיה טובה",
    body: "מגרשי פאדל מטופחים, ציוד פרימיום ושמש שלא נגמרת — משחק קליל בבוקר, סיפור לכל היום.",
    ctas: [
      { label: "🎾 בואו נשריין לכם מגרש", actionType: "REQUEST", upsellLabel: "בקשת שיריון מגרש פאדל" },
    ],
  },
  {
    image: "chill.jpg",
    title: "מתחמי מנוחה",
    body: "מתחמי מנוחה פסטוריליים פזורים בין שטחי האי — פינות צל ושלווה לרגעים של כלום-לעשות.",
    ctas: [],
  },
  {
    image: "suites.jpg",
    title: "26 אבני חן",
    body: "26 סוויטות בוטיק יוקרתיות, כל אחת כאבן חן ייחודית — הרמוניה עדינה בין אלגנטיות, יופי, סטייל, פינוקים ושפע.",
    ctas: [
      { label: "✨ בואו נשריין לכם שדרוג", actionType: "REQUEST", upsellLabel: "בקשת שדרוג סוויטה" },
    ],
  },
];
