# Dream Island — Voice AI Concierge
## תוכנית מדויקת: בוט קולי לשיחות נכנסות מסוויטות

> **עדכון:** 2026-06-23  
> **מטרה:** אורח בסוויטה מחייג לקבלה → בוט AI עונה בקול נעים בעברית → תופס את הבקשה → מעביר לצוות בזמן אמת → סנכרון מלא עם מערכת Dream AI הקיימת

---

## 1. ארכיטקטורה כללית

```
אורח מחייג למספר הריזורט (VoIP)
        ↓
   Twilio Voice API
        ↓
  [voice-concierge] ← Supabase Edge Function חדש
        ↓                    ↓
  זיהוי אורח           Google STT (עברית)
  (guests.phone)              ↓
        ↓               LLM (Gemini 2.5 Flash)
  הקשר אישי:                 ↓
  שם / חדר / ספא       ElevenLabs TTS
        ↓               (קול נעים עברי)
  guest_alerts ←────────────↓
  (קיים!)           תשובה קולית לאורח
        ↓
  RequestsAlertWidget (קיים!)
        ↓
  RequestsBoard (קיים!)
        ↓
  WhatsApp לאורח (summary, אופציונלי)
```

**עיקרון מנחה:** כל תשתית "הצגת הבקשה לצוות" כבר בנויה — `guest_alerts`, `RequestsBoard.js`, `RequestsAlertWidget.js`. אנחנו בונים רק את "הכניסה הקולית" החדשה.

---

## 2. טכנולוגיות נבחרות

| שכבה | טכנולוגיה | סיבה |
|---|---|---|
| **VoIP / מספר טלפון** | Twilio Voice | API עשיר, webhook לכל אירוע שיחה, Hebrew-friendly, מספר ישראלי +972 |
| **Speech-to-Text** | Google Cloud Speech-to-Text v2 | עברית מדוברת — הטובה ביותר בשוק, latency נמוך, תמיכה בניב ישראלי |
| **LLM** | Gemini 2.5 Flash | כבר בשימוש במערכת, `GEMINI_API_KEY` קיים, זול ומהיר |
| **Text-to-Speech** | ElevenLabs | הקול העברי הנעים ביותר הקיים. Model: "eleven_multilingual_v2". Voice: נבחר יחד עם Mike |
| **Orchestration** | Supabase Edge Function (Deno) | עקביות עם כל שאר הפונקציות במערכת |
| **Real-time לצוות** | Supabase Realtime (קיים) | RequestsAlertWidget כבר מאזין — לא צריך לבנות כלום |

### ניהול עלויות (הערכה חודשית)
| שירות | עלות משוערת |
|---|---|
| Twilio (מספר + דקות) | ~$30–60/חודש (תלוי בנפח) |
| Google STT | ~$0.016/דקה → ~$16 ל-1,000 דקות |
| ElevenLabs | Starter plan $22/חודש (30K תווים) |
| Gemini 2.5 Flash | כמעט חינם בנפח הזה |
| **סה"כ** | **~$70–100/חודש** |

---

## 3. פירוט החוויה — מה האורח שומע

```
📞 [אורח מחייג]

🤖 "שלום! הגעת ל-Dream Island.
    [אם זוהה] "ברוך הבא [שם], אנחנו כל כך שמחים שאתה כאן!
               מה תרצה היום?"
    [אם לא זוהה] "אני Dream, הקונסיירז' הדיגיטלי שלכם.
                  איך אוכל לעזור?"

👤 "אני צריך בקבוק יין אדום לחדר"

🤖 "כמה נחמד! 🍷 אדאג שבקבוק יין אדום יישלח לחדר שלך —
    [שם] בחדר [X] — תוך כ-15 דקות.
    יש עוד משהו שתרצה?"

👤 "לא, תודה"

🤖 "מושלם! אם תצטרך משהו נוסף — אנחנו כאן.
    יום מקסים!" 🌟

[מיד] → guest_alert נכתב לDB → RequestsAlertWidget מצלצל בממשק הצוות
```

---

## 4. מה צריך לבנות — פירוט מלא

