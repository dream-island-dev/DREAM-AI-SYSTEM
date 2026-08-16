// src/components/EzgoApiCodeMappingPanel.js
// EZGO live API — one-time code mapping. Writes ONLY spa_therapists.ezgo_worker_id
// and ezgo_suite_room_map. auto_bootstrap mappings are untrusted until staff
// confirms against the EZGO room catalog (or a 1-room sample order).

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { SUITE_REGISTRY, PREMIUM_DAY_ROOMS, GENERIC_DAY_PASS_ROOM } from "../data/suiteRegistry";

// 26 physical suites + Premium Day 1/2 — the 28 units EZGO assigns a RoomId
// to. GENERIC_DAY_PASS_ROOM stays selectable in the dropdown (a RoomId can
// still legitimately point at it) but isn't part of the 28-unit target.
const TARGET_UNITS = [...SUITE_REGISTRY, ...PREMIUM_DAY_ROOMS];
const SUITE_DROPDOWN_OPTIONS = [...SUITE_REGISTRY, ...PREMIUM_DAY_ROOMS, GENERIC_DAY_PASS_ROOM];

const MATCHED_VIA_LABELS = {
  csv_verified: "מאומת מול דוח EZGO",
  staff_verified: "אושר ידנית מול EZGO",
  auto_bootstrap: "לא ודאי — הסקה פנימית",
  manual: "לא ודאי — בחירה ידנית",
};

function isTrustedMatch(via) {
  return via === "csv_verified" || via === "staff_verified";
}

function fmtTimestamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** "09/10/2026 10:00" + "09/10/2026 10:45" -> "09/10/2026 10:00–10:45" */
function fmtActivityTime(start, end) {
  if (!start) return "";
  const [date, time] = start.split(" ");
  const endTime = end ? end.split(" ")[1] : null;
  return endTime ? `${date} ${time}–${endTime}` : `${date} ${time || ""}`.trim();
}

function fmtRelative(iso) {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "עכשיו";
  if (mins < 60) return `לפני ${mins} דק'`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `לפני ${hours} שע'`;
  return `לפני ${Math.floor(hours / 24)} ימים`;
}

function sampleOrderHint(seenRow) {
  if (!seenRow) return { text: "אין אירוע חי לדוגמה — נוסף ידנית או שטרם נצפה ב-API.", warn: false };
  if (!seenRow.sample_order_id) return { text: "אין אירוע חי לדוגמה — נוסף ידנית או שטרם נצפה ב-API.", warn: false };
  const multi = Number(seenRow.sample_order_room_count) > 1;
  return multi
    ? { text: `⚠ הזמנה #${seenRow.sample_order_id} כוללת ${seenRow.sample_order_room_count} חדרים — אל תאמת לפיה בלבד. קח את המספר מרשימת היחידות ב-EZGO.`, warn: true }
    : { text: `לאימות: הזמנה #${seenRow.sample_order_id} (חדר אחד) · נצפה ${seenRow.event_count} פעמים · לאחרונה ${fmtTimestamp(seenRow.last_seen_at)}`, warn: false };
}

const rowStyle = {
  background: "rgba(0,0,0,0.2)",
  border: "1px solid rgba(201,169,110,0.25)",
  borderRadius: 10,
  padding: "10px 14px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 10,
};

const cardBoxStyle = {
  background: "rgba(0,0,0,0.15)",
  border: "1px solid rgba(201,169,110,0.25)",
  borderRadius: 10,
  padding: "12px 14px",
  marginBottom: 14,
};

const warnBoxStyle = {
  fontSize: 12,
  color: "#fbbf24",
  background: "rgba(245,158,11,0.1)",
  border: "1px solid rgba(245,158,11,0.35)",
  borderRadius: 8,
  padding: "8px 12px",
  marginTop: 8,
  lineHeight: 1.6,
};

const selectStyle = { fontSize: 12, borderRadius: 6, padding: "4px 8px" };
const inputStyle = { fontSize: 12, borderRadius: 6, padding: "4px 8px", minWidth: 140 };

