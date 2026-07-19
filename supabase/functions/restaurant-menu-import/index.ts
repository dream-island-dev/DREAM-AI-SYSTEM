// AI menu import — website sync, image/PDF upload → structured restaurant menu draft.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];
const DEFAULT_MENU_URL = "https://armmonim.co.il/תפריט/";
const MAX_HTML_CHARS = 120_000;

const BINARY_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

const MENU_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    menu_label: { type: "STRING" },
    sections: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          items: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" },
                description: { type: "STRING", nullable: true },
                price: { type: "NUMBER", nullable: true },
                course: {
                  type: "STRING",
                  enum: ["starter", "main", "dessert", "drink", "kids", "side", "other"],
                },
                allergens: { type: "ARRAY", items: { type: "STRING" } },
                tags: { type: "ARRAY", items: { type: "STRING" } },
              },
              required: ["name"],
            },
          },
        },
        required: ["name", "items"],
      },
    },
    warnings: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["sections", "warnings"],
};

function buildMenuPrompt(opts: {
  menuKind: string;
  sourceLabel: string;
  isSpecial: boolean;
  textContent?: string;
}): string {
  const kindLine = opts.isSpecial
    ? "זהו תפריט ספיישל / עונתי / אירוע — שמור על מבנה ברור לצוות המסעדה."
    : "זהו התפריט הקבוע של מסעדת ערמונים.";

  const body = opts.textContent
    ? `מקור: ${opts.sourceLabel}\n\n"""${opts.textContent}"""\n\n`
    : `מקור: ${opts.sourceLabel} (קובץ מצורף — PDF או תמונה של תפריט).\n\n`;

  return `${body}${kindLine}

חלץ את כל המנות לתפריט מובנה ללוח הזמנות במסעדה.

כללים:
1. קבץ לקטגוריות (sections) בעברית — לדוגמה: מנות פתיחה, עיקריות, תוספות, קינוחים, משקאות.
2. לכל מנה: name (חובה), description (אופציונלי), price (מספר בשקלים בלבד אם מופיע), course.
3. course: starter | main | dessert | drink | kids | side | other
4. אל תמציא מנות שלא מופיעות במקור.
5. אם מחיר לא ברור — השאר price ריק.
6. warnings: שורות בעברית על אי-בהירויות או מנות שסומנו בביטחון נמוך.

החזר JSON בלבד לפי הסכמה.`;
}

async function callGeminiMenu(
  apiKey: string,
  parts: unknown[],
): Promise<string> {
  const requestBody = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      maxOutputTokens: 8192,
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: MENU_RESPONSE_SCHEMA,
    },
  };

  let lastErr: Error | null = null;
  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(90_000),
        },
      );
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`gemini_${model}_${res.status}: ${errBody.slice(0, 200)}`);
      }
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text ?? "")
        .join("") ?? "";
      if (!text.trim()) throw new Error("gemini_empty");
      return text;
    } catch (e) {
      lastErr = e as Error;
      console.warn(`[restaurant-menu-import] ${model} failed:`, lastErr.message);
    }
  }
  throw lastErr ?? new Error("gemini_unavailable");
}

function parseMenuJson(raw: string) {
  const cleaned = raw.trim()
    .replace(/^```(?:json)?[\r\n]*/i, "")
    .replace(/[\r\n]*```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  const sections = Array.isArray(parsed?.sections) ? parsed.sections : [];
  const warnings = Array.isArray(parsed?.warnings) ? parsed.warnings : [];
  return {
    menu_label: String(parsed?.menu_label ?? "").trim() || null,
    sections,
    warnings: warnings.map((w: unknown) => String(w)),
  };
}

async function assertMenuAdmin(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const role = String(profile?.role ?? "");
  if (!["super_admin", "admin", "manager"].includes(role)) {
    throw new Error("forbidden: restaurant menu admin only");
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const mode = String(body.mode ?? "upload");
    const menuKind = String(body.menu_kind ?? "standard");
    const isSpecial = menuKind === "special";

    const bearer = req.headers.get("Authorization") ?? "";
    const token = bearer.replace(/^Bearer\s+/i, "").trim();
    if (!token) throw new Error("unauthorized");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    const user = authData?.user;
    if (authErr || !user) throw new Error("unauthorized");
    await assertMenuAdmin(supabase, user.id);

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("GEMINI_API_KEY not set");

    let parts: unknown[];
    let sourceLabel = "";

    if (mode === "website") {
      const url = String(body.website_url ?? DEFAULT_MENU_URL).trim() || DEFAULT_MENU_URL;
      const res = await fetch(url, {
        headers: { "User-Agent": "DreamIsland-XOS/1.0 (menu-sync)" },
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) throw new Error(`website_fetch_failed: ${res.status}`);
      const html = await res.text();
      const textContent = html.slice(0, MAX_HTML_CHARS);
      sourceLabel = `אתר ערמונים (${url})`;
      parts = [{
        text: buildMenuPrompt({
          menuKind,
          sourceLabel,
          isSpecial,
          textContent,
        }),
      }];
    } else {
      const fileName = String(body.fileName ?? "menu").trim();
      const mimeType = String(body.mimeType ?? "").trim().toLowerCase();
      const content = String(body.content ?? "").trim();
      const isText = Boolean(body.isText);
      if (!content) throw new Error("missing content");

      sourceLabel = fileName;
      if (isText) {
        parts = [{
          text: buildMenuPrompt({
            menuKind,
            sourceLabel,
            isSpecial,
            textContent: content.slice(0, MAX_HTML_CHARS),
          }),
        }];
      } else {
        if (!BINARY_MIME_TYPES.has(mimeType)) {
          throw new Error(`unsupported_mime: ${mimeType}`);
        }
        parts = [
          { text: buildMenuPrompt({ menuKind, sourceLabel, isSpecial }) },
          { inline_data: { mime_type: mimeType, data: content } },
        ];
      }
    }

    const raw = await callGeminiMenu(apiKey, parts);
    const parsed = parseMenuJson(raw);

    if (!parsed.sections.length) {
      throw new Error("no_sections_extracted");
    }

    const itemCount = parsed.sections.reduce(
      (n: number, s: { items?: unknown[] }) => n + (s.items?.length ?? 0),
      0,
    );

    await supabase.from("restaurant_menu_imports").insert({
      source_filename: sourceLabel,
      raw_ai_json: parsed,
      parsed_summary: {
        mode,
        menu_kind: menuKind,
        section_count: parsed.sections.length,
        item_count: itemCount,
        warnings: parsed.warnings,
      },
      status: "pending_review",
      created_by: user.id,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        menu: parsed,
        summary: {
          sections: parsed.sections.length,
          items: itemCount,
          menu_kind: menuKind,
          source: sourceLabel,
        },
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[restaurant-menu-import]", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
