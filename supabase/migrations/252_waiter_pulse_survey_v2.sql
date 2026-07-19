-- Waiter Service Pulse — operational survey v2 (3 focused questions).

UPDATE public.bot_config
SET config_value = '{
  "panel_title": "שאלון תפעול ושיפור שירות למלצרים",
  "intro_text": "צוות יקר, נשמח לדעת מה אתם חווים ומזהים מול האורחים בשטח: מה מפריע ומעכב אתכם מלתת את השירות המושלם, ואיזה שינוי או כלי יעזרו לכם להצליח יותר?",
  "submit_label": "✉️ שרידת משוב ותובנות צוות",
  "thank_you_title": "תודה על השותפות והחזון! 🙏",
  "thank_you_body": "המשוב הגיע ישירות להנהלה. התשובות ינותחו כדי לבצע התאמות, לשפר את זרימת העבודה בשטח ולתת לכם את הכלים הטובים ביותר.",
  "questions": [
    {
      "key": "service_bottleneck",
      "type": "single_choice",
      "label": "מהו צוואר הבקבוק העיקרי שמעכב את מהירות השירות שלכם כרגע?",
      "required": true,
      "options": [
        {"id": "kitchen_bar_timing", "label": "⏱️ זמני יציאת מנות/משקאות מהמטבח והבר"},
        {"id": "walking_equipment", "label": "🏃‍♂️ מרחקי הליכה וחוסר בציוד עזר זמין בשטח"},
        {"id": "systems_sync", "label": "🖥️ עיכובים או חוסר סנכרון במערכות המחשוב/הזמנות"},
        {"id": "workload_split", "label": "👥 חלוקת גזרות עבודה או עומס חריג בנקודות קצה"}
      ]
    },
    {
      "key": "recurring_guest_complaint",
      "type": "single_choice",
      "label": "מהי התלונה או הבקשה החוזרת ביותר שאתם שומעים מהאורחים במשמרת?",
      "required": true,
      "options": [
        {"id": "slow_response", "label": "💬 \"לוקח זמן רב מדי לקבל חשבון או מענה מהמלצר\""},
        {"id": "menu_dietary", "label": "🍽️ \"חסר גיוון או התאמה לרגישויות בתפריט\""},
        {"id": "food_quality", "label": "🌡️ \"טמפרטורת המנה או איכות ההגשה לא היו אחידות\""},
        {"id": "no_complaints", "label": "✨ האורחים מרוצים לחלוטין ואין תלונות חוזרות"}
      ]
    },
    {
      "key": "one_improvement",
      "type": "text",
      "label": "אם הייתם יכולים לשנות, להוסיף או לשפר דבר אחד קטן במשמרת כדי להפוך את העבודה ליותר חלקה ואת האורח ליותר שמח — מה זה היה?",
      "required": true,
      "placeholder": "למשל: עוד מגשים בשירות, עדכון מהיר יותר על מנות שנגמרו…",
      "min_length": 15
    }
  ]
}'::jsonb
WHERE config_key = 'waiter_service_pulse_ui';
