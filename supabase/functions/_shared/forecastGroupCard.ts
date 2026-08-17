// Parse reception's "קבלת הקבוצה מהקבלה" card into forecast group rows.
// Text path is deterministic. Image path OCRs with Gemini then reuses the same mapper.

import type { ForecastGroupRow } from "./forecastDaily.ts";

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];

function padTime(raw: string): string {
  const m = String(raw || "").match(/(\d{1,2}):(\d{2})/);
  if (!m) return "";
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function cleanName(raw: string): string {
  return String(raw || "")
    .replace(/^[*\s]+|[*\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseBlock(name: string, body: string): ForecastGroupRow | null {
  const qtyM = body.match(/כמות\s*[:：]?\s*(\d+)/);
  const qty = qtyM ? parseInt(qtyM[1], 10) : 0;
  const arrivalM = body.match(/(\d{1,2}:\d{2})\s*הגעה/) || body.match(/הגעה[^\d]{0,12}(\d{1,2}:\d{2})/);
  const lunchTimes = [...body.matchAll(/(\d{1,2}:\d{2})\s*ארוחת/g)].map((m) => padTime(m[1]));
  const individuals = /התנהלות\s*כבודדים/.test(body);
  const meals = individuals
    ? "התנהלות כבודדים"
    : (lunchTimes[lunchTimes.length - 1] || "");
  const entry = /הגעה\s*לדרים|קבלה/.test(body) ? "קבלה" : "קבלה";
  const n = cleanName(name);
  if (!n && !qty) return null;
  return {
    name: n,
    arrival: padTime(arrivalM?.[1] || "09:00") || "09:00",
    entry,
    meals,
    qty: Number.isFinite(qty) ? qty : 0,
  };
}

export function parseReceptionGroupCard(text: string): ForecastGroupRow[] {
  const cleaned = String(text || "").replace(/\u00a0/g, " ").replace(/\r/g, "").trim();
  if (!cleaned) return [];
  const starred = [...cleaned.matchAll(/\*\s*([^*\n]{2,80}?)\s*\*/g)];
  const out: ForecastGroupRow[] = [];
  if (starred.length) {
    for (let i = 0; i < starred.length; i++) {
      const m = starred[i];
      const start = (m.index ?? 0) + m[0].length;
      const end = starred[i + 1]?.index ?? cleaned.length;
      const row = parseBlock(m[1], cleaned.slice(start, end));
      if (row) out.push(row);
    }
    return out;
  }
  const chunks = cleaned.split(/(?=כמות\s*[:：]?\s*\d+)/);
  for (const chunk of chunks) {
    if (!/כמות\s*[:：]?\s*\d+/.test(chunk)) continue;
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    const qtyLine = lines.findIndex((l) => /כמות\s*[:：]?\s*\d+/.test(l));
    const before = lines.slice(0, Math.max(0, qtyLine)).reverse();
    const nameLine = before.find((l) =>
      l.length >= 2
      && !/דלאקס|קלאסיק|טיפול|הגעה|ארוחת|נטע|גלית|05\d/.test(l)
    ) || before[before.length - 1] || "";
    const row = parseBlock(nameLine, chunk);
    if (row) out.push(row);
  }
  return out;
}

function rowsFromUnknown(raw: unknown): ForecastGroupRow[] {
  const arr = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === "object" && Array.isArray((raw as { groups?: unknown }).groups)
      ? (raw as { groups: unknown[] }).groups
      : []);
  return arr.map((g) => {
    const o = g && typeof g === "object" ? g as Record<string, unknown> : {};
    const mealsRaw = String(o.meals ?? "").trim();
    return {
      name: cleanName(String(o.name ?? "")),
      arrival: padTime(String(o.arrival ?? "09:00")) || "09:00",
      entry: /דרים|קבלה/.test(String(o.entry ?? "קבלה")) ? "קבלה" : (String(o.entry ?? "").trim() || "קבלה"),
      meals: /כבודדים/.test(mealsRaw) ? "התנהלות כבודדים" : (padTime(mealsRaw) || mealsRaw),
      qty: Math.max(0, parseInt(String(o.qty ?? "0"), 10) || 0),
    };
  }).filter((g) => g.name || g.qty);
}

async function geminiOcrGroupCard(imageBase64: string, mime: string): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  const data = imageBase64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  const body = {
    contents: [{
      role: "user",
      parts: [
        {
          text: [
            "Extract every group from this Hebrew reception card (קבלת הקבוצה מהקבלה).",
            "Return JSON {\"groups\":[{\"name\",\"arrival\",\"entry\",\"meals\",\"qty\"}]}.",
            "entry is קבלה when the card says הגעה לדרים.",
            "meals is התנהלות כבודדים if present, else the lunch clock time only (HH:MM).",
            "qty is the כמות integer. Do not invent groups.",
          ].join(" "),
        },
        { inline_data: { mime_type: mime || "image/png", data } },
      ],
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
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
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(45_000),
        },
      );
      if (!res.ok) throw new Error(`gemini_${model}_${res.status}`);
      const json = await res.json();
      const text = json?.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text ?? "")
        .join("") ?? "";
      if (!text.trim()) throw new Error("gemini_empty");
      return text;
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw lastErr ?? new Error("gemini_unavailable");
}

export async function parseReceptionGroupCardInput(opts: {
  text?: string;
  imageBase64?: string;
  mime?: string;
}): Promise<ForecastGroupRow[]> {
  const fromText = parseReceptionGroupCard(opts.text || "");
  if (fromText.length) return fromText;
  const img = String(opts.imageBase64 || "").trim();
  if (!img) return [];
  const raw = await geminiOcrGroupCard(img, opts.mime || "image/png");
  const cleaned = raw.trim().replace(/^```(?:json)?[\r\n]*/i, "").replace(/[\r\n]*```$/i, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    const rows = rowsFromUnknown(parsed);
    if (rows.length) return rows;
  } catch { /* fall through — model may have returned the card as plain text */ }
  return parseReceptionGroupCard(cleaned);
}
