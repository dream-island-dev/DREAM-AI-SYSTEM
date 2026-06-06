// supabase/functions/generate-agent-profile/index.ts
// Edge Function: takes questionnaire responses → generates a rich system
// prompt via Claude Sonnet → saves agent_profile + questionnaire_responses.
// Deploy: supabase functions deploy generate-agent-profile

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.20.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { responses, department, managerName, driveFolderUrl } =
      await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const bearer = req.headers.get("Authorization") ?? "";
    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      bearer.replace("Bearer ", "")
    );
    if (authErr || !user) throw new Error("Unauthorized");

    // Use Claude Sonnet to craft a richer system prompt from the raw questionnaire
    const anthropic = new Anthropic({
      apiKey: Deno.env.get("ANTHROPIC_API_KEY")!,
    });

    const formatted = Object.entries(responses as Record<string, string>)
      .map(([q, a]) => `שאלה: ${q}\nתשובה: ${a}`)
      .join("\n\n");

    const generation = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: `
אתה מומחה בבניית פרופילי סוכן AI לניהול מלון יוקרה.
על-סמך תשובות השאלון הבאות, צור System Prompt מקיף ומדויק בעברית לסוכן AI
שישרת את המנהל באופן אישי.

שם המנהל: ${managerName}
מחלקה: ${department}
קישור Google Drive: ${driveFolderUrl || "לא צוין"}

תשובות השאלון:
${formatted}

---
הנחיות לבניית ה-System Prompt:
1. פתח עם הגדרת זהות ברורה (שם הסוכן, המחלקה, שם המנהל).
2. פרט את אחריות המחלקה ואתגריה הייחודיים.
3. ציין KPIs ומדדים שחשוב לעקוב.
4. הגדר סגנון תקשורת ספציפי לפי העדפת המנהל.
5. ציין במפורש נושאים שדורשים זהירות / אישור מנהל.
6. הוסף כללי עבודה ברורים (עברית, מבנה תשובות וכו').
7. אם יש קישור Drive — הזכר אותו.

החזר רק את ה-System Prompt עצמו, ללא כותרות נוספות.
`.trim(),
        },
      ],
    });

    const generatedPrompt =
      generation.content[0].type === "text"
        ? generation.content[0].text
        : `# סוכן מחלקת ${department}\nאתה עוזר AI של ${managerName}.`;

    // Save questionnaire responses first
    const { data: qRecord, error: qErr } = await supabase
      .from("questionnaire_responses")
      .insert({
        manager_id: user.id,
        department,
        responses,
        drive_folder_url: driveFolderUrl ?? null,
      })
      .select()
      .single();

    if (qErr) throw qErr;

    // Upsert agent profile (one per manager)
    const { data: agentProfile, error: agentErr } = await supabase
      .from("agent_profiles")
      .upsert(
        {
          manager_id: user.id,
          department,
          display_name: `סוכן ${department}`,
          system_prompt: generatedPrompt,
          drive_folder_url: driveFolderUrl ?? null,
          questionnaire_id: qRecord.id,
          personality_traits: {
            communication_style: responses.communication_style ?? "formal",
          },
          is_active: true,
        },
        { onConflict: "manager_id" }
      )
      .select()
      .single();

    if (agentErr) throw agentErr;

    // Link questionnaire back to the profile
    await supabase
      .from("questionnaire_responses")
      .update({ agent_profile_id: agentProfile.id })
      .eq("id", qRecord.id);

    return new Response(JSON.stringify({ ok: true, agentProfile }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
