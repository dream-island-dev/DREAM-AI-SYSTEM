// EzgoMailSyncPanel — review + apply EZGO mail import lines (Doc1).
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import SpaUpsellConfirmModal from "./SpaUpsellConfirmModal";
import { buildDoc1EnrichmentPatch } from "../utils/guestImportIntelligence";
import {
  WORKFLOW_META,
  createDaypassGuestFromRec,
  resolveLineWorkflow,
  stripWorkflowPatch,
} from "../utils/ezgoMailLineWorkflow";
import {
  DOC2_WORKFLOW_META,
  DOC2_WORKFLOW_SECTIONS,
  buildDoc2EnrichmentPatch,
  createDoc2LineFromRec,
  resolveDoc2LineWorkflow,
} from "../utils/ezgoDoc2MailLineWorkflow";
import { applyDoc2SuiteRoomAdd, findGuestForDoc2SuiteCreate } from "../utils/ezgoDoc2SuiteRoomSync";
import {
  fetchSpaUpsellDispatchMeta,
  scheduleSpaUpsellTasks,
  sendSpaUpsellBatch,
  SPA_UPSELL_SEND_PULSE_MS,
} from "../utils/spaUpsellDispatch";

const WORKFLOW_SECTIONS = [
  { id: "suite_spa_sync", title: "🛏️ סנכרון שעות ספא — סוויטות", hint: "מזהה: מס׳ הזמנה → פרופיל סוויטה" },
  { id: "daypass_upsell", title: "💆 הצעת ספא — בילוי יומי ללא טיפול", hint: "מזהה: guests.id · אחרי אישור עבור ללשונית הצעת ספא" },
  { id: "daypass_create_spa", title: "☀️ צור בילוי יומי + ספא", hint: "מזהה: טלפון + תאריך דוח · אין פרופיל ב-DB" },
  { id: "daypass_create", title: "☀️ צור בילוי יומי (ללא ספא)", hint: "מזהה: טלפון · לאחר יצירה → הצעת ספא" },
  { id: "other", title: "📋 אחר", hint: "העשרה / בדיקה / ללא שינוי" },
];

function patchLabels(patch) {
  const clean = stripWorkflowPatch(patch || {});
  const labels = [];
  if (clean.spa_time) labels.push(`ספא ${clean.spa_time}`);
  if (clean.spa_date) labels.push(`תאריך ספא ${clean.spa_date}`);
  if (clean.meal_location) labels.push(clean.meal_location);
  if (clean.meal_time) labels.push(`ארוחה ${clean.meal_time}`);
  if (clean.order_number) labels.push(`הזמנה ${clean.order_number}`);
  if (clean.treatment_count) labels.push(`טיפולים: ${clean.treatment_count}`);
  return labels;
}

function workflowBadge(workflow, isDoc2) {
  if (isDoc2) return DOC2_WORKFLOW_META[workflow] || DOC2_WORKFLOW_META.noop;
  return WORKFLOW_META[workflow] || WORKFLOW_META.enrich;
}

function lineWorkflow(line, reportDate, isDoc2) {
  return isDoc2
    ? resolveDoc2LineWorkflow(line, reportDate)
    : resolveLineWorkflow(line, reportDate);
}

function guestTargetFromLine(line) {
  if (!line?.match_guest_id) return null;
  const g = line.guests;
  return {
    id: line.match_guest_id,
    name: g?.name ?? line.parsed_json?.guest_name ?? null,
    phone: g?.phone ?? line.parsed_json?.phone ?? null,
  };
}

const BTN = {
  approve: {
    padding: "4px 10px", borderRadius: 8, border: "none",
    background: "var(--gold)", color: "#fff", fontWeight: 700, fontSize: 11,
  },
  create: {
    padding: "4px 10px", borderRadius: 8, border: "none",
    background: "#0e7490", color: "#fff", fontWeight: 700, fontSize: 11,
  },
  createSend: {
    padding: "4px 10px", borderRadius: 8, border: "none",
    background: "#155E75", color: "#fff", fontWeight: 700, fontSize: 11,
  },
  upsell: {
    padding: "4px 10px", borderRadius: 8, border: "none",
    background: "#A21CAF", color: "#fff", fontWeight: 700, fontSize: 11,
  },
  skip: {
    padding: "4px 10px", borderRadius: 8,
    border: "1px solid rgba(201,169,110,0.4)",
    background: "transparent", color: "#ccc", fontSize: 11,
  },
};

