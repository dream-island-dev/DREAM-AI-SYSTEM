// One-time capture of the Armonim standard menu (armmonim.co.il/תפריט/, 2026-07-20).
// Source of truth lives in restaurant_menu_* tables from here on — this seed only
// bootstraps migration 260. Edit the live menu via ניהול תפריט in the kiosk, not here.

export const ARMONIM_MENU_SEED = {
  label: "תפריט ערמונים",
  sections: [
    {
      name: "התחלה טובה",
      items: [
        { name: "לחם איטלקי", description: "אפוי בתנור אבני שמוט", price: 28, course: "starter" },
        { name: "סלט ערמונים", description: "חסה לאליק, אנדיב, ערמונים, חמוציות, פקאן, תפוח ירוק ורוטב וינגרט נענע", price: 64, course: "starter" },
        { name: "סלט יווני", description: "עגבניות שרי, מלפפון, בצל סגול, גמבה, זיתי קלמטה, גבינה בולגרית טבעונית בסגנון יווני", price: 62, course: "starter" },
        { name: "סלט תפוחי אדמה קריספי", description: "תפוחי אדמה דקים מטוגנים, בצל סגול, גמבה, ירק רענן, אגוזי מלך, ויניגרט רימונים וציפוטלה", price: 60, course: "starter" },
        { name: "קרפצ'יו פילה בקר ים תיכוני", description: "בתיבול מלח ים, זרעי עגבניות בלסמי ובריוש סקורדיליה", price: 68, course: "starter" },
        { name: "גלילות חציל על הגריל", description: "גלילות חציל על שיפוד במילוי בשר טלה קצוץ, על רוטב עגבניות וקרם טחינה", price: 72, course: "starter" },
        { name: "חציל במיסו", description: "חציל שלם מטוגן על טחינה מיסו, צנוברים קלויים וויניגרט רימונים", price: 64, course: "starter" },
        { name: "קפליטי סלק", description: "ראגו פיטריות, סחיטת עגבנייה, שמן ריחן וקראמבל פירורים", price: 78, course: "starter" },
        { name: "Dream סשימי", description: "דג לבן, גספצ'יו ווסאבי, סלטון בישבש ובצל סגול מוחמץ", price: 82, course: "starter" },
        { name: "Island סביצ'ה", description: "קוביות דג לבן, פלפלים צבעוניים, בצל סגול וצנוניות בתיבול שמן צ'ילי", price: 78, course: "starter" },
        { name: "ברמונדי מטוגן", description: "פילה ברמונדי מטוגן על רוטב הדרים מתקתק", price: 74, course: "starter" },
        { name: "סיגר דגים", description: "מיקס דגי ים, צזיקי טחינה, מטבל תוניסאי וסלטון עלים", price: 68, course: "starter" },
      ],
    },
    {
      name: "התענוג העיקרי",
      items: [
        { name: "המבורגר ערמונים", description: "220 גרם קציצה, חסה אייסברג, בצל, מלפפון חמוץ, עגבניה, פטריית פורטבלו, איולי חרדל", price: 86, course: "main" },
        { name: "פרגית על שיפוד", description: "מונח על פירה צ'יפוטלה", price: 88, course: "main" },
        { name: "רביולי ארטישוק", description: "ברוטב שמנת כמהין ותרד (טבעוני)", price: 72, course: "main" },
        { name: "אנטרקוט מיושן", description: "נתח מובחר צלוי על הגריל, לצד טוגנים צרפתיים בציר מרלו וניל וקונפי שום — 300 גרם", price: 199, course: "main" },
        { name: "פילה בקר", description: "מדליוני פילה בקר על קרם שורשים וגראטן תפוחי אדמה", price: 220, course: "main" },
        { name: "סינטה נברסקה", description: "נתח 300 גרם, פרוס על ציר דמי גלאס וקוביות דלעת מקורמלות", price: 179, course: "main" },
        { name: "פילה לברק", description: "מוגש על קרם פולנטה ותבשיל פטריות מנגולד", price: 139, course: "main" },
        { name: "סלמון סקנדינבי", description: "ברוטב שמנת (טבעוני) לימונית, טוביקו, ניוקי, ארטישוק א לה רומנה", price: 139, course: "main" },
      ],
    },
    {
      name: "קינוחים",
      items: [
        { name: "רוטנדו", description: "שכבה קראנצ'ית של לואקר ונוגט, פחזנית במילוי קרם פטיסייר עטופה בקרם נוטלה וקרמל מלוח, ציפוי נוצ'לו ושקדים קלויים", price: 52, course: "dessert" },
        { name: "פרופיטרולים", description: "פחזניות ממולאות בקרם פטיסייר בזילוף רוטב פיסטוק", price: 52, course: "dessert" },
        { name: "נמסיס", description: "עוגת שוקולד קרה עם טוויל שוקולד קקאו וקצפת נימוחה", price: 52, course: "dessert" },
        { name: "קרם בורלה", description: "שכבת קרמל שרוף מעל קרם עדין וקטיפתי בטעם וניל לצד רוטב מנגו", price: 52, course: "dessert" },
        { name: "קרמינו", description: "משולש קרם שוקולד מריר וקרם ברולה על קראנץ' שוקולד בייגלה בציפוי נוגט בייגלה קריספי, רוטב קרמל וקראמבל שוקולד", price: 52, course: "dessert" },
        { name: "מקלות בראוניז", description: "דואט שוקולד בוטנים על קרם וניל, רוטב שוקולד וטראפלס חמאת בוטנים", price: 52, course: "dessert" },
      ],
    },
  ],
};
