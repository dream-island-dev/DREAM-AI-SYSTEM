-- Waiter Service Pulse — anonymous staff survey v3 (11 questions, Armonim).

UPDATE public.bot_config
SET config_value = '{
  "panel_title": "שאלון מלצרים - מסעדת ערמונים",
  "intro_text": "שאלון זה הינו אנונימי לחלוטין!\n\nהמטרה שלנו היא לשפר את סביבת העבודה, התקשורת והחוויה של כולנו במסעדה. נשמח לתשובות הכנות שלך.",
  "submit_label": "📋 שליחת השאלון",
  "thank_you_title": "תודה על המשוב! 🙏",
  "thank_you_body": "התשובות נשלחו באופן אנונימי להנהלה. נשתמש בהן כדי לשפר את סביבת העבודה, התקשורת והחוויה של כולנו במסעדה.",
  "questions": [
    {
      "key": "tenure",
      "type": "single_choice",
      "label": "1. כמה זמן אתה עובד במסעדת ערמונים? (בחירה אחת)",
      "required": true,
      "options": [
        {"id": "less_3_months", "label": "פחות מ-3 חודשים"},
        {"id": "3_6_months", "label": "3–6 חודשים"},
        {"id": "half_to_year", "label": "חצי שנה עד שנה"},
        {"id": "over_year", "label": "מעל שנה"}
      ]
    },
    {
      "key": "manager_presence",
      "type": "single_choice",
      "label": "2. האם אתה מרגיש שהמנהל נוכח במשמרת?",
      "required": true,
      "options": [
        {"id": "yes", "label": "כן"},
        {"id": "no", "label": "לא"}
      ],
      "allow_other": true,
      "other_label": "אחר / פירוט"
    },
    {
      "key": "manager_respect",
      "type": "single_choice",
      "label": "3. האם אתה מרגיש שהמנהלים מתייחסים אליך בכבוד?",
      "required": true,
      "options": [
        {"id": "yes", "label": "כן"},
        {"id": "no", "label": "לא"}
      ],
      "allow_other": true,
      "other_label": "אחר / פירוט"
    },
    {
      "key": "manager_improvements",
      "type": "multi_choice",
      "label": "4. מה לדעתך המנהלים יכולים לעשות טוב יותר? (ניתן לסמן מספר אפשרויות ו/או לפרט בחופשיות)",
      "required": true,
      "options": [
        {"id": "clear_communication", "label": "תקשורת ברורה ופתוחה יותר מול הצוות"},
        {"id": "physical_support", "label": "תמיכה וסיוע פיזי במהלך סרוויס עמוס"},
        {"id": "positive_feedback", "label": "מתן משוב חיובי/בונה בסיום משמרת"},
        {"id": "fair_shifts", "label": "חלוקה צודקת ומאוזנת של משמרות"},
        {"id": "more_training", "label": "הגדלת הדרכות ומקצועיות"}
      ],
      "allow_other": true,
      "other_label": "אחר / פירוט חופשי"
    },
    {
      "key": "team_cooperation",
      "type": "single_choice",
      "label": "5. האם יש שיתוף פעולה בין חברי הצוות?",
      "required": true,
      "options": [
        {"id": "yes", "label": "כן"},
        {"id": "no", "label": "לא"}
      ],
      "allow_other": true,
      "other_label": "אחר / פירוט"
    },
    {
      "key": "tip_agreement_awareness",
      "type": "single_choice",
      "label": "6. האם אתה יודע שקיימת הסכמה בין המלצרים לגבי לקיחת טיפים?",
      "required": true,
      "options": [
        {"id": "yes", "label": "כן"},
        {"id": "no", "label": "לא"}
      ],
      "allow_other": true,
      "other_label": "אחר / פירוט"
    },
    {
      "key": "tips_policy_aware",
      "type": "single_choice",
      "label": "7. חלוקת טיפים במשמרת — א. האם אתה מודע להגדרה זו?",
      "help_text": "כהגדרה, טיפים המתקבלים מהלקוחות בכל שעות המשמרת הם טיפים משותפים לכלל המלצרים.",
      "required": true,
      "options": [
        {"id": "yes", "label": "כן"},
        {"id": "no", "label": "לא"}
      ]
    },
    {
      "key": "tips_policy_change",
      "type": "single_choice",
      "label": "7. חלוקת טיפים במשמרת — ב. האם היית רוצה לשנות את השיטה הנוכחית?",
      "required": true,
      "options": [
        {"id": "no_change", "label": "לא, השיטה טובה בעיניי"}
      ],
      "allow_other": true,
      "other_label": "כן (נמק מה היית משנה)"
    },
    {
      "key": "training_sufficient",
      "type": "single_choice",
      "label": "8. האם אתה מרגיש שקיבלת הכשרה מספקת מהמנהלים?",
      "required": true,
      "options": [
        {"id": "yes", "label": "כן"},
        {"id": "no", "label": "לא"}
      ],
      "allow_other": true,
      "other_label": "פירוט (מה היה חסר בהכשרה?)"
    },
    {
      "key": "service_knowledge_gaps",
      "type": "multi_choice",
      "label": "9. האם אתה מרגיש צורך בחיזוק ידע במתן שירות?",
      "required": true,
      "options": [
        {"id": "confident", "label": "לא, מרגיש שולט בחומר"},
        {"id": "food_menu", "label": "כן – בתפריט האוכל / ספיישלים"},
        {"id": "wine_bar", "label": "כן – בתפריט היין, האלכוהול והקוקטיילים"},
        {"id": "pos_system", "label": "כן – תפעול קופה / מערכת ההזמנות"},
        {"id": "complaints", "label": "כן – התמודדות עם תלונות לקוח וסרוויס מורכב"}
      ],
      "allow_other": true,
      "other_label": "פירוט נוסף"
    },
    {
      "key": "cross_team_difficulty",
      "type": "multi_choice",
      "label": "10. האם אתה מרגיש קושי בעבודה מול המטבח / הבר / המארחות?",
      "required": true,
      "options": [
        {"id": "no_difficulty", "label": "לא, העבודה זורמת מצוין מול כולם"},
        {"id": "kitchen", "label": "כן – קושי מול המטבח"},
        {"id": "bar", "label": "כן – קושי מול הבר"},
        {"id": "hosts", "label": "כן – קושי מול צוות המארחות"}
      ],
      "allow_other": true,
      "other_label": "פירוט (מה מורכב/מה מפריע לך?)"
    },
    {
      "key": "additional_comments",
      "type": "text",
      "label": "11. משהו נוסף שהיית רוצה להוסיף או לשנות? (כתיבה חופשית)",
      "required": false,
      "placeholder": "כתבו כאן בחופשיות…",
      "min_length": 0
    }
  ]
}'::jsonb
WHERE config_key = 'waiter_service_pulse_ui';