### 4.1 Supabase Secrets חדשים (חד-פעמי)
```
TWILIO_ACCOUNT_SID      ← מ-Twilio Console
TWILIO_AUTH_TOKEN       ← מ-Twilio Console
TWILIO_PHONE_NUMBER     ← +972XXXXXXXXX
ELEVENLABS_API_KEY      ← מ-ElevenLabs Dashboard
ELEVENLABS_VOICE_ID     ← ID הקול שנבחר
GOOGLE_STT_API_KEY      ← מ-Google Cloud Console
```

### 4.2 Migrations חדשות

#### migration 069 — voice_calls table
```sql
CREATE TABLE voice_calls (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at      TIMESTAMPTZ DEFAULT now(),
  call_sid        TEXT UNIQUE NOT NULL,        -- Twilio Call SID
  from_phone      TEXT NOT NULL,               -- מספר המחייג
  guest_id        UUID REFERENCES guests(id),  -- null אם לא זוהה
  duration_sec    INT,
  status          TEXT DEFAULT 'in_progress'   -- in_progress/completed/abandoned
                  CHECK (status IN ('in_progress','completed','abandoned','failed')),
  transcript      TEXT,                        -- תמלול מלא
  request_summary TEXT,                        -- סיכום הבקשה מה-LLM
  alert_id        UUID REFERENCES guest_alerts(id), -- הבקשה שנוצרה
  resolved        BOOL DEFAULT false,
  recording_url   TEXT                         -- Twilio recording (אופציונלי)
);

ALTER TABLE voice_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth users can read" ON voice_calls
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "service role full" ON voice_calls
  FOR ALL USING (auth.role() = 'service_role');
  
-- Realtime (כדי שה-UI יראה שיחות חיות)
ALTER PUBLICATION supabase_realtime ADD TABLE voice_calls;
```

#### migration 070 — voice_call_turns table (תורות שיחה)
```sql
CREATE TABLE voice_call_turns (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  call_id    UUID REFERENCES voice_calls(id) ON DELETE CASCADE,
  speaker    TEXT CHECK (speaker IN ('bot','guest')),
  text       TEXT NOT NULL,
  audio_url  TEXT   -- אופציונלי
);
```

#### migration 071 — guest_alerts voice fields
```sql
-- הרחבת guest_alerts עם source channel
ALTER TABLE guest_alerts 
  ADD COLUMN IF NOT EXISTS source_channel TEXT DEFAULT 'whatsapp'
  CHECK (source_channel IN ('whatsapp','voice','manual','staff'));

ALTER TABLE guest_alerts 
  ADD COLUMN IF NOT EXISTS voice_call_id UUID REFERENCES voice_calls(id);
```

### 4.3 Edge Function: `voice-concierge`

```typescript
// supabase/functions/voice-concierge/index.ts

// ── שלב 1: Twilio מחייג → TwiML response ──────────────
// POST /voice-concierge/inbound
// מחזיר TwiML שמבצע <Gather> לאיסוף קלט קולי

// ── שלב 2: עיבוד הקלט ──────────────────────────────
// POST /voice-concierge/process  
// מקבל: CallSid, SpeechResult (מ-Twilio speech recognition)
// מחזיר: TwiML עם <Say> (תשובה) + <Gather> לתור הבא

// ── שלב 3: סיום שיחה ────────────────────────────────
// POST /voice-concierge/complete
// מקבל: CallSid, CallDuration, RecordingUrl
// מעדכן voice_calls + כותב guest_alert סופי
```

**פירוט הלוגיקה בתוך `/process`:**
```
1. זיהוי אורח: from_phone → guests table (phone variants כמו ב-webhook)
2. שליחת transcript ל-Gemini:
   - system prompt: "אתה קונסיירז' בדרים איילנד. זהה את סוג הבקשה 
     ומה בדיוק מבקשים. החזר JSON: {intent, item, category, reply}"
   - categories: room_service | spa | maintenance | info | escalate
3. בניית תשובה ל-ElevenLabs → אודיו URL
4. כתיבת voice_call_turns (speaker:'guest' + speaker:'bot')
5. אם intent !== "info" → כתיבה ל-guest_alerts
6. החזרת TwiML עם <Play> (אודיו ElevenLabs) + <Gather> לתור הבא
```