function ConfirmButton({ disabled, onClick, children }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      disabled={disabled || busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
      style={{
        background: disabled ? "rgba(255,255,255,0.08)" : "var(--gold)",
        color: disabled ? "rgba(255,255,255,0.4)" : "#412402",
        fontWeight: 700,
      }}
    >
      {busy ? "שומר..." : children}
    </button>
  );
}

// ── Sync health — is EZGO actually sending data, is our cron actually
// draining it. Reads ezgo_api_ingest directly: staged/processing stuck high
// means the cron isn't keeping up; failed>0 means a row needs a look;
// last-event age tells you whether EZGO itself has gone quiet.
const ENTITY_LABELS = { Orders: "הזמנה", Reservations: "חדר", Activities: "טיפול", MealTimings: "שעת ארוחה", Adds: "תוספת" };

function SyncHealthCard() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [staged, processing, failed, parsed24h, lastRow] = await Promise.all([
      supabase.from("ezgo_api_ingest").select("id", { count: "exact", head: true }).eq("status", "staged"),
      supabase.from("ezgo_api_ingest").select("id", { count: "exact", head: true }).eq("status", "processing"),
      supabase.from("ezgo_api_ingest").select("id", { count: "exact", head: true }).eq("status", "failed"),
      supabase.from("ezgo_api_ingest").select("id", { count: "exact", head: true }).eq("status", "parsed").gte("created_at", since24h),
      supabase.from("ezgo_api_ingest").select("created_at, raw_payload").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    setHealth({
      staged: staged.count ?? 0,
      processing: processing.count ?? 0,
      failed: failed.count ?? 0,
      parsed24h: parsed24h.count ?? 0,
      lastEventAt: lastRow.data?.created_at ?? null,
      lastEntity: lastRow.data?.raw_payload?.Entity ?? null,
    });
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading || !health) return <div style={{ fontSize: 13, color: "rgba(232,201,138,0.6)" }}>בודק בריאות סנכרון...</div>;

  const backlog = health.staged + health.processing;
  let status = { text: "✓ הכל מסונכרן — התור ריק.", color: "#86efac" };
  if (health.failed > 0) {
    status = { text: `⚠ ${health.failed} רשומות נכשלו בעיבוד — דורש בדיקה.`, color: "#f87171" };
  } else if (backlog > 50) {
    status = { text: `⏳ ${backlog} אירועים ממתינים לעיבוד — הקרון מנקז כל דקה, אמור להתאזן לבד תוך דקות.`, color: "#fbbf24" };
  } else if (backlog > 0) {
    status = { text: `${backlog} אירועים בתור — תקין (מתעדכן כל דקה).`, color: "rgba(232,201,138,0.7)" };
  }

  return (
    <div style={{ ...cardBoxStyle, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "rgba(232,201,138,0.9)" }}>📡 בריאות סנכרון EZGO</div>
        <button type="button" className="btn btn-sm" onClick={load} style={{ fontSize: 11 }}>🔄 רענון</button>
      </div>
      <div style={{ fontSize: 13, color: status.color, marginTop: 8 }}>{status.text}</div>
      <div style={{ fontSize: 11, color: "rgba(232,201,138,0.55)", marginTop: 6, lineHeight: 1.7 }}>
        אירוע אחרון מ-EZGO: {fmtRelative(health.lastEventAt)}{health.lastEntity ? ` (${ENTITY_LABELS[health.lastEntity] ?? health.lastEntity})` : ""}
        {" · "}עובדו ב-24 שעות אחרונות: {health.parsed24h}
      </div>
    </div>
  );
}

// ── Therapist mapping — order-number lookup ────────────────────────────────
// EZGO never sends a therapist name, only Activities.Timing.Worker.WorkerId,
// scoped to whichever Order the treatment was booked under. Staff already
// knows which order/guest a given therapist treated (they set it up in
// EZGO), so instead of scanning a global "WorkerId seen somewhere" queue and
// guessing, they type the order number they already have and we resolve its
// treatments directly.

