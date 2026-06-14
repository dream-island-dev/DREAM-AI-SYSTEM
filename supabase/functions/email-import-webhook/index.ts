/**
 * email-import-webhook
 * ─────────────────────────────────────────────────────────────────
 * מקבל POST מ-Make.com עם גוף HTML של מייל EZGO,
 * מפרסר את טבלת ה-HTML, ממפה עמודות עבריות/אנגליות,
 * ומבצע upsert לטבלת bookings ב-Supabase.
 *
 * אימות: Header — x-api-key: <EMAIL_IMPORT_API_KEY>
 *
 * POST body: { "html": "<html>...</html>" }
 * ─────────────────────────────────────────────────────────────────
 */

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

// ── Column name → booking field ───────────────────────────────────────────────
const COL_MAP: Record<string, string> = {
  // שם אורח
  "שם מלא":       "guest_name",
  "שם אורח":      "guest_name",
  "שם המזמין":    "guest_name",
  "שם הלקוח":    "guest_name",
  "שם":           "guest_name",
  "אורח":         "guest_name",
  "לקוח":         "guest_name",
  "name":         "guest_name",
  "guest name":   "guest_name",
  "guest":        "guest_name",

  // טלפון
  "טלפון":        "phone",
  "נייד":          "phone",
  "טלפון נייד":   "phone",
  "מספר טלפון":   "phone",
  "phone":        "phone",
  "mobile":       "phone",
  "cell":         "phone",
  "tel":          "phone",

  // תאריך הגעה — כולל הפורמט הקצר מ-EZGO "ת. התחלה"
  "ת. התחלה":      "arrival_date",
  "ת.התחלה":       "arrival_date",
  "תאריך התחלה":   "arrival_date",
  "תאריך כניסה":   "arrival_date",
  "תאריך הגעה":    "arrival_date",
  "תאריך":         "arrival_date",
  "הגעה":          "arrival_date",
  "כניסה":         "arrival_date",
  "arrival":       "arrival_date",
  "arrival date":  "arrival_date",
  "check-in":      "arrival_date",
  "checkin":       "arrival_date",
  "check in":      "arrival_date",

  // סכום
  "מחיר":              "amount",
  "יתרה":              "amount",
  "יתרה לתשלום":       "amount",
  'סה"כ לתשלום':      "amount",
  'סה"כ':             "amount",
  "סכום":              "amount",
  "לתשלום":            "amount",
  "balance":           "amount",
  "amount":            "amount",
  "total":             "amount",
  "price":             "amount",

  // לילות → מחושב checkout_date
  "לילות":   "nights",
  "nights":  "nights",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizeKey(s: string): string {
  return s.replace(/[‏‎ ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizePhone(raw: string): string {
  let p = raw.replace(/[\s\-().‏+]/g, "");
  if (p.startsWith("972")) return p;
  if (p.startsWith("0"))   return "972" + p.slice(1);
  return p;
}

function parseDate(raw: string): string | null {
  const s = raw.replace(/[‏‎]/g, "").trim();
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#?\w+;/g, "")
    .trim();
}

// ── HTML table parser ─────────────────────────────────────────────────────────
function parseHtmlTable(html: string): Record<string, string>[] {
  const theadMatch = html.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);

  let headerHtml: string;
  let bodyHtml: string;

  if (theadMatch && tbodyMatch) {
    headerHtml = theadMatch[1];
    bodyHtml   = tbodyMatch[1];
  } else {
    const allRows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
    if (allRows.length < 2) return [];
    headerHtml = allRows[0];
    bodyHtml   = allRows.slice(1).join("");
  }

  const headers: string[] = [];
  for (const th of headerHtml.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi) ?? []) {
    headers.push(stripTags(th));
  }
  if (headers.length === 0) return [];

  const rows: Record<string, string>[] = [];
  for (const tr of bodyHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) ?? []) {
    const cells = tr.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi) ?? [];
    if (cells.length === 0) continue;
    const row: Record<string, string> = {};
    cells.forEach((td, i) => {
      if (i < headers.length) row[headers[i]] = stripTags(td);
    });
    rows.push(row);
  }
  return rows;
}

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  const apiKey      = req.headers.get("x-api-key");
  const expectedKey = Deno.env.get("EMAIL_IMPORT_API_KEY");
  if (!apiKey || apiKey !== expectedKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const html: string = body.html ?? "";

    if (!html.trim()) {
      return new Response(JSON.stringify({ error: "html field is empty" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const rawRows = parseHtmlTable(html);
    if (rawRows.length === 0) {
      return new Response(JSON.stringify({
        success: true, imported: 0, skipped: 0,
        message: "No table rows found in email HTML",
      }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const bookings: Record<string, unknown>[] = [];
    const skipped:  string[] = [];

    for (const raw of rawRows) {
      const mapped: Record<string, unknown> = {};

      for (const [col, cell] of Object.entries(raw)) {
        if (!cell) continue;
        const field = COL_MAP[normalizeKey(col)] ?? COL_MAP[col];
        if (!field) continue;

        switch (field) {
          case "guest_name":
            mapped.guest_name = cell;
            break;
          case "phone":
            mapped.phone = normalizePhone(cell);
            break;
          case "arrival_date":
            mapped.arrival_date = parseDate(cell);
            break;
          case "amount": {
            const n = parseFloat(cell.replace(/[₪,\s]/g, ""));
            if (!isNaN(n) && n > 0) mapped.amount = n;
            break;
          }
          case "nights": {
            const n = parseInt(cell, 10);
            if (!isNaN(n) && n > 0 && mapped.arrival_date) {
              const d = new Date(mapped.arrival_date as string);
              d.setDate(d.getDate() + n);
              mapped.checkout_date = d.toISOString().split("T")[0];
            }
            break;
          }
        }
      }

      if (!mapped.guest_name || !mapped.phone || !mapped.arrival_date) {
        skipped.push(`Missing fields: ${JSON.stringify(mapped)}`);
        continue;
      }
      const digits = String(mapped.phone).replace(/\D/g, "");
      if (digits.length < 10) {
        skipped.push(`Invalid phone: ${mapped.phone}`);
        continue;
      }

      bookings.push({
        ...mapped,
        confirmation_status: "pending",
        payment_status:      "pending",
      });
    }

    if (bookings.length === 0) {
      return new Response(JSON.stringify({
        success: true, imported: 0,
        skipped: skipped.length, skipped_details: skipped,
      }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error: dbError } = await supabase
      .from("bookings")
      .upsert(bookings, { onConflict: "phone,arrival_date", ignoreDuplicates: false });

    if (dbError) throw new Error(dbError.message);

    return new Response(JSON.stringify({
      success:  true,
      imported: bookings.length,
      skipped:  skipped.length,
      ...(skipped.length > 0 ? { skipped_details: skipped } : {}),
    }), { headers: { ...CORS, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
