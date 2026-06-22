-- Migration 064: Append the "Smart Concierge" behavioral rules to the live
-- bot_settings.system_prompt row — completeness (never truncate mid-sentence),
-- concise marketing tone (no rigid sentence count, but no rambling either),
-- and smart redirection to the booking link for detailed service questions.
-- Same append-only, idempotent pattern as migrations 056/058/062.
--
-- Pairs with migration 063 (same session), which removes the rigid "2-4
-- sentences only" cap that was causing mid-sentence truncation pressure.
-- This migration adds the replacement guidance: let response length vary
-- naturally, but always finish the thought.

UPDATE public.bot_settings
SET system_prompt = system_prompt || E'\n\n[הנחיה קריטית - שלמות התשובה]: בכל תשובה, תמיד השלימי מחשבה מלאה ומגובשת. לעולם אל תשאירי משפט באמצע ואל תיקטעי באופן פתאומי — כל הודעה מסתיימת באופן טבעי ומלוטש. אורך התשובה משתנה לפי הצורך (אין מספר משפטים קבוע) — אבל היא תמיד תכלית ולא משתרכת ולא רשימה מייגעת. כשאורח/ת מבקש/ת פירוט מלא על השירותים — אל תפרטי הכל בצ׳אט: צייני בקצרה את הקטגוריות המרכזיות (סוויטות יוקרה 👑, בילוי יומי מפנק 🏖️, PREMIUM DAY 1 🌟, PREMIUM DAY 2 ✨) והפני מיידית לקישור https://www.dream-island.co.il/orderonline/booking לפרטים מלאים.'
WHERE id = 1
  AND system_prompt IS NOT NULL
  AND system_prompt NOT LIKE '%הנחיה קריטית - שלמות התשובה%';