function parseOrderActivities(rows) {
  // Same ItemId+Index pair gets re-emitted every time staff edits that
  // treatment line in EZGO (date change, worker reassignment, cancel) — take
  // the latest snapshot per pair (rows arrive newest-first) and drop
  // inactive/unassigned ones, mirroring how ezgo-guest-sync dedupes
  // Reservations lines by lineId + skips status=0.
  const byKey = new Map();
  for (const row of rows) {
    const rp = row.raw_payload || {};
    let inner;
    try {
      inner = typeof rp.Value === "string" ? JSON.parse(rp.Value) : null;
    } catch {
      continue;
    }
    const timing = inner && inner.Timing;
    if (!timing) continue;
    const key = `${rp.ItemId}:${timing.Index ?? 0}`;
    if (byKey.has(key)) continue; // rows are newest-first — first hit wins
    byKey.set(key, {
      key,
      status: timing.Status,
      workerId: timing.Worker && typeof timing.Worker.WorkerId === "number" ? timing.Worker.WorkerId : null,
      guestName: timing.Guest ? String(timing.Guest).trim() : "",
      start: timing.Start || "",
      end: timing.End || "",
    });
  }
  return [...byKey.values()].filter((a) => a.status === 1 && a.workerId);
}

function OrderActivityLookup({ therapists, onMapped, showToast }) {
  const [orderId, setOrderId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { activities: [] } | { errorMsg }
  const [choice, setChoice] = useState({});

  const unmappedTherapists = therapists.filter((t) => t.ezgo_worker_id == null);
  const therapistByWorkerId = new Map(
    therapists.filter((t) => t.ezgo_worker_id != null).map((t) => [t.ezgo_worker_id, t]),
  );

  async function handleLookup() {
    const trimmed = orderId.trim();
    if (!trimmed) return;
    setLoading(true);
    setResult(null);
    setChoice({});
    const { data, error } = await supabase
      .from("ezgo_api_ingest")
      .select("raw_payload")
      .eq("raw_payload->>Entity", "Activities")
      .eq("raw_payload->>OrderId", trimmed)
      .order("created_at", { ascending: false })
      .limit(500);
    setLoading(false);
    if (error) {
      setResult({ errorMsg: `השליפה נכשלה: ${error.message}` });
      return;
    }
    if (!data || !data.length) {
      setResult({
        errorMsg: `לא נמצאו טיפולים (Activities) עבור הזמנה מס' ${trimmed}. ייתכן שההזמנה לא כוללת טיפול ספא, או שהמידע טרם התקבל מ-EZGO (המידע נשמר כ-3 ימים אחורה בלבד).`,
      });
      return;
    }
    const activities = parseOrderActivities(data);
    if (!activities.length) {
      setResult({
        errorMsg: `נמצאו רישומים להזמנה מס' ${trimmed}, אך אף אחד מהם אינו טיפול פעיל עם מטפל/ת משויכ/ת ב-EZGO (בוטל / טרם שובץ מטפל/ת).`,
      });
      return;
    }
    setResult({ activities });
  }

  async function handleAssign(activity) {
    const therapistId = choice[activity.key];
    if (!therapistId) return;
    const { error } = await supabase
      .from("spa_therapists")
      .update({ ezgo_worker_id: activity.workerId })
      .eq("id", Number(therapistId));
    if (error) {
      showToast(`שגיאה בשיוך מטפל/ת: ${error.message}`, "err");
      return;
    }
    showToast(`✓ WorkerId ${activity.workerId} שויך`);
    onMapped();
  }

  return (
    <div style={cardBoxStyle}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "rgba(232,201,138,0.9)", marginBottom: 8 }}>
        🔍 חיפוש לפי מספר הזמנה
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          inputMode="numeric"
          placeholder="מספר הזמנה EZGO"
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLookup()}
          style={inputStyle}
        />
        <ConfirmButton disabled={!orderId.trim()} onClick={handleLookup}>
          {loading ? "מחפש..." : "חפש טיפולים"}
        </ConfirmButton>
      </div>

      {result?.errorMsg && <div style={warnBoxStyle}>⚠ {result.errorMsg}</div>}

      {!!result?.activities?.length && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          {result.activities.map((a) => {
            const already = therapistByWorkerId.get(a.workerId);
            return (
              <div key={a.key} style={rowStyle}>
                <div style={{ fontSize: 13, color: "rgba(232,201,138,0.85)" }}>
                  <strong>{a.guestName || "טיפול"}</strong>
                  <span style={{ color: "rgba(232,201,138,0.5)" }}> · {fmtActivityTime(a.start, a.end)}</span>
                  <span style={{ color: "rgba(232,201,138,0.5)" }}> · WorkerId {a.workerId}</span>
                </div>
                {already ? (
                  <div style={{ fontSize: 12, color: "#86efac" }}>כבר משויך ל: {already.name}</div>
                ) : (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select
                      style={selectStyle}
                      value={choice[a.key] ?? ""}
                      onChange={(e) => setChoice((prev) => ({ ...prev, [a.key]: e.target.value }))}
                    >
                      <option value="">— בחר/י מטפל/ת —</option>
                      {unmappedTherapists.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}{t.active ? "" : " (לא פעיל/ה)"}</option>
                      ))}
                    </select>
                    <ConfirmButton disabled={!choice[a.key]} onClick={() => handleAssign(a)}>
                      ✓ שייך
                    </ConfirmButton>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WorkerMappingSection({ showToast }) {
  const [therapists, setTherapists] = useState([]);
  const [seenMap, setSeenMap] = useState(new Map());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data, error }, { data: seen, error: seenErr }] = await Promise.all([
      supabase.from("spa_therapists").select("id, name, active, ezgo_worker_id").order("name"),
      supabase.from("ezgo_worker_ids_seen").select("*"),
    ]);
    if (error) console.error("[EzgoApiCodeMappingPanel] spa_therapists:", error.message);
    if (seenErr) console.error("[EzgoApiCodeMappingPanel] ezgo_worker_ids_seen:", seenErr.message);
    setTherapists(data ?? []);
    setSeenMap(new Map((seen ?? []).map((r) => [r.ezgo_worker_id, r])));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleClear(t) {
    const { error } = await supabase.from("spa_therapists").update({ ezgo_worker_id: null }).eq("id", t.id);
    if (error) {
      showToast(`שגיאה בביטול שיוך: ${error.message}`, "err");
      return;
    }
    showToast(`שיוך ${t.name} בוטל`);
    load();
  }

  if (loading) return <div style={{ fontSize: 13, color: "rgba(232,201,138,0.6)" }}>טוען...</div>;

  const mapped = therapists.filter((t) => t.ezgo_worker_id != null);

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: "var(--gold-light)", marginBottom: 6 }}>
        👤 מיפוי מטפלים — EZGO WorkerId ({mapped.length}/{therapists.length} ממופים)
      </div>
      <div style={{ fontSize: 12, color: "rgba(232,201,138,0.6)", marginBottom: 10 }}>
        ה-API של EZGO לא שולח שם מטפל/ת, רק מספר פנימי. הזן/י את מספר ההזמנה מ-EZGO — נציג את הטיפולים שבה ואת ה-WorkerId שלהם, ותוכל/י לשייך למטפל/ת מהרשימה שלנו פעם אחת. מכאן זה יזוהה אוטומטית.
      </div>

      <OrderActivityLookup therapists={therapists} onMapped={load} showToast={showToast} />

      <div style={{ fontSize: 13, fontWeight: 800, color: "rgba(232,201,138,0.9)", marginBottom: 8 }}>
        מטפלים משויכים ({mapped.length})
      </div>
      {!mapped.length ? (
        <div style={{ fontSize: 13, color: "rgba(232,201,138,0.5)" }}>אין עדיין מטפל/ת משויכ/ת.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {mapped.map((t) => {
            const seenRow = seenMap.get(t.ezgo_worker_id);
            return (
              <div key={t.id} style={rowStyle}>
                <div style={{ fontSize: 13, color: "rgba(232,201,138,0.85)" }}>
                  <strong>{t.name}</strong>{t.active ? "" : " (לא פעיל/ה)"}
                  <span style={{ color: "rgba(232,201,138,0.5)" }}> · WorkerId {t.ezgo_worker_id}</span>
                  <div style={{ fontSize: 11, color: "rgba(232,201,138,0.55)", marginTop: 4 }}>
                    {seenRow?.sample_order_id
                      ? `לאימות: הזמנה #${seenRow.sample_order_id} · נצפה ${seenRow.event_count} פעמים · לאחרונה ${fmtTimestamp(seenRow.last_seen_at)}`
                      : "אין אירוע חי לדוגמה עדיין — לא נצפה ב-API."}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => handleClear(t)}
                  title="מסיר את השיוך — WorkerId יחזור להיות פנוי לשיוך מחדש"
                  style={{ fontSize: 11 }}
                >
                  בטל שיוך
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Room mapping ────────────────────────────────────────────────────────────

function RoomMappingSection({ showToast }) {
  const [rows, setRows] = useState([]);
  const [seenMap, setSeenMap] = useState(new Map());
  const [mapped, setMapped] = useState([]);
  const [choice, setChoice] = useState({});
  const [edit, setEdit] = useState({});
  const [loading, setLoading] = useState(true);
  const [addRoomId, setAddRoomId] = useState("");
  const [addSuite, setAddSuite] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: seen, error: seenErr }, { data: mp, error: mpErr }] = await Promise.all([
      supabase.from("ezgo_room_ids_seen").select("*").order("event_count", { ascending: false }),
      supabase.from("ezgo_suite_room_map").select("*"),
    ]);
    if (seenErr) console.error("[EzgoApiCodeMappingPanel] ezgo_room_ids_seen:", seenErr.message);
    if (mpErr) console.error("[EzgoApiCodeMappingPanel] ezgo_suite_room_map:", mpErr.message);
    const mappedIds = new Set((mp ?? []).map((m) => m.ezgo_room_id));
    setRows((seen ?? []).filter((r) => !mappedIds.has(r.ezgo_room_id)));
    setSeenMap(new Map((seen ?? []).map((r) => [r.ezgo_room_id, r])));
    setMapped(mp ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAssign(row) {
    const suiteName = choice[row.ezgo_room_id];
    if (!suiteName) return;
    const { error } = await supabase
      .from("ezgo_suite_room_map")
      .insert({ ezgo_room_id: row.ezgo_room_id, suite_name: suiteName, matched_via: "staff_verified" });
    if (error) {
      showToast(`שגיאה בשיוך חדר: ${error.message}`, "err");
      return;
    }
    showToast(`✓ RoomId ${row.ezgo_room_id} אושר → ${suiteName}`);
    load();
  }

  async function handleConfirmMapped(row) {
    const suiteName = edit[row.ezgo_room_id] || row.suite_name;
    const { error } = await supabase
      .from("ezgo_suite_room_map")
      .update({ suite_name: suiteName, matched_via: "staff_verified" })
      .eq("ezgo_room_id", row.ezgo_room_id);
    if (error) {
      showToast(`שגיאה באישור חדר: ${error.message}`, "err");
      return;
    }
    showToast(`✓ RoomId ${row.ezgo_room_id} אושר → ${suiteName}`);
    load();
  }

  async function handleClearMapped(row) {
    const { error } = await supabase
      .from("ezgo_suite_room_map")
      .delete()
      .eq("ezgo_room_id", row.ezgo_room_id);
    if (error) {
      showToast(`שגיאה בביטול שיוך: ${error.message}`, "err");
      return;
    }
    showToast(`שיוך RoomId ${row.ezgo_room_id} בוטל — חזר לתור ממתין`);
    load();
  }

  async function handleManualAdd() {
    const trimmed = addRoomId.trim();
    const idNum = Number(trimmed);
    if (!trimmed || !Number.isInteger(idNum) || idNum <= 0) {
      showToast("RoomId=0 אסור — 0 פירושו שטרם שובץ חדר פיזי ב-EZGO. יש להזין מספר חדר אמיתי מרשימת היחידות ב-EZGO.", "err");
      return;
    }
    if (!addSuite) {
      showToast("יש לבחור סוויטה / Premium Day.", "err");
      return;
    }
    if (mapped.some((m) => m.ezgo_room_id === idNum)) {
      showToast(`RoomId ${idNum} כבר משויך — לערוך אותו אפשר ברשימה למטה.`, "err");
      return;
    }
    const { error } = await supabase
      .from("ezgo_suite_room_map")
      .insert({ ezgo_room_id: idNum, suite_name: addSuite, matched_via: "staff_verified" });
    if (error) {
      showToast(`שגיאה בהוספה: ${error.message}`, "err");
      return;
    }
    showToast(`✓ RoomId ${idNum} נוסף → ${addSuite}`);
    setAddRoomId("");
    setAddSuite("");
    load();
  }

  if (loading) return <div style={{ fontSize: 13, color: "rgba(232,201,138,0.6)" }}>טוען...</div>;

  const trusted = mapped.filter((m) => isTrustedMatch(m.matched_via));
  const untrusted = mapped.filter((m) => !isTrustedMatch(m.matched_via));
  const sortedMapped = [...mapped].sort((a, b) => {
    const trustDelta = Number(isTrustedMatch(a.matched_via)) - Number(isTrustedMatch(b.matched_via));
    if (trustDelta !== 0) return trustDelta;
    return a.ezgo_room_id - b.ezgo_room_id;
  });

  const mappedSuiteNames = new Set(mapped.map((m) => m.suite_name));
  const missingUnits = TARGET_UNITS.filter((name) => !mappedSuiteNames.has(name));
  const coverage = TARGET_UNITS.length - missingUnits.length;

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 800, color: "var(--gold-light)", marginBottom: 6 }}>
        🏠 מיפוי חדרים — EZGO RoomId ({rows.length} ממתינים · {mapped.length} משויכים · יחידות {coverage}/{TARGET_UNITS.length})
      </div>
      <div style={{ fontSize: 12, color: "rgba(232,201,138,0.75)", marginBottom: 10, lineHeight: 1.6 }}>
        {untrusted.length
          ? `⚠ ${untrusted.length} שיוכים לא ודאיים — אשר מול רשימת היחידות ב-EZGO (לא מול הזמנה עם 2 חדרים). `
          : "כל השיוכים הקיימים אושרו. "}
        מאומתים: {trusted.length}. RoomId=0 אסור לשיוך (חדר טרם שובץ ב-EZGO).
      </div>
      {!!missingUnits.length && (
        <div style={warnBoxStyle}>
          ⚠ חסרות {missingUnits.length} יחידות ללא RoomId משויך: {missingUnits.join(", ")}
        </div>
      )}

      <div style={cardBoxStyle}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "rgba(232,201,138,0.9)", marginBottom: 8 }}>
          ➕ הוספת שיוך ידני
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            inputMode="numeric"
            placeholder="RoomId מ-EZGO"
            value={addRoomId}
            onChange={(e) => setAddRoomId(e.target.value)}
            style={inputStyle}
          />
          <select style={selectStyle} value={addSuite} onChange={(e) => setAddSuite(e.target.value)}>
            <option value="">— בחר/י יחידה —</option>
            {SUITE_DROPDOWN_OPTIONS.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <ConfirmButton disabled={!addRoomId.trim() || !addSuite} onClick={handleManualAdd}>
            ✓ הוסף שיוך
          </ConfirmButton>
        </div>
      </div>

      {!!mapped.length && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "rgba(232,201,138,0.9)", marginBottom: 8 }}>
            שיוכים קיימים — לא ודאיים למעלה
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sortedMapped.map((m) => {
              const trustedRow = isTrustedMatch(m.matched_via);
              const hint = sampleOrderHint(seenMap.get(m.ezgo_room_id));
              return (
                <div
                  key={m.ezgo_room_id}
                  style={{
                    ...rowStyle,
                    borderColor: trustedRow ? "rgba(34,197,94,0.45)" : "rgba(245,158,11,0.55)",
                  }}
                >
                  <div style={{ fontSize: 13, color: "rgba(232,201,138,0.85)" }}>
                    <strong>RoomId {m.ezgo_room_id}</strong>
                    <span> → {m.suite_name}</span>
                    <div style={{ fontSize: 11, color: trustedRow ? "#86efac" : "#fbbf24", marginTop: 4 }}>
                      {MATCHED_VIA_LABELS[m.matched_via] ?? m.matched_via}
                    </div>
                    <div style={{ fontSize: 11, color: hint.warn ? "#fbbf24" : "rgba(232,201,138,0.55)", marginTop: 2 }}>
                      {hint.text}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <select
                      style={selectStyle}
                      value={edit[m.ezgo_room_id] ?? m.suite_name}
                      onChange={(e) => setEdit((prev) => ({ ...prev, [m.ezgo_room_id]: e.target.value }))}
                    >
                      {SUITE_DROPDOWN_OPTIONS.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                    <ConfirmButton onClick={() => handleConfirmMapped(m)}>
                      {trustedRow ? "✓ עדכן" : "✓ אשר נכון"}
                    </ConfirmButton>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => handleClearMapped(m)}
                      title="מחזיר את הקוד לתור הממתינים"
                      style={{ fontSize: 11 }}
                    >
                      בטל שיוך
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ fontSize: 13, fontWeight: 800, color: "rgba(232,201,138,0.9)", marginBottom: 8 }}>
        ממתינים לשיוך
      </div>
      {!rows.length ? (
        <div style={{ fontSize: 13, color: "rgba(232,201,138,0.5)" }}>אין קודים ממתינים לשיוך כרגע.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((row) => {
            const multi = Number(row.sample_order_room_count) > 1;
            return (
              <div key={row.ezgo_room_id} style={rowStyle}>
                <div style={{ fontSize: 13, color: "rgba(232,201,138,0.85)" }}>
                  <strong>RoomId {row.ezgo_room_id}</strong>
                  <span style={{ color: "rgba(232,201,138,0.5)" }}>
                    {" "}· נצפה {row.event_count} פעמים · לאחרונה {fmtTimestamp(row.last_seen_at)}
                  </span>
                  {row.sample_order_id ? (
                    <div style={{ fontSize: 11, marginTop: 4, color: multi ? "#fbbf24" : "rgba(232,201,138,0.55)" }}>
                      {multi
                        ? `⚠ הזמנה #${row.sample_order_id} כוללת ${row.sample_order_room_count} חדרים — אל תשייך לפיה. קח את המספר מרשימת היחידות ב-EZGO.`
                        : `הזמנה עם חדר אחד #${row.sample_order_id} — אפשר לפתוח ב-EZGO ולאשר את שם הסוויטה.`}
                    </div>
                  ) : null}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <select
                    style={selectStyle}
                    value={choice[row.ezgo_room_id] ?? ""}
                    onChange={(e) => setChoice((prev) => ({ ...prev, [row.ezgo_room_id]: e.target.value }))}
                  >
                    <option value="">— בחר/י סוויטה —</option>
                    {SUITE_DROPDOWN_OPTIONS.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                  <ConfirmButton disabled={!choice[row.ezgo_room_id]} onClick={() => handleAssign(row)}>
                    ✓ אשר מול EZGO
                  </ConfirmButton>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function EzgoApiCodeMappingPanel({ showToast }) {
  const notify = showToast ?? (() => {});
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: "var(--gold-light)", marginBottom: 4 }}>
        🔌 EZGO API — מיפוי קודים חד-פעמי
      </div>
      <div style={{ fontSize: 12, color: "rgba(232,201,138,0.6)", marginBottom: 16 }}>
        שיוך RoomId חייב להיות מאומת. הסקה אוטומטית לא נחשבת נכונה עד שתלחץ «אשר נכון».
      </div>
      <SyncHealthCard />
      <WorkerMappingSection showToast={notify} />
      <RoomMappingSection showToast={notify} />
    </div>
  );
}