**Intent Categories:**
| Category | דוגמאות | פעולה |
|---|---|---|
| `room_service` | יין, אוכל, שמפניה, פרחים, מגבות | guest_alert category:"request" |
| `spa` | שינוי שעת ספא, שאלה על טיפול | guest_alert category:"request" + tag:"spa" |
| `maintenance` | מזגן, תקלה, החלפת נורה | guest_alert category:"request" + tag:"maintenance" + priority:high |
| `info` | שעות פעילות, מסעדה, WiFi | תשובה מה-bot_config בלבד, ללא alert |
| `escalate` | תלונה, בעיה רצינית | guest_alert + needs_callback=true + push notification urgent |
| `unknown` | לא הובן | מבקש שוב בנימוס |

### 4.4 TwiML Flow מפורט

```xml
<!-- שלב ראשון: ברכה -->
<Response>
  <Play>[ElevenLabs audio URL — ברכה אישית]</Play>
  <Gather input="speech" action="/voice-concierge/process" 
          language="he-IL" speechTimeout="3" timeout="10">
  </Gather>
  <!-- timeout fallback: -->
  <Say language="he-IL">לא שמעתי. התקשר שוב כשתוכל!</Say>
  <Hangup/>
</Response>

<!-- כל תור לאחר מכן: -->
<Response>
  <Play>[ElevenLabs audio URL — תשובה]</Play>
  <Gather input="speech" action="/voice-concierge/process"
          language="he-IL" speechTimeout="3" timeout="8">
  </Gather>
  <Play>[ElevenLabs audio — "לא שמעתי, נסה שוב"]</Play>
  <Gather ...><!-- ניסיון שני --></Gather>
  <Hangup/>
</Response>
```

**שימו לב:** Twilio תומך ב-`input="speech"` עם `language="he-IL"` ישירות — **לא צריך Google STT בנפרד** אם משתמשים ב-Twilio Gather + Deepgram addon. זה מפשט את הארכיטקטורה ומוריד עלות.

### 4.5 קובץ Frontend חדש: `VoiceCallsPanel.js`

```
src/components/VoiceCallsPanel.js
```

**מה הוא מציג:**
- רשימת שיחות היום (voice_calls, ממוין DESC)
- Badge "🔴 חי" לשיחה פעילה (status='in_progress')  
- לכל שיחה: שם אורח + חדר + תמצית הבקשה + משך + סטטוס טיפול
- לחיצה → הרחבה עם תמלול מלא
- כפתור "✓ טופל" → resolved=true + אפשרות הוספת הערה

**Route:** `"voice_calls"` (App.js switch)  
**Sidebar:** 📞 שיחות קוליות (manager+)

### 4.6 שינויים ב-`RequestsAlertWidget.js`

הוסף אייקון 📞 לשיחות קוליות:
```javascript
// כרגע: 🔔📋
// אחרי: מספר badge נפרד לשיחות קוליות vs בקשות WA
// קליק על 📞 → navigate to "voice_calls"
```

### 4.7 שינויים ב-`RequestsBoard.js`

הוסף עמודה `source_channel` לכל שורה:
- 📞 שיחה קולית (voice)
- 💬 WhatsApp (whatsapp)  
- 🖊️ ידני (manual)

---

## 5. שלבי מימוש — פאזים

### Phase 1: תשתית (שבוע 1) — "הבוט עונה"

**מה בונים:**
- [ ] Twilio account setup + מספר ישראלי +972
- [ ] ElevenLabs account + בחירת קול + pre-render ברכות נפוצות
- [ ] Edge Function `voice-concierge` — flows בסיסיים (inbound/process/complete)
- [ ] Migrations 069/070/071
- [ ] Supabase Secrets חדשים

**תוצאה:** אורח מחייג → שומע ברכה → אומר משהו → מקבל תשובה בסיסית.

**בדיקה:** שיחת טסט פנימית (Mike מחייג, בוט עונה).

---

### Phase 2: אינטגרציה (שבוע 2) — "הצוות רואה"

