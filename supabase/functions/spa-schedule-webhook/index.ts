import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPECTED_KEY = Deno.env.get("EMAIL_IMPORT_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Hebrew column → internal field name
const COL_MAP: Record<string, string> = {
  "תזמון": "treatment_time",
  "סוגי טיפולים": "treatment_type",
  "תוספות": "extras",
  "טלפון": "phone",
  "לקוח": "guest_name",
  "פעילות": "activity",
  "מטפל": "therapist",
  "הערה": "note",
};

const SUITE_MARKER = "לאורחי הסוויטות";

function stripTags(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .trim();
}

function extractCells(rowHtml: string, tag: "th" | "td"): string[] {
  const re = new RegExp(`<${tag}[^>]*>(.*?)<\\/${tag}>`, "gis");
  const cells: string[] = [];
  let m;
  while ((m = re.exec(rowHtml)) !== null) cells.push(stripTags(m[1]));
  return cells;
}

function parseHtmlTable(html: string): Record<string, string>[] {
  const theadMatch = html.match(/<thead[\s\S]*?>([\s\S]*?)<\/thead>/i);
  const tbodyMatch = html.match(/<tbody[\s\S]*?>([\s\S]*?)<\/tbody>/i);

  let headers: string[] = [];
  let bodyHtml = "";

  if (theadMatch && tbodyMatch) {
    const theadRows = [...theadMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    if (theadRows.length) headers = extractCells(theadRows[0][1], "th");
    bodyHtml = tbodyMatch[1];
  } else {
    const allRows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    if (!allRows.length) return [];
    headers = extractCells(allRows[0][1], "th");
    if (!headers.length) headers = extractCells(allRows[0][1], "td");
    bodyHtml = allRows.slice(1).map(r => r[0]).join("");
  }

  if (!headers.length) return [];

  const rows = [...bodyHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  return rows.map(r => {
    const cells = extractCells(r[1], "td");
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = cells[i] ?? ""; });
    return obj;
  }).filter(r => Object.values(r).some(v => v !== ""));
}

function normalizePhone(raw: string): string {
  let p = raw.replace(/[\s\-().+]/g, "");
  if (p.startsWith("972")) return p;
  if (p.startsWith("0")) return "972" + p.slice(1);
  if (p.length === 9) return "972" + p;
  return p;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
  }

  const apiKey = req.headers.get("x-api-key") ?? "";
  if (!EXPECTED_KEY || apiKey !== EXPECTED_KEY) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  let body: { html?: string; filter?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const { html, filter } = body;
  if (!html) {
    return new Response(JSON.stringify({ error: "missing html" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const suiteOnly = filter !== "all";

  const rows = parseHtmlTable(html);
  if (!rows.length) {
    return new Response(JSON.stringify({ success: true, updated: 0, skipped: 0, message: "no rows parsed" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Map Hebrew columns to internal names and filter
  const mapped = rows.map(row => {
    const out: Record<string, string> = {};
    for (const [heb, field] of Object.entries(COL_MAP)) {
      const val = row[heb] ?? "";
      if (val) out[field] = val;
    }
    return out;
  });

  const filtered = suiteOnly
    ? mapped.filter(r => (r.extras ?? "").includes(SUITE_MARKER))
    : mapped;

  if (!filtered.length) {
    return new Response(JSON.stringify({ success: true, updated: 0, skipped: rows.length, message: "no suite guests found" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Deduplicate by phone — keep first occurrence (earliest in the email = first treatment)
  const byPhone = new Map<string, { treatment_time: string; treatment_type: string }>();
  for (const r of filtered) {
    const raw = r.phone ?? "";
    if (!raw) continue;
    const phone = normalizePhone(raw);
    if (!byPhone.has(phone)) {
      byPhone.set(phone, {
        treatment_time: r.treatment_time ?? "",
        treatment_type: r.treatment_type ?? "",
      });
    }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let updated = 0;
  let skipped = 0;
  const skipped_details: string[] = [];

  for (const [phone, data] of byPhone) {
    if (!data.treatment_time) { skipped++; skipped_details.push(`${phone}: no treatment_time`); continue; }

    const { data: existing, error: lookupErr } = await supabase
      .from("bookings")
      .select("id")
      .eq("phone", phone)
      .order("arrival_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lookupErr) {
      console.error(`[spa-webhook] lookup error for ${phone}:`, lookupErr.message);
      skipped++;
      skipped_details.push(`${phone}: db error`);
      continue;
    }

    if (!existing) {
      skipped++;
      skipped_details.push(`${phone}: no matching booking`);
      continue;
    }

    const { error: updateErr } = await supabase
      .from("bookings")
      .update({ treatment_time: data.treatment_time, treatment_type: data.treatment_type })
      .eq("id", existing.id);

    if (updateErr) {
      console.error(`[spa-webhook] update error for ${phone}:`, updateErr.message);
      skipped++;
      skipped_details.push(`${phone}: update failed`);
    } else {
      console.info(`[spa-webhook] ✅ updated ${phone} → ${data.treatment_type} @ ${data.treatment_time}`);
      updated++;
    }
  }

  const result: Record<string, unknown> = { success: true, updated, skipped };
  if (skipped_details.length) result.skipped_details = skipped_details;

  return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
});
