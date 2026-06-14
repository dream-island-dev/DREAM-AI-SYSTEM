import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPECTED_KEY            = Deno.env.get("EMAIL_IMPORT_API_KEY") ?? "";
const SUPABASE_URL            = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const COL_MAP: Record<string, string> = {
  "תזמון":        "treatment_time",
  "סוגי טיפולים": "treatment_type",
  "תוספות":       "extras",
  "טלפון":        "phone",
  "לקוח":         "guest_name",
  "פעילות":       "activity",
  "מטפל":         "therapist",
  "הערה":         "note",
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
  if (p.startsWith("0"))   return "972" + p.slice(1);
  if (p.length === 9)      return "972" + p;
  return p;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" },
    });
  }

  const apiKey = req.headers.get("x-api-key") ?? "";
  if (!EXPECTED_KEY || apiKey !== EXPECTED_KEY) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  let body: { html?: string; filter?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const { html, filter } = body;
  if (!html) {
    return new Response(JSON.stringify({ error: "missing html" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const suiteOnly = filter !== "all";
  const rows      = parseHtmlTable(html);

  if (!rows.length) {
    return new Response(JSON.stringify({ success: true, staged: 0, message: "no rows parsed" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Map Hebrew columns → internal field names
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
    return new Response(
      JSON.stringify({ success: true, staged: 0, skipped: rows.length, message: "no suite guests found" }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // Group by phone to detect shared phones (couples/families)
  const byPhone = new Map<string, Array<{ treatment_time: string; treatment_type: string; guest_name: string; raw_extras: string }>>();
  for (const r of filtered) {
    const raw = r.phone ?? "";
    if (!raw) continue;
    const phone = normalizePhone(raw);
    if (!byPhone.has(phone)) byPhone.set(phone, []);
    byPhone.get(phone)!.push({
      treatment_time: r.treatment_time ?? "",
      treatment_type: r.treatment_type ?? "",
      guest_name:     r.guest_name    ?? "",
      raw_extras:     r.extras        ?? "",
    });
  }

  const supabase  = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const batchId   = crypto.randomUUID();
  const stagingRows: Record<string, unknown>[] = [];

  for (const [phone, entries] of byPhone) {
    const isSharedPhone = entries.length > 1;

    // Look up matching booking
    const { data: existing } = await supabase
      .from("bookings")
      .select("id")
      .eq("phone", phone)
      .order("arrival_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    for (const entry of entries) {
      let match_status: string;
      let suspicious_reason: string | null = null;

      if (!existing) {
        match_status = "no_booking";
      } else if (isSharedPhone) {
        match_status = "suspicious";
        suspicious_reason = `${entries.length} אורחים על אותו טלפון`;
      } else {
        match_status = "matched";
      }

      stagingRows.push({
        import_batch:       batchId,
        treatment_time:     entry.treatment_time || null,
        treatment_type:     entry.treatment_type || null,
        guest_name:         entry.guest_name     || null,
        phone,
        raw_extras:         entry.raw_extras     || null,
        matched_booking_id: existing?.id         ?? null,
        match_status,
        suspicious_reason,
        sync_status:        "pending",
      });
    }
  }

  const { error: insertErr } = await supabase
    .from("spa_staging")
    .insert(stagingRows);

  if (insertErr) {
    console.error("[spa-webhook] staging insert error:", insertErr.message);
    return new Response(JSON.stringify({ error: "staging insert failed", detail: insertErr.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  const matched    = stagingRows.filter(r => r.match_status === "matched").length;
  const suspicious = stagingRows.filter(r => r.match_status === "suspicious").length;
  const no_booking = stagingRows.filter(r => r.match_status === "no_booking").length;

  console.info(`[spa-webhook] batch ${batchId}: ${matched} matched, ${suspicious} suspicious, ${no_booking} no_booking`);

  return new Response(
    JSON.stringify({ success: true, staged: stagingRows.length, matched, suspicious, no_booking, batch_id: batchId }),
    { headers: { "Content-Type": "application/json" } },
  );
});