**מה בונים:**
- [ ] זיהוי אורח מלא (phone → guests, כולל variants: +972/972/0)
- [ ] ברכה אישית ("שלום [שם], ברוך הבא לחדר [X]!")
- [ ] כתיבה מלאה ל-`guest_alerts` עם `source_channel='voice'`
- [ ] `VoiceCallsPanel.js` — ממשק ניהול שיחות
- [ ] שינויים ב-`RequestsAlertWidget` + `RequestsBoard`

**תוצאה:** שיחה נכנסת → alert מופיע אוטומטית על הצג של הצוות בשניות.

---

### Phase 3: חוויה פרמיום (שבוע 3) — "הבוט מרשים"

**מה בונים:**
- [ ] Audio pre-cache: ברכות נפוצות מ-ElevenLabs → Supabase Storage → Play מהיר (latency 0)
- [ ] Context awareness: הבוט יודע שעת ספא, שם החדר, ספירת לילות
- [ ] Multi-turn conversation: זיכרון תוך-שיחתי ("גם [פריט ראשון] וגם יין אדום")
- [ ] Handoff לאנושי: "מחבר אותך לצוות הקבלה" → Twilio transfer לשלוחה
- [ ] WhatsApp סיכום שיחה: אחרי ניתוק → "📋 סיכמנו את בקשתך: [X]. הצוות טיפל!" 

---

### Phase 4: ניתוח ואופטימיזציה (שבוע 4)

**מה בונים:**
- [ ] Dashboard analytics: שיחות לפי שעה, קטגוריות נפוצות, זמן ממוצע
- [ ] Missed calls alert: שיחה שלא נענתה → alert דחוף לצוות
- [ ] Quality scoring: הבוט מדרג לעצמו כמה הביטוי הובן טוב (Twilio confidence score)
- [ ] A/B testing: שני קולות ElevenLabs, מדידת user satisfaction

---

## 6. מפת קבצים — מה נוצר חדש

```
DREAM-AI-SYSTEM/
├── src/components/
│   └── VoiceCallsPanel.js          ← NEW: ממשק ניהול שיחות
├── supabase/
│   ├── migrations/
│   │   ├── 069_voice_calls.sql     ← NEW
│   │   ├── 070_voice_call_turns.sql ← NEW
│   │   └── 071_guest_alerts_voice.sql ← NEW
│   └── functions/
│       └── voice-concierge/
│           └── index.ts             ← NEW: הבוט הקולי
```

**קבצים שמשתנים (לא נכתבים מחדש):**
```
App.js                    ← route + nav item + VoiceCallsPanel import
RequestsBoard.js          ← עמודת source_channel (icon)
RequestsAlertWidget.js    ← badge נפרד לשיחות קוליות
```

---

## 7. הגדרות Supabase שיש להגדיר

### Twilio Webhook URLs (להגדיר ב-Twilio Console):
```
Voice URL:  https://bunohsdggxyyzruubvcd.supabase.co/functions/v1/voice-concierge/inbound
Status URL: https://bunohsdggxyyzruubvcd.supabase.co/functions/v1/voice-concierge/complete
Method: POST
```

### Twilio Phone Number Settings:
- Location: Israel (+972)
- Type: Local number (לא toll-free — אורחים בסוויטות מתקשרים מטלפון המלון/נייד)
- Configure: Accept Calls → Webhook URL למעלה

---

## 8. System Prompt — הבוט הקולי

```
אתה Dream, הקונסיירז' הקולי של דרים איילנד — ריזורט יוקרה ישראלי עם 26 סוויטות בוטיק.
ענה תמיד בעברית. טון: חם, מפנק, מקצועי. כאילו מדבר עם אורח VIP.

כשאורח מתקשר:
1. אם זוהה — קרא לו בשמו, אזכר את חדרו אם רלוונטי
2. הקשב לבקשה וזהה את הקטגוריה: room_service / spa / maintenance / info / escalate
3. אשר שהבקשה נרשמה ותטופל תוך [זמן סביר לפי קטגוריה]
4. אל תבטיח דברים שאינך בטוח בהם — הפנה לצוות אם יש ספק
5. שמור על שיחות קצרות (מקסימום 2-3 סיבובים לבקשה אחת)
6. אל תחשוף מחירים — "הצוות ישמח לסייע בפרטים"

זמני תגובה מובטחים לפי קטגוריה:
- room_service: "תוך 15-20 דקות"
- spa: "אתאם עם צוות הספא ויחזרו אליך"  
- maintenance: "צוות הטכנאים יגיע בהקדם"
- info: [ענה ישירות]
- escalate: "מחבר אותך כעת לנציג קבלה"

החזר תמיד JSON:
{
  "reply": "הטקסט שהבוט יאמר בקול",
  "intent": "room_service|spa|maintenance|info|escalate|unknown",
  "item": "מה בדיוק מבקשים (עברית קצרה)",
  "category": "request|urgent|info",
  "done": true/false  // האם השיחה הסתיימה
}
```