function LineCard({
  line, reportDate, busy, onApply, onCreate, onCreateAndUpsell, onReject, onUpsell, isDoc2,
}) {
  const rec = line.parsed_json || {};
  const workflow = lineWorkflow(line, reportDate, isDoc2);
  const badge = workflowBadge(workflow, isDoc2);
  const labels = patchLabels(line.proposed_patch || {});
  const done = ["applied", "rejected", "skipped"].includes(line.status);
  const isCreate = line.action === "create"
    || workflow.startsWith("daypass_create")
    || workflow === "suite_arrival_create";
  const isUpsell = workflow === "daypass_upsell";
  const canUpsell = isUpsell && line.match_guest_id;
  const canCreateSend = workflow === "daypass_create" && rec.phone;
  const canCreateProfile = (isCreate || (isUpsell && rec.phone))
    && line.action !== "no_match"
    && workflow !== "conflict";
  const canApprove = !isCreate && !isUpsell
    && line.action !== "no_match"
    && workflow !== "noop"
    && workflow !== "conflict"
    && line.match_guest_id;

  return (
    <div
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
        <strong style={{ fontSize: 14, color: "#E8C98A" }}>
          {rec.guest_name || "—"}
          {rec.order_number ? ` · #${rec.order_number}` : ""}
        </strong>
        {rec.phone && <span style={{ fontSize: 12, color: "#aaa" }}>{rec.phone}</span>}
        {(rec.room || rec.room_raw) && (
          <span style={{ fontSize: 11, color: "#c4b5fd" }}>
            {rec.room || rec.room_raw}
            {rec.nights ? ` · ${rec.nights} לילות` : ""}
          </span>
        )}
        {rec.spa_time && (
          <span style={{ fontSize: 11, color: "#7dd3fc" }}>ספא {rec.spa_time}</span>
        )}
        {line.status !== "pending_review" && (
          <span style={{ fontSize: 11, color: "#888" }}>{line.status}</span>
        )}

        {line.status === "pending_review" && (
          <div style={{ marginRight: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {canApprove && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onApply(line)}
                style={{ ...BTN.approve, cursor: busy ? "wait" : "pointer" }}
              >
                ✓ אשר
              </button>
            )}
            {canUpsell && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onUpsell(line)}
                style={{ ...BTN.upsell, cursor: busy ? "wait" : "pointer" }}
              >
                💆 שלח הצעת ספא
              </button>
            )}
            {canCreateProfile && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onCreate(line)}
                title={isUpsell && line.match_guest_id
                  ? "פרופיל קיים — סמן כטופל בלי לשלוח הצעת ספא"
                  : "צור פרופיל בילוי יומי מהדוח — בלי שליחת הצעת ספא"}
                style={{ ...BTN.create, cursor: busy ? "wait" : "pointer" }}
              >
                {isUpsell && line.match_guest_id ? "✓ ללא שליחה" : "☀️ צור פרופיל"}
              </button>
            )}
            {canCreateSend && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onCreateAndUpsell(line)}
                style={{ ...BTN.createSend, cursor: busy ? "wait" : "pointer" }}
              >
                ☀️💆 צור + שלח
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => onReject(line)}
              style={{ ...BTN.skip, cursor: busy ? "wait" : "pointer" }}
            >
              ✗ דלג
            </button>
          </div>
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
    </div>
  );
}

