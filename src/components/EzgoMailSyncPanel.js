// EzgoMailSyncPanel — review + apply EZGO mail import lines (Doc1).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { buildDoc1EnrichmentPatch } from "../utils/guestImportIntelligence";

function patchLabels(patch) {
  const labels = [];
  if (patch.spa_time) labels.push(`ספא ${patch.spa_time}`);
  if (patch.spa_date) labels.push(`תאריך ספא ${patch.spa_date}`);
  if (patch.meal_location) labels.push(patch.meal_location);
  if (patch.meal_time) labels.push(`ארוחה ${patch.meal_time}`);
  if (patch.order_number) labels.push(`הזמנה ${patch.order_number}`);
  if (patch.treatment_count) labels.push(`טיפולים: ${patch.treatment_count}`);
  return labels;
}

function actionBadge(action) {
  const map = {
    enrich: { text: "העשרה", color: "#1E40AF", bg: "#DBEAFE" },
    no_match: { text: "אין פרופיל", color: "#92400E", bg: "#FEF3C7" },
    conflict: { text: "בדוק", color: "#A32D2D", bg: "#FCEBEB" },
    skip: { text: "דלג", color: "#666", bg: "#eee" },
  };
  return map[action] || map.enrich;
}

export default function EzgoMailSyncPanel({ showToast }) {
  const [ingests, setIngests] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadIngests = useCallback(async () => {
    const { data, error } = await supabase
      .from("ezgo_mail_ingest")
      .select("*")
      .in("parse_status", ["parsed", "failed", "skipped"])
      .order("received_at", { ascending: false })
      .limit(30);
    if (error) {
      showToast?.(error.message, "err");
      return;
    }
    setIngests(data ?? []);
    if (!selectedId && data?.length) setSelectedId(data[0].id);
  }, [selectedId, showToast]);

  const loadLines = useCallback(async (ingestId) => {
    if (!ingestId) { setLines([]); return; }
    const { data, error } = await supabase
      .from("ezgo_mail_import_lines")
      .select("*, guests!match_guest_id(id, name, room, phone, order_number)")
      .eq("ingest_id", ingestId)
      .order("line_index", { ascending: true });
    if (error) {
      showToast?.(error.message, "err");
      return;
    }
    setLines(data ?? []);
  }, [showToast]);

  useEffect(() => { loadIngests(); }, [loadIngests]);
  useEffect(() => { loadLines(selectedId); }, [selectedId, loadLines]);

  const triggerSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("ezgo-mail-sync");
      if (error) throw error;
      if (!data?.ok && !data?.skipped) throw new Error(data?.error || "סנכרון נכשל");
      const imap = data?.imap;
      const msg = data?.skipped
        ? "סנכרון מייל כבוי (EZGO_MAIL_SYNC_ENABLED)"
        : (data.scanned ?? 0) === 0 && imap
          ? `נסרקו 0 · תיבה ${imap.mailboxTotal} · נבדקו ${imap.scannedRaw} (${imap.searchMethod})`
          : `נסרקו ${data.scanned ?? 0} מיילים · חדשים ${data.processed ?? 0}`;
      showToast?.(msg, "ok");
      await loadIngests();
    } catch (e) {
      showToast?.(e.message, "err");
    } finally {
      setSyncing(false);
    }
  };

  const applyLine = async (line) => {
    if (!line.match_guest_id || line.action === "no_match") {
      showToast?.("אין פרופיל לעדכון — ייבא Doc2 או צור אורח ידנית", "err");
      return;
    }
    const patch = line.proposed_patch || {};
    if (!Object.keys(patch).length) {
      await supabase.from("ezgo_mail_import_lines").update({ status: "skipped" }).eq("id", line.id);
      showToast?.("אין שדות חדשים — דולג", "ok");
      await loadLines(selectedId);
      return;
    }

    setBusy(true);
    try {
      const { data: guest, error: gErr } = await supabase
        .from("guests")
        .select("id, name, phone, order_number, arrival_date, spa_time, spa_date, meal_time, meal_location, treatment_count")
        .eq("id", line.match_guest_id)
        .maybeSingle();
      if (gErr || !guest) throw gErr || new Error("אורח לא נמצא");

      const safePatch = buildDoc1EnrichmentPatch(line.parsed_json, guest);
      if (!Object.keys(safePatch).length) {
        await supabase.from("ezgo_mail_import_lines").update({ status: "skipped" }).eq("id", line.id);
        showToast?.("אין שדות חדשים", "ok");
        await loadLines(selectedId);
        return;
      }

      const { error: upErr } = await supabase.from("guests").update(safePatch).eq("id", guest.id);
      if (upErr) throw upErr;

      await supabase.from("ezgo_mail_import_lines").update({
        status: "applied",
        applied_at: new Date().toISOString(),
        proposed_patch: safePatch,
      }).eq("id", line.id);

      showToast?.(`עודכן: ${guest.name}`, "ok");
      await loadLines(selectedId);
      await loadIngests();
    } catch (e) {
      showToast?.(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const rejectLine = async (line) => {
    await supabase.from("ezgo_mail_import_lines").update({ status: "rejected" }).eq("id", line.id);
    await loadLines(selectedId);
  };

  const applyAllSafe = async () => {
    const pending = lines.filter(
      (l) => l.status === "pending_review"
        && l.match_guest_id
        && l.match_method === "order"
        && Object.keys(l.proposed_patch || {}).length > 0,
    );
    if (!pending.length) {
      showToast?.("אין שורות בטוחות לאישור אוטומטי", "err");
      return;
    }
    setBusy(true);
    let ok = 0;
    for (const line of pending) {
      try {
        await applyLine(line);
        ok += 1;
      } catch { /* continue */ }
    }
    setBusy(false);
    showToast?.(`אושרו ${ok} שורות`, "ok");
  };

  const selected = ingests.find((i) => i.id === selectedId);
  const pendingCount = lines.filter((l) => l.status === "pending_review").length;

  return (
    <div style={{ marginTop: 28, direction: "rtl", fontFamily: "Heebo, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: "var(--gold-light)" }}>
          📧 סנכרון ממייל EZGO
        </div>
        <button
          type="button"
          onClick={triggerSync}
          disabled={syncing}
          style={{
            marginRight: "auto", padding: "8px 14px", borderRadius: 8, border: "none",
            background: "var(--gold,#C9A96E)", color: "#fff", fontWeight: 700, cursor: syncing ? "wait" : "pointer",
          }}
        >
          {syncing ? "סורק תיבה…" : "🔄 סרוק מייל עכשיו"}
        </button>
      </div>

      <div style={{
        fontSize: 12, color: "rgba(232,201,138,0.65)", marginBottom: 14,
        padding: "10px 12px", borderRadius: 8, background: "rgba(0,0,0,0.2)",
        border: "1px solid rgba(201,169,110,0.2)",
      }}>
        הגר או צלם נדלן שולחים דוח תפעול (Doc1) ל־promote7il → לחצי «סרוק מייל» או המתיני ל-cron.
        כל שורה דורשת אישור לפני עדכון פרופיל. מיפוי: מס׳ הזמנה → טלפון.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) 2fr", gap: 14 }}>
        <div style={{ border: "1px solid rgba(201,169,110,0.25)", borderRadius: 12, padding: 10, maxHeight: 420, overflowY: "auto" }}>
          {ingests.length === 0 && (
            <div style={{ fontSize: 13, color: "#888", padding: 8 }}>אין מיילים ממתינים</div>
          )}
          {ingests.map((ing) => (
            <button
              key={ing.id}
              type="button"
              onClick={() => setSelectedId(ing.id)}
              style={{
                display: "block", width: "100%", textAlign: "right", marginBottom: 8,
                padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                border: selectedId === ing.id ? "1px solid var(--gold)" : "1px solid rgba(201,169,110,0.2)",
                background: selectedId === ing.id ? "rgba(201,169,110,0.12)" : "rgba(0,0,0,0.15)",
                color: "var(--gold-light)",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13 }}>{ing.subject || "(ללא נושא)"}</div>
              <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4 }}>
                {ing.from_email} · {ing.report_date_ymd || "—"} · {ing.line_count} שורות
              </div>
              <div style={{ fontSize: 10, marginTop: 4, opacity: 0.65 }}>{ing.parse_status}</div>
            </button>
          ))}
        </div>

        <div style={{ border: "1px solid rgba(201,169,110,0.25)", borderRadius: 12, padding: 12 }}>
          {selected ? (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
                <strong style={{ color: "var(--gold-light)" }}>{selected.subject}</strong>
                <span style={{ fontSize: 12, color: "#888" }}>
                  {pendingCount} ממתינות לאישור
                </span>
                <button
                  type="button"
                  disabled={busy || !pendingCount}
                  onClick={applyAllSafe}
                  style={{
                    marginRight: "auto", padding: "6px 12px", borderRadius: 8, border: "none",
                    background: pendingCount ? "#3B6D11" : "#ccc", color: "#fff", fontWeight: 700, fontSize: 12,
                    cursor: busy ? "wait" : "pointer",
                  }}
                >
                  אשר הכל (מס׳ הזמנה בלבד)
                </button>
              </div>

              <div style={{ maxHeight: 360, overflowY: "auto" }}>
                {lines.map((line) => {
                  const rec = line.parsed_json || {};
                  const badge = actionBadge(line.action);
                  const labels = patchLabels(line.proposed_patch || {});
                  const done = line.status === "applied" || line.status === "rejected" || line.status === "skipped";

                  return (
                    <div
                      key={line.id}
                      style={{
                        border: "1px solid rgba(201,169,110,0.2)", borderRadius: 10,
                        padding: "10px 12px", marginBottom: 10, background: "rgba(0,0,0,0.12)",
                        opacity: done ? 0.65 : 1,
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                          background: badge.bg, color: badge.color,
                        }}>
                          {badge.text}
                        </span>
                        <strong style={{ fontSize: 14 }}>
                          {rec.guest_name || "—"}
                          {rec.order_number ? ` · #${rec.order_number}` : ""}
                        </strong>
                        {rec.phone && <span style={{ fontSize: 12, color: "#aaa" }}>{rec.phone}</span>}
                        {line.status !== "pending_review" && (
                          <span style={{ fontSize: 11, color: "#888" }}>{line.status}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "#bbb", marginTop: 6 }}>
                        {line.match_label}
                        {line.guests?.room ? ` · ${line.guests.room}` : ""}
                      </div>
                      {labels.length > 0 && (
                        <div style={{ fontSize: 12, marginTop: 6, color: "var(--gold-light)" }}>
                          יתווסף: {labels.join(" · ")}
                        </div>
                      )}
                      {line.status === "pending_review" && (
                        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                          <button
                            type="button"
                            disabled={busy || line.action === "no_match"}
                            onClick={() => applyLine(line)}
                            style={{
                              padding: "6px 12px", borderRadius: 8, border: "none",
                              background: line.action === "no_match" ? "#ccc" : "var(--gold)",
                              color: "#fff", fontWeight: 700, fontSize: 12, cursor: busy ? "wait" : "pointer",
                            }}
                          >
                            ✓ אשר
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => rejectLine(line)}
                            style={{
                              padding: "6px 12px", borderRadius: 8,
                              border: "1px solid rgba(201,169,110,0.4)",
                              background: "transparent", color: "#ccc", fontSize: 12, cursor: "pointer",
                            }}
                          >
                            ✗ דלג
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: "#888" }}>בחר מייל מהרשימה</div>
          )}
        </div>
      </div>
    </div>
  );
}
