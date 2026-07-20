-- 260: one-time seed of the standard Armonim menu (captured from armmonim.co.il/תפריט/, 2026-07-20).
-- Skips entirely if a standard menu_kind version already exists (draft or published) —
-- never overwrites manual edits made in ניהול תפריט.

DO $$
DECLARE
  v_version_id UUID;
  v_section_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM public.restaurant_menu_versions WHERE menu_kind = 'standard') THEN
    RETURN;
  END IF;

  INSERT INTO public.restaurant_menu_versions (label, status, menu_kind, published_at)
  VALUES ('תפריט ערמונים', 'published', 'standard', now())
  RETURNING id INTO v_version_id;

  -- Section 1: התחלה טובה
  INSERT INTO public.restaurant_menu_sections (version_id, name, sort_order)
  VALUES (v_version_id, 'התחלה טובה', 10)
  RETURNING id INTO v_section_id;

  INSERT INTO public.restaurant_menu_items (section_id, name, description, price, course, sort_order) VALUES
    (v_section_id, 'לחם איטלקי', 'אפוי בתנור אבני שמוט', 28, 'starter', 10),
    (v_section_id, 'סלט ערמונים', 'חסה לאליק, אנדיב, ערמונים, חמוציות, פקאן, תפוח ירוק ורוטב וינגרט נענע', 64, 'starter', 20),
    (v_section_id, 'סלט יווני', 'עגבניות שרי, מלפפון, בצל סגול, גמבה, זיתי קלמטה, גבינה בולגרית טבעונית בסגנון יווני', 62, 'starter', 30),
    (v_section_id, 'סלט תפוחי אדמה קריספי', 'תפוחי אדמה דקים מטוגנים, בצל סגול, גמבה, ירק רענן, אגוזי מלך, ויניגרט רימונים וציפוטלה', 60, 'starter', 40),
    (v_section_id, 'קרפצ''יו פילה בקר ים תיכוני', 'בתיבול מלח ים, זרעי עגבניות בלסמי ובריוש סקורדיליה', 68, 'starter', 50),
    (v_section_id, 'גלילות חציל על הגריל', 'גלילות חציל על שיפוד במילוי בשר טלה קצוץ, על רוטב עגבניות וקרם טחינה', 72, 'starter', 60),
    (v_section_id, 'חציל במיסו', 'חציל שלם מטוגן על טחינה מיסו, צנוברים קלויים וויניגרט רימונים', 64, 'starter', 70),
    (v_section_id, 'קפליטי סלק', 'ראגו פיטריות, סחיטת עגבנייה, שמן ריחן וקראמבל פירורים', 78, 'starter', 80),
    (v_section_id, 'Dream סשימי', 'דג לבן, גספצ''יו ווסאבי, סלטון בישבש ובצל סגול מוחמץ', 82, 'starter', 90),
    (v_section_id, 'Island סביצ''ה', 'קוביות דג לבן, פלפלים צבעוניים, בצל סגול וצנוניות בתיבול שמן צ''ילי', 78, 'starter', 100),
    (v_section_id, 'ברמונדי מטוגן', 'פילה ברמונדי מטוגן על רוטב הדרים מתקתק', 74, 'starter', 110),
    (v_section_id, 'סיגר דגים', 'מיקס דגי ים, צזיקי טחינה, מטבל תוניסאי וסלטון עלים', 68, 'starter', 120);

  -- Section 2: התענוג העיקרי
  INSERT INTO public.restaurant_menu_sections (version_id, name, sort_order)
  VALUES (v_version_id, 'התענוג העיקרי', 20)
  RETURNING id INTO v_section_id;

  INSERT INTO public.restaurant_menu_items (section_id, name, description, price, course, sort_order) VALUES
    (v_section_id, 'המבורגר ערמונים', '220 גרם קציצה, חסה אייסברג, בצל, מלפפון חמוץ, עגבניה, פטריית פורטבלו, איולי חרדל', 86, 'main', 10),
    (v_section_id, 'פרגית על שיפוד', 'מונח על פירה צ''יפוטלה', 88, 'main', 20),
    (v_section_id, 'רביולי ארטישוק', 'ברוטב שמנת כמהין ותרד (טבעוני)', 72, 'main', 30),
    (v_section_id, 'אנטרקוט מיושן', 'נתח מובחר צלוי על הגריל, לצד טוגנים צרפתיים בציר מרלו וניל וקונפי שום — 300 גרם', 199, 'main', 40),
    (v_section_id, 'פילה בקר', 'מדליוני פילה בקר על קרם שורשים וגראטן תפוחי אדמה', 220, 'main', 50),
    (v_section_id, 'סינטה נברסקה', 'נתח 300 גרם, פרוס על ציר דמי גלאס וקוביות דלעת מקורמלות', 179, 'main', 60),
    (v_section_id, 'פילה לברק', 'מוגש על קרם פולנטה ותבשיל פטריות מנגולד', 139, 'main', 70),
    (v_section_id, 'סלמון סקנדינבי', 'ברוטב שמנת (טבעוני) לימונית, טוביקו, ניוקי, ארטישוק א לה רומנה', 139, 'main', 80);

  -- Section 3: קינוחים
  INSERT INTO public.restaurant_menu_sections (version_id, name, sort_order)
  VALUES (v_version_id, 'קינוחים', 30)
  RETURNING id INTO v_section_id;

  INSERT INTO public.restaurant_menu_items (section_id, name, description, price, course, sort_order) VALUES
    (v_section_id, 'רוטנדו', 'שכבה קראנצ''ית של לואקר ונוגט, פחזנית במילוי קרם פטיסייר עטופה בקרם נוטלה וקרמל מלוח, ציפוי נוצ''לו ושקדים קלויים', 52, 'dessert', 10),
    (v_section_id, 'פרופיטרולים', 'פחזניות ממולאות בקרם פטיסייר בזילוף רוטב פיסטוק', 52, 'dessert', 20),
    (v_section_id, 'נמסיס', 'עוגת שוקולד קרה עם טוויל שוקולד קקאו וקצפת נימוחה', 52, 'dessert', 30),
    (v_section_id, 'קרם בורלה', 'שכבת קרמל שרוף מעל קרם עדין וקטיפתי בטעם וניל לצד רוטב מנגו', 52, 'dessert', 40),
    (v_section_id, 'קרמינו', 'משולש קרם שוקולד מריר וקרם ברולה על קראנץ'' שוקולד בייגלה בציפוי נוגט בייגלה קריספי, רוטב קרמל וקראמבל שוקולד', 52, 'dessert', 50),
    (v_section_id, 'מקלות בראוניז', 'דואט שוקולד בוטנים על קרם וניל, רוטב שוקולד וטראפלס חמאת בוטנים', 52, 'dessert', 60);
END $$;