export default function EzgoMailSyncPanel({ showToast, onSpaUpsellNavigate }) {
  const [ingests, setIngests] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [upsellModal, setUpsellModal] = useState(null);
  const [scriptText, setScriptText] = useState("");
  const [metaTemplateStatus, setMetaTemplateStatus] = useState(null);
  const [upsellSending, setUpsellSending] = useState(false);
  const [upsellProgress, setUpsellProgress] = useState(null);

  const loadIngests = useCallback(async () => {
    const { data, error } = await supabase
      .from("ezgo_mail_ingest")
      .select("*")
      .in("parse_status", ["parsed", "failed", "skipped"])
      .order("received_at", { ascending: false })
      .limit(50);
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
      .select("*, guests!match_guest_id(id, name, room, room_type, phone, order_number, spa_date, spa_time, msg_spa_upsell_sent, departure_date)")
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

  const selected = ingests.find((i) => i.id === selectedId);
  const reportDate = selected?.report_date_ymd || null;
  const isDoc2Ingest = selected?.report_type === "doc2_arrivals";
  const activeSections = isDoc2Ingest ? DOC2_WORKFLOW_SECTIONS : WORKFLOW_SECTIONS;

  const grouped = useMemo(() => {
    const buckets = Object.fromEntries(activeSections.map((s) => [s.id, []]));
    for (const line of lines) {
      const w = lineWorkflow(line, reportDate, isDoc2Ingest);
      if (isDoc2Ingest) {
        if (w === "suite_arrival_create") buckets.suite_arrival_create.push(line);
        else if (w === "suite_room_add") buckets.suite_room_add.push(line);
        else if (w === "suite_arrival_enrich") buckets.suite_arrival_enrich.push(line);
        else if (w === "suite_room_assign") buckets.suite_room_assign.push(line);
        else if (w === "daypass_create") buckets.daypass_create.push(line);
        else if (w === "conflict") buckets.conflict.push(line);
        else buckets.other.push(line);
      } else if (w === "suite_spa_sync") buckets.suite_spa_sync.push(line);
      else if (w === "daypass_upsell") buckets.daypass_upsell.push(line);
      else if (w === "daypass_create_spa") buckets.daypass_create_spa.push(line);
      else if (w === "daypass_create") buckets.daypass_create.push(line);
      else buckets.other.push(line);
    }
    return buckets;
  }, [lines, reportDate, isDoc2Ingest, activeSections]);

  const pendingCount = lines.filter((l) => l.status === "pending_review").length;
  const wf = (line) => lineWorkflow(line, reportDate, isDoc2Ingest);

  const triggerSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("ezgo-mail-sync");
      if (error) throw error;
      if (!data?.ok && !data?.skipped) throw new Error(data?.error || "סנכרון נכשל");
      const imap = data?.imap;
      const bySender = data?.by_sender || {};
      const senderBits = Object.entries(bySender)
        .map(([k, v]) => `${k.split("@")[0]}:${v}`)
        .join(" · ");
      const msg = data?.skipped
        ? "סנכרון מייל כבוי (EZGO_MAIL_SYNC_ENABLED)"
        : (data.scanned ?? 0) === 0 && imap
          ? `נסרקו 0 · תיבה ${imap.mailboxTotal} (${imap.mailboxName || "INBOX"}) · ${data.imap_user || ""} · נבדקו ${imap.scannedRaw} (${imap.searchMethod})`
          : `נסרקו ${data.scanned ?? 0} · חדשים ${data.processed ?? 0}${senderBits ? ` · ${senderBits}` : ""}${data.imap_user ? ` · ${data.imap_user}` : ""}`;
      showToast?.(msg, "ok");
      await loadIngests();
    } catch (e) {
      showToast?.(e.message, "err");
    } finally {
      setSyncing(false);
    }
  };

  const triggerReparse = async () => {
    if (!selectedId) return;
    if (!window.confirm("לפרסר מחדש את המייל? שורות שלא טופלו יוחלפו. אם המייל לא יימצא בתיבה — ייעשה שימוש בעותק השמור.")) return;
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("ezgo-mail-sync", {
        body: { reparse_ingest_id: selectedId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || data?.reason || "פרסור מחדש נכשל");
      showToast?.(`פרסור מחדש הושלם · ${data.lines ?? 0} שורות`, "ok");
      await loadIngests();
      if (data.ingestId) setSelectedId(data.ingestId);
      else await loadLines(selectedId);
    } catch (e) {
      showToast?.(e.message, "err");
    } finally {
      setSyncing(false);
    }
  };

  const applyLine = async (line) => {
    if (!line.match_guest_id || line.action === "no_match") {
      showToast?.("אין פרופיל לעדכון", "err");
      return;
    }

    const workflow = wf(line);
    const rec = line.parsed_json || {};

    if (isDoc2Ingest && workflow === "suite_room_add") {
      setBusy(true);
      try {
        const result = await applyDoc2SuiteRoomAdd(supabase, {
          guestId: line.match_guest_id,
          rec,
          reportDateYmd: reportDate,
        });
        await supabase.from("ezgo_mail_import_lines").update({
          status: "applied",
          applied_at: new Date().toISOString(),
          proposed_patch: { _workflow: workflow, _add_room: rec.room || null },
        }).eq("id", line.id);
        showToast?.(`חדר נוסף: ${result.name} · ${result.room || rec.room}`, "ok");
        await loadLines(selectedId);
        await loadIngests();
      } catch (e) {
        showToast?.(e.message, "err");
      } finally {
        setBusy(false);
      }
      return;
    }

    const patch = stripWorkflowPatch(line.proposed_patch || {});
    if (!Object.keys(patch).length && workflow !== "suite_room_assign") {
      await supabase.from("ezgo_mail_import_lines").update({ status: "skipped" }).eq("id", line.id);
      showToast?.("אין שדות חדשים — דולג", "ok");
      await loadLines(selectedId);
      return;
    }

    setBusy(true);
    try {
      const { data: guest, error: gErr } = await supabase
        .from("guests")
        .select("id, name, phone, order_number, arrival_date, departure_date, spa_time, spa_date, meal_time, meal_location, treatment_count")
        .eq("id", line.match_guest_id)
        .maybeSingle();
      if (gErr || !guest) throw gErr || new Error("אורח לא נמצא");

      if (isDoc2Ingest && workflow === "suite_room_assign") {
        const result = await applyDoc2SuiteRoomAdd(supabase, {
          guestId: guest.id,
          rec,
          reportDateYmd: reportDate,
        });
        await supabase.from("ezgo_mail_import_lines").update({
          status: "applied",
          applied_at: new Date().toISOString(),
          proposed_patch: { room: result.room || rec.room, _workflow: workflow },
        }).eq("id", line.id);
        showToast?.(`שובץ חדר: ${result.name} → ${result.room || rec.room}`, "ok");
        await loadLines(selectedId);
        await loadIngests();
        return;
      }

      const safePatch = isDoc2Ingest
        ? buildDoc2EnrichmentPatch(line.parsed_json, guest)
        : buildDoc1EnrichmentPatch(line.parsed_json, guest);
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
        proposed_patch: { ...safePatch, _workflow: workflow },
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

  const createLineInternal = async (line) => {
    const rec = line.parsed_json || {};
    if (isDoc2Ingest) {
      if (!rec.phone) throw new Error("חסר טלפון — לא ניתן ליצור פרופיל");
      const existing = await findGuestForDoc2SuiteCreate(supabase, rec, reportDate);
      const inserted = await createDoc2LineFromRec(supabase, rec, reportDate);
      const label = existing
        ? `חדר נוסף · ${inserted?.name || rec.guest_name} → ${rec.room}`
        : `נוצר פרופיל · ${inserted?.name || rec.guest_name || rec.phone}`;
      await supabase.from("ezgo_mail_import_lines").update({
        status: "applied",
        applied_at: new Date().toISOString(),
        match_guest_id: inserted?.id ?? null,
        match_method: existing ? "order" : "manual",
        match_label: label,
        proposed_patch: { _workflow: existing ? "suite_room_add" : wf(line) },
      }).eq("id", line.id);
      return inserted;
    }
    if (!rec.phone) throw new Error("חסר טלפון — לא ניתן ליצור פרופיל");
    const inserted = await createDaypassGuestFromRec(supabase, rec, reportDate);
    await supabase.from("ezgo_mail_import_lines").update({
      status: "applied",
      applied_at: new Date().toISOString(),
      match_guest_id: inserted?.id ?? null,
      match_method: "manual",
      match_label: `נוצר פרופיל · ${inserted?.name || rec.guest_name || rec.phone}`,
      proposed_patch: { _workflow: wf(line) },
    }).eq("id", line.id);
    return inserted;
  };

  const markUpsellLinesApplied = async (guestIds, lineIds = []) => {
    const guestSet = new Set(guestIds);
    const lineSet = new Set(lineIds);
    const toMark = lines.filter((l) => {
      if (l.status !== "pending_review") return false;
      if (lineSet.has(l.id)) return true;
      return l.match_guest_id
        && guestSet.has(l.match_guest_id)
        && wf(l) === "daypass_upsell";
    });
    for (const line of toMark) {
      await supabase.from("ezgo_mail_import_lines").update({
        status: "applied",
        applied_at: new Date().toISOString(),
        match_label: `${line.match_label || ""} · הצעת ספא נשלחה`.trim(),
      }).eq("id", line.id);
    }
  };

  const openUpsellModal = async (targets, lineIds = []) => {
    if (!targets?.length) {
      showToast?.("אין אורחים לשליחת הצעת ספא", "err");
      return;
    }
    const meta = await fetchSpaUpsellDispatchMeta(supabase);
    setScriptText(meta.scriptText);
    setMetaTemplateStatus(meta.metaTemplateStatus);
    setUpsellModal({ targets, lineIds });
  };

  const handleUpsellSendNow = async (channel) => {
    if (!upsellModal?.targets?.length) return;
    setUpsellSending(true);
    try {
      const results = await sendSpaUpsellBatch(
        supabase,
        upsellModal.targets,
        channel,
        setUpsellProgress,
      );
      const sentIds = results.filter((r) => r.result === "sent").map((r) => r.guest.id);
      if (sentIds.length) {
        await markUpsellLinesApplied(sentIds, upsellModal.lineIds);
        showToast?.(`💆 נשלחו ${sentIds.length} הצעות ספא`, "ok");
      } else {
        showToast?.("לא נשלחה אף הודעה", "err");
      }
      setUpsellModal(null);
      await loadLines(selectedId);
      await loadIngests();
    } catch (e) {
      showToast?.(e.message, "err");
    } finally {
      setUpsellSending(false);
      setUpsellProgress(null);
    }
  };

  const handleUpsellSchedule = async (payload) => {
    if (!payload?.length) return;
    setUpsellSending(true);
    try {
      const { count, error } = await scheduleSpaUpsellTasks(supabase, payload);
      if (error) throw error;
      const guestIds = payload.map((p) => p.guest_id);
      await markUpsellLinesApplied(guestIds, upsellModal?.lineIds ?? []);
      const whenLabel = payload[0] ? `${payload[0].schedule_date} ${payload[0].schedule_time}` : null;
      showToast?.(whenLabel
        ? `📅 תוזמנו ${count} הצעות ספא ל-${whenLabel}`
        : `📅 תוזמנו ${count} הצעות ספא`, "ok");
      setUpsellModal(null);
      await loadLines(selectedId);
      await loadIngests();
    } catch (e) {
      showToast?.(e.message, "err");
    } finally {
      setUpsellSending(false);
    }
  };

  const dismissUpsellWithoutSend = async (line, { silent = false, skipReload = false } = {}) => {
    await supabase.from("ezgo_mail_import_lines").update({
      status: "applied",
      applied_at: new Date().toISOString(),
      match_label: `${line.match_label || ""} · ללא שליחת הצעת ספא`.trim(),
      proposed_patch: { _workflow: wf(line) },
    }).eq("id", line.id);
    if (!silent) {
      showToast?.(`סומן ללא שליחה: ${line.guests?.name || line.parsed_json?.guest_name}`, "ok");
    }
    if (!skipReload) {
      await loadLines(selectedId);
      await loadIngests();
    }
  };

  const handleCreateProfile = async (line) => {
    const workflow = wf(line);
    if (workflow === "daypass_upsell" && line.match_guest_id) {
      setBusy(true);
      try {
        await dismissUpsellWithoutSend(line);
      } catch (e) {
        showToast?.(e.message, "err");
      } finally {
        setBusy(false);
      }
      return;
    }
    await createLine(line);
  };

  const createProfileBatch = async (workflowId) => {
    const pending = (grouped[workflowId] || []).filter(
      (l) => l.status === "pending_review" && l.parsed_json?.phone,
    );
    if (!pending.length) {
      showToast?.("אין שורות לטיפול", "err");
      return;
    }
    setBusy(true);
    let ok = 0;
    try {
      for (const line of pending) {
        try {
          if (workflowId === "daypass_upsell" && line.match_guest_id) {
            await dismissUpsellWithoutSend(line, { silent: true, skipReload: true });
          } else if (
            line.action === "create"
            || wf(line).startsWith("daypass_create")
          ) {
            await createLineInternal(line);
          }
          ok += 1;
        } catch { /* continue */ }
      }
      showToast?.(`טופלו ${ok} שורות (ללא שליחת הצעת ספא)`, "ok");
      await loadLines(selectedId);
      await loadIngests();
    } finally {
      setBusy(false);
    }
  };

  const createLine = async (line) => {
    setBusy(true);
    try {
      const inserted = await createLineInternal(line);
      showToast?.(`נוצר: ${inserted?.name || line.parsed_json?.guest_name}`, "ok");
      await loadLines(selectedId);
      await loadIngests();
    } catch (e) {
      showToast?.(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const createAndUpsellLine = async (line) => {
    setBusy(true);
    try {
      const inserted = await createLineInternal(line);
      showToast?.(`נוצר: ${inserted?.name || line.parsed_json?.guest_name}`, "ok");
      await loadLines(selectedId);
      await loadIngests();
      if (inserted?.id) {
        await openUpsellModal(
          [{ id: inserted.id, name: inserted.name, phone: inserted.phone }],
          [line.id],
        );
      }
    } catch (e) {
      showToast?.(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const upsellLine = async (line) => {
    const target = guestTargetFromLine(line);
    if (!target) {
      showToast?.("אין פרופיל מקושר", "err");
      return;
    }
    await openUpsellModal([target], [line.id]);
  };

  const upsellBatchForSection = async (workflowId) => {
    const pending = (grouped[workflowId] || []).filter((l) => l.status === "pending_review");
    const targets = pending
      .map((l) => guestTargetFromLine(l))
      .filter((t) => t?.id);
    const unique = [...new Map(targets.map((t) => [t.id, t])).values()];
    const lineIds = pending.map((l) => l.id);
    await openUpsellModal(unique, lineIds);
  };

  const rejectLine = async (line) => {
    await supabase.from("ezgo_mail_import_lines").update({ status: "rejected" }).eq("id", line.id);
    await loadLines(selectedId);
  };

  const applyBatch = async (workflowId) => {
    const pending = grouped[workflowId]?.filter((l) => {
      if (l.status !== "pending_review" || !l.match_guest_id) return false;
      const patchKeys = Object.keys(stripWorkflowPatch(l.proposed_patch || {}));
      if (!patchKeys.length) return false;
      if (workflowId === "suite_arrival_enrich" || workflowId === "suite_room_assign" || workflowId === "suite_room_add") {
        return true;
      }
      return l.match_method === "order";
    }) || [];
    if (!pending.length) {
      showToast?.("אין שורות בטוחות לאישור", "err");
      return;
    }
    let ok = 0;
    for (const line of pending) {
      try {
        await applyLine(line);
        ok += 1;
      } catch { /* continue */ }
    }
    showToast?.(`אושרו ${ok} שורות`, "ok");
  };

  const createBatch = async (workflowId) => {
    const pending = grouped[workflowId]?.filter((l) => l.status === "pending_review" && l.action === "create") || [];
    if (!pending.length) {
      showToast?.("אין פרופילים ליצירה", "err");
      return;
    }
    let ok = 0;
    for (const line of pending) {
      try {
        await createLineInternal(line);
        ok += 1;
      } catch { /* continue */ }
    }
    showToast?.(`נוצרו ${ok} פרופילים`, "ok");
    await loadLines(selectedId);
    await loadIngests();
  };

  const createBatchThenUpsell = async (workflowId) => {
    const pending = grouped[workflowId]?.filter((l) => l.status === "pending_review" && l.action === "create") || [];
    if (!pending.length) {
      showToast?.("אין פרופילים ליצירה", "err");
      return;
    }
    setBusy(true);
    const created = [];
    const lineIds = [];
    try {
      for (const line of pending) {
        try {
          const inserted = await createLineInternal(line);
          if (inserted?.id) {
            created.push({ id: inserted.id, name: inserted.name, phone: inserted.phone });
            lineIds.push(line.id);
          }
        } catch { /* continue */ }
      }
      showToast?.(`נוצרו ${created.length} פרופילים`, "ok");
      await loadLines(selectedId);
      await loadIngests();
      if (created.length) await openUpsellModal(created, lineIds);
    } finally {
      setBusy(false);
    }
  };

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
        noreply@ezgo.co.il · דוח כניסות (Doc2) · דוח תפעול (Doc1) → סריקה אוטומטית + אישור ידני.
        {" "}Doc2: צור פרופיל / השלמת חסר / שיבוץ חדר · Doc1: ספא / בילוי יומי.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) 2fr", gap: 14 }}>
        <div style={{ border: "1px solid rgba(201,169,110,0.25)", borderRadius: 12, padding: 10, maxHeight: 520, overflowY: "auto" }}>
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
              <div style={{ fontSize: 10, marginTop: 4, opacity: 0.65 }}>
                {ing.report_type} · {ing.parse_status}
              </div>
            </button>
          ))}
        </div>

        <div style={{ border: "1px solid rgba(201,169,110,0.25)", borderRadius: 12, padding: 12 }}>
          {selected ? (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
                <strong style={{ color: "var(--gold-light)" }}>{selected.subject}</strong>
                <span style={{ fontSize: 12, color: "#888" }}>
                  {pendingCount} ממתינות · דוח {reportDate || "—"}
                </span>
                <button
                  type="button"
                  onClick={triggerReparse}
                  disabled={syncing || busy}
                  title="מפרסר מחדש מהתיבה או מעותק שמור (לא מוחק את המייל מהרשימה)"
                  style={{
                    marginRight: "auto", padding: "4px 10px", borderRadius: 8,
                    border: "1px solid rgba(201,169,110,0.4)",
                    background: "transparent", color: "#ccc", fontSize: 11,
                    cursor: syncing || busy ? "wait" : "pointer",
                  }}
                >
                  🔁 פרסר מחדש
                </button>
              </div>

              <div style={{ maxHeight: 460, overflowY: "auto" }}>
                {activeSections.map((section) => {
                  const sectionLines = grouped[section.id] || [];
                  if (!sectionLines.length) return null;
                  const pendingInSection = sectionLines.filter((l) => l.status === "pending_review").length;
                  return (
                    <div key={section.id} style={{ marginBottom: 16 }}>
                      <div style={{
                        display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap",
                        paddingBottom: 6, borderBottom: "1px solid rgba(201,169,110,0.15)",
                      }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: 13, color: "var(--gold-light)" }}>
                            {section.title} ({sectionLines.length})
                          </div>
                          <div style={{ fontSize: 10, color: "#888" }}>{section.hint}</div>
                        </div>
                        {section.id === "suite_arrival_enrich" && pendingInSection > 0 && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => applyBatch("suite_arrival_enrich")}
                            style={{
                              marginRight: "auto", padding: "5px 10px", borderRadius: 8, border: "none",
                              background: "#3B6D11", color: "#fff", fontWeight: 700, fontSize: 11,
                            }}
                          >
                            אשר השלמת חסר ({pendingInSection})
                          </button>
                        )}
                        {section.id === "suite_arrival_create" && pendingInSection > 0 && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => createBatch("suite_arrival_create")}
                            style={{
                              marginRight: "auto", padding: "5px 10px", borderRadius: 8, border: "none",
                              background: "#1E40AF", color: "#fff", fontWeight: 700, fontSize: 11,
                            }}
                          >
                            צור הכל ({pendingInSection})
                          </button>
                        )}
                        {section.id === "suite_spa_sync" && pendingInSection > 0 && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => applyBatch("suite_spa_sync")}
                            style={{
                              marginRight: "auto", padding: "5px 10px", borderRadius: 8, border: "none",
                              background: "#3B6D11", color: "#fff", fontWeight: 700, fontSize: 11,
                            }}
                          >
                            אשר הכל (מס׳ הזמנה)
                          </button>
                        )}
                        {(section.id === "daypass_create" || section.id === "daypass_create_spa") && pendingInSection > 0 && (
                          <div style={{ marginRight: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              disabled={busy || upsellSending}
                              onClick={() => createBatch(section.id)}
                              style={{
                                padding: "5px 10px", borderRadius: 8, border: "none",
                                background: "#0e7490", color: "#fff", fontWeight: 700, fontSize: 11,
                              }}
                            >
                              צור הכל ({pendingInSection})
                            </button>
                            {section.id === "daypass_create" && (
                              <button
                                type="button"
                                disabled={busy || upsellSending}
                                onClick={() => createBatchThenUpsell(section.id)}
                                style={{
                                  padding: "5px 10px", borderRadius: 8, border: "none",
                                  background: "#155E75", color: "#fff", fontWeight: 700, fontSize: 11,
                                }}
                              >
                                ☀️💆 צור הכל + תזמן/שלח ({pendingInSection})
                              </button>
                            )}
                          </div>
                        )}
                        {section.id === "daypass_upsell" && pendingInSection > 0 && (
                          <div style={{ marginRight: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              disabled={busy || upsellSending}
                              onClick={() => createProfileBatch("daypass_upsell")}
                              style={{
                                padding: "5px 10px", borderRadius: 8, border: "none",
                                background: "#0e7490", color: "#fff", fontWeight: 700, fontSize: 11,
                              }}
                            >
                              ☀️ ללא שליחה ({pendingInSection})
                            </button>
                            <button
                              type="button"
                              disabled={busy || upsellSending}
                              onClick={() => upsellBatchForSection("daypass_upsell")}
                              style={{
                                padding: "5px 10px", borderRadius: 8, border: "none",
                                background: "#A21CAF", color: "#fff", fontWeight: 700, fontSize: 11,
                              }}
                            >
                              💆 שלח / תזמן לכולם ({pendingInSection})
                            </button>
                          </div>
                        )}
                      </div>
                      {sectionLines.map((line) => (
                        <LineCard
                          key={line.id}
                          line={line}
                          reportDate={reportDate}
                          busy={busy || upsellSending}
                          onApply={applyLine}
                          onCreate={handleCreateProfile}
                          onCreateAndUpsell={createAndUpsellLine}
                          onReject={rejectLine}
                          onUpsell={upsellLine}
                          isDoc2={isDoc2Ingest}
                        />
                      ))}
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

      {upsellModal && (
        <SpaUpsellConfirmModal
          targets={upsellModal.targets}
          scriptText={scriptText}
          pulseSeconds={SPA_UPSELL_SEND_PULSE_MS / 1000}
          sending={upsellSending}
          metaTemplateStatus={metaTemplateStatus}
          onClose={() => { if (!upsellSending) setUpsellModal(null); }}
          onSendNow={handleUpsellSendNow}
          onSchedule={handleUpsellSchedule}
        />
      )}
      {upsellSending && upsellProgress && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "#4C1D95", color: "#fff", padding: "10px 18px", borderRadius: 10,
          fontSize: 13, fontWeight: 700, zIndex: 10060,
        }}>
          ⏳ שולח הצעת ספא {upsellProgress.current}/{upsellProgress.total}...
        </div>
      )}
    </div>
  );
}