---

## 9. תרחישי Edge Cases

| תרחיש | טיפול |
|---|---|
| אורח לא מזוהה (מספר לא ב-DB) | ברכה גנרית, שואל שם + חדר, ממשיך רגיל |
| רעש רקע / לא הובן | "לא הצלחתי לשמוע טוב, תוכל לחזור?" עד 2 ניסיונות, אחר כך Hangup נעים |
| שיחה ארוכה מ-5 דקות | "אסכם ואעביר לצוות" → guest_alert + Hangup |
| needs_callback=true | עדיין עונה (שיחה נכנסת ≠ הודעה יזומה) — אבל כותב לlog ומעביר מיד לאנושי |
| שיחה מחוץ לשעות | Twilio: after-hours message ("הריזורט פתוח XXX-YYY, השאר הודעה") |
| בקשת מחיר | "פרטי המחיר זמינים בקבלה ובאתר שלנו" — לא חושף מחירים |
| תלונה רצינית | intent=escalate → flag urgent + push notification → transfer לאנושי |

---

## 10. קוד: voice-concierge (סקלטון מלא)

```typescript
// supabase/functions/voice-concierge/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const ELEVENLABS_KEY = Deno.env.get("ELEVENLABS_API_KEY")!;
const ELEVENLABS_VOICE = Deno.env.get("ELEVENLABS_VOICE_ID")!;
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY")!;

// ─── Helpers ────────────────────────────────────────────────────────────────

async function textToSpeech(text: string): Promise<string> {
  // ElevenLabs → returns audio URL (stored in Supabase Storage)
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE}`,
    {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    }
  );
  const audio = await res.arrayBuffer();
  // Upload to Supabase Storage → return public URL
  const path = `voice-tts/${Date.now()}.mp3`;
  await supabase.storage.from("voice-audio").upload(path, audio, { contentType: "audio/mpeg" });
  const { data } = supabase.storage.from("voice-audio").getPublicUrl(path);
  return data.publicUrl;
}

async function findGuest(phone: string) {
  const clean = phone.replace(/\D/g, "");
  const variants = [
    `+${clean}`,
    clean,
    `0${clean.slice(3)}`, // 972501234567 → 0501234567
    `+972${clean.slice(-9)}`
  ];
  const { data } = await supabase
    .from("guests")
    .select("id, name, room, spa_time, status, needs_callback")
    .in("phone", variants)
    .maybeSingle();
  return data;
}

async function processWithGemini(transcript: string, guest: Record<string,unknown> | null, history: string[]): Promise<{
  reply: string; intent: string; item: string; category: string; done: boolean;
}> {
  const guestCtx = guest
    ? `אורח: ${guest.name}, חדר: ${guest.room || "לא ידוע"}, ספא: ${guest.spa_time || "ללא"}`
    : "אורח לא מזוהה";
  
  const systemPrompt = `אתה Dream, קונסיירז' קולי של דרים איילנד. ${guestCtx}.
ענה בעברית חמה. החזר JSON בלבד: {reply, intent, item, category, done}`;

  const messages = [
    ...history.map((h, i) => ({ role: i % 2 === 0 ? "user" : "model", parts: [{ text: h }] })),
    { role: "user", parts: [{ text: transcript }] }
  ];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: messages,
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { maxOutputTokens: 300, responseMimeType: "application/json" }
      })
    }
  );
  const json = await res.json();
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  return JSON.parse(raw);
}

// ─── Route handler ───────────────────────────────────────────────────────────

serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.split("/").pop();

  // ── /inbound — שיחה נכנסת ──────────────────────────────────────────────
  if (path === "inbound") {
    const form = await req.formData();
    const callSid = form.get("CallSid") as string;
    const fromPhone = form.get("From") as string;

    const guest = await findGuest(fromPhone);

    // יצירת רשומת voice_call
    await supabase.from("voice_calls").insert({
      call_sid: callSid,
      from_phone: fromPhone,
      guest_id: guest?.id ?? null,
      status: "in_progress"
    });

    const greeting = guest
      ? `שלום ${guest.name}! ברוך הבא לדרים איילנד. כיצד אוכל לעזור לך היום?`
      : `שלום! הגעת לדרים איילנד. אני Dream, הקונסיירז' שלך. במה אוכל לסייע?`;

    const audioUrl = await textToSpeech(greeting);

    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
  <Gather input="speech" action="/functions/v1/voice-concierge/process?sid=${callSid}" 
          language="he-IL" speechTimeout="3" timeout="10" enhanced="true">
  </Gather>
  <Hangup/>
</Response>`,
      { headers: { "Content-Type": "text/xml" } }
    );
  }

  // ── /process — עיבוד תשובת האורח ─────────────────────────────────────────
  if (path === "process") {
    const form = await req.formData();
    const callSid = url.searchParams.get("sid") ?? (form.get("CallSid") as string);
    const transcript = (form.get("SpeechResult") as string) ?? "";
    const confidence = parseFloat((form.get("Confidence") as string) ?? "0");

    if (!transcript || confidence < 0.4) {
      const audioUrl = await textToSpeech("לא הצלחתי לשמוע. תוכל לחזור על זה?");
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
  <Gather input="speech" action="/functions/v1/voice-concierge/process?sid=${callSid}"
          language="he-IL" speechTimeout="3" timeout="8" enhanced="true">
  </Gather>
  <Hangup/>
</Response>`,
        { headers: { "Content-Type": "text/xml" } }
      );
    }

    // טען את השיחה הקיימת
    const { data: call } = await supabase
      .from("voice_calls").select("*, guests(id,name,room,spa_time,status,needs_callback)")
      .eq("call_sid", callSid).maybeSingle();

    const { data: turns } = await supabase
      .from("voice_call_turns").select("speaker, text")
      .eq("call_id", call?.id).order("created_at");

    const history = (turns ?? []).map((t: {speaker: string; text: string}) => t.text);
    const guest = (call as {guests?: Record<string,unknown>} | null)?.guests ?? null;

    // LLM
    const result = await processWithGemini(transcript, guest, history);

    // שמור תורות
    const callId = call?.id;
    if (callId) {
      await supabase.from("voice_call_turns").insert([
        { call_id: callId, speaker: "guest", text: transcript },
        { call_id: callId, speaker: "bot", text: result.reply }
      ]);
    }

    // אם יש בקשה ממשית → guest_alert
    if (result.intent !== "info" && result.intent !== "unknown" && (guest as {id?: string} | null)?.id) {
      const { data: alert } = await supabase.from("guest_alerts").insert({
        guest_id: (guest as {id: string}).id,
        alert_type: result.category === "urgent" ? "urgent" : "request",
        message: `📞 שיחה קולית: ${result.item}`,
        source_channel: "voice",
        voice_call_id: callId
      }).select().maybeSingle();

      if (alert && callId) {
        await supabase.from("voice_calls").update({ alert_id: alert.id }).eq("id", callId);
      }
    }

    // escalate → needs_callback
    if (result.intent === "escalate" && (guest as {id?: string} | null)?.id) {
      await supabase.from("guests").update({ needs_callback: true, requires_attention: true }).eq("id", (guest as {id: string}).id);
    }

    // TTS
    const audioUrl = await textToSpeech(result.reply);

    if (result.done) {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
  <Hangup/>
</Response>`,
        { headers: { "Content-Type": "text/xml" } }
      );
    }

    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
  <Gather input="speech" action="/functions/v1/voice-concierge/process?sid=${callSid}"
          language="he-IL" speechTimeout="3" timeout="8" enhanced="true">
  </Gather>
  <Hangup/>
</Response>`,
      { headers: { "Content-Type": "text/xml" } }
    );
  }

  // ── /complete — סיום שיחה (Twilio Status Callback) ───────────────────────
  if (path === "complete") {
    const form = await req.formData();
    const callSid = form.get("CallSid") as string;
    const duration = parseInt(form.get("CallDuration") as string ?? "0");
    const callStatus = form.get("CallStatus") as string;

    const finalStatus = callStatus === "completed" ? "completed"
      : callStatus === "no-answer" ? "abandoned"
      : "failed";

    // עדכון voice_calls
    const { data: call } = await supabase
      .from("voice_calls")
      .update({ status: finalStatus, duration_sec: duration })
      .eq("call_sid", callSid)
      .select("id, guest_id, voice_call_turns(*)")
      .maybeSingle();

    // בניית תמלול מלא
    if (call) {
      const transcript = ((call as {voice_call_turns?: {speaker: string; text: string}[]}).voice_call_turns ?? [])
        .map((t: {speaker: string; text: string}) => `${t.speaker === "guest" ? "👤" : "🤖"}: ${t.text}`)
        .join("\n");
      await supabase.from("voice_calls").update({ transcript }).eq("id", call.id);
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  return new Response("Not found", { status: 404 });
});
```

---

## 11. רשימת TODO לסשן הבא

### Step 1 — Accounts & Setup
- [ ] פתח חשבון Twilio → קנה מספר ישראלי +972
- [ ] פתח חשבון ElevenLabs → בחר קול עברי → שמור Voice ID
- [ ] פתח Google Cloud → הפעל Speech-to-Text API → קבל API key
  - **אלטרנטיבה זולה יותר:** Twilio Enhanced Speech (Deepgram) — לא צריך Google STT בנפרד
- [ ] הגדר כל ה-Secrets ב-Supabase (ראה §4.1)
- [ ] הגדר Supabase Storage bucket: `voice-audio` (public)

### Step 2 — Migrations
- [ ] `069_voice_calls.sql`
- [ ] `070_voice_call_turns.sql`  
- [ ] `071_guest_alerts_voice.sql`
- [ ] `supabase db push`

### Step 3 — Edge Function
- [ ] כתוב `supabase/functions/voice-concierge/index.ts` (ראה §10 — קוד הסקלטון)
- [ ] `supabase functions deploy voice-concierge --no-verify-jwt`
- [ ] הגדר Webhook URL ב-Twilio Console

### Step 4 — Frontend
- [ ] כתוב `VoiceCallsPanel.js`
- [ ] הוסף route + nav ב-`App.js`
- [ ] עדכן `RequestsBoard.js` (source_channel icon)
- [ ] עדכן `RequestsAlertWidget.js` (badge קולי)
- [ ] `npm run build`

### Step 5 — QA
- [ ] שיחת טסט: מחייג → שומע ברכה → בוקשה → alert מופיע ב-RequestsBoard
- [ ] בדיקת זיהוי אורח: מספר קיים ב-guests → ברכה אישית
- [ ] בדיקת אורח לא מזוהה → ברכה גנרית, alert נכתב בלי guest_id
- [ ] בדיקת escalate → needs_callback + push notification
- [ ] בדיקת latency: כמה שניות עד לתשובה הראשונה? (יעד: <3 שניות)

---

## 12. שאלות להחלטה לפני בנייה

1. **קול ElevenLabs** — נשמע ביחד ונבחר? (יש כ-30 קולות עבריים)
2. **מספר הטלפון** — האם הסוויטות מתקשרות מטלפון פנימי של המלון (שלוחה) או מנייד? → משפיע על caller ID matching
3. **שעות פעילות הבוט** — 24/7 או רק בשעות הריזורט (09:00-21:00)? Outside hours → voicemail?
4. **Twilio vs אלטרנטיבה ישראלית** — האם יש ספק VoIP ישראלי שאתם כבר עובדים איתו?
5. **WhatsApp follow-up** — אחרי שיחה, לשלוח לאורח סיכום ב-WA? (כבר יש את כל התשתית לזה)

---

*התוכנית הזו בנויה על הסטאק הקיים של Dream AI System — אין שבירת breaking changes, רק הוספה. כל הכלי שנבנה עד היום ממשיכים לעבוד בדיוק כמו שהם.*
