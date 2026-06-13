// src/components/BroadcastDashboard.js
// Smart broadcast dashboard — audience segments from Supabase + Meta template management.
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const PHONE_ID = process.env.REACT_APP_PHONE_NUMBER_ID;
const WA_TOKEN = process.env.REACT_APP_WHATSAPP_TOKEN;
const GRAPH = `https://graph.facebook.com/v19.0`;

// ── Meta send helper ──────────────────────────────────────────────────────────
async function sendDirect(to, payloadBody) {
  const res = await fetch(`${GRAPH}/${PHONE_ID}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${WA_TOKEN}` },
    body: JSON.stringify({ messaging_product: "whatsapp", to, ...payloadBody }),
  });
  const json = await res.json();
  if (res.ok && json.messages?.[0]?.id) return { ok: true, id: json.messages[0].id };
  return { ok: false, error: json.error?.message ?? "שגיאה לא ידועה" };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizePhone(raw) {
  let p = (raw || "").replace(/[\s\-()‏]/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("0"))  p = "972" + p.slice(1);
  return p;
}
function toSnakeCase(s) {
  return s.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}
function getBodyText(tpl)  { return tpl.components?.find((c) => c.type === "BODY")?.text ?? ""; }
function getHeaderText(tpl){ return tpl.components?.find((c) => c.type === "HEADER")?.text ?? ""; }
function getFooterText(tpl){ return tpl.components?.find((c) => c.type === "FOOTER")?.text ?? ""; }
function getBodyVars(tpl) {
  const nums = new Set();
  for (const m of getBodyText(tpl).matchAll(/\{\{(\d+)\}\}/g)) nums.add(Number(m[1]));
  return [...nums].sort((a, b) => a - b);
}
function fillBody(text, vals) {
  return text.replace(/\{\{(\d+)\}\}/g, (_, n) => vals[Number(n)] ?? `{{${n}}}`);
}
function maxVarInText(text) {
  const nums = new Set();
  for (const m of text.matchAll(/\{\{(\d+)\}\}/g)) nums.add(Number(m[1]));
  return nums.size === 0 ? 0 : Math.max(...nums);
}
function todayStr()    { return new Date().toISOString().slice(0, 10); }
function offsetDay(n)  { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

// ── Demo fallback data ────────────────────────────────────────────────────────
const DEMO = {
  upcoming: [
    { guest_name: "משפחת כהן",   phone: "972501234567", arrival_date: offsetDay(1), confirmation_status: "confirmed" },
    { guest_name: "זוג לוי",     phone: "972521234568", arrival_date: offsetDay(1), confirmation_status: "pending"   },
    { guest_name: "שרה גולן",    phone: "972541234569", arrival_date: offsetDay(2), confirmation_status: "pending"   },
  ],
  current: [
    { guest_name: "משפחת מזרחי", phone: "972541239999", arrival_date: todayStr(), confirmation_status: "confirmed" },
    { guest_name: "זוג ברק",     phone: "972521238888", arrival_date: todayStr(), confirmation_status: "confirmed" },
  ],
  vip: [
    { guest_name: "דן פרידמן",   phone: "972501237777", arrival_date: todayStr(), confirmation_status: "confirmed" },
  ],
};

// ── Main component ────────────────────────────────────────────────────────────
export default function BroadcastDashboard() {
  const [segments, setSegments]       = useState({
    past:     { count: 0,  list: [],           label: "לקוחות עבר",    icon: "🕐", sub: "ביקרו בעבר"         },
    upcoming: { count: 0,  list: [],           label: "מגיעים בקרוב",  icon: "📅", sub: "מחר / מחרתיים"      },
    current:  { count: 0,  list: [],           label: "שוהים עכשיו",   icon: "🏨", sub: "בריזורט עכשיו"       },
    vip:      { count: 0,  list: [],           label: "סוויטות VIP",   icon: "👑", sub: "שוהים / מגיעים"      },
  });
  const [activeSegKey, setActiveSegKey] = useState("current");
  const [segsLoading,  setSegsLoading]  = useState(true);

  const [metaTemplates, setMetaTemplates] = useState([]);
  const [metaLoading,   setMetaLoading]   = useState(true);
  const [metaError,     setMetaError]     = useState("");

  const [mode,        setMode]        = useState("template"); // "template" | "free"
  const [selectedName, setSelectedName] = useState(null);
  const [varValues,   setVarValues]   = useState({});
  const [freeText,    setFreeText]    = useState("");

  const [sending,  setSending]  = useState(false);
  const [sendLog,  setSendLog]  = useState([]);

  const [showNewTpl, setShowNewTpl] = useState(false);
  const [sendingTo,  setSendingTo]  = useState(null);
  const [toast,      setToast]      = useState("");

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 3500); };

  // ── Load audience segments ────────────────────────────────────────────────
  const loadSegments = useCallback(async () => {
    setSegsLoading(true);
    if (!isSupabaseConfigured) {
      setSegments({
        past:     { count: 247, list: [],              label: "לקוחות עבר",   icon: "🕐", sub: "ביקרו בעבר"    },
        upcoming: { count: DEMO.upcoming.length, list: DEMO.upcoming, label: "מגיעים בקרוב", icon: "📅", sub: "מחר / מחרתיים" },
        current:  { count: DEMO.current.length,  list: DEMO.current,  label: "שוהים עכשיו",  icon: "🏨", sub: "בריזורט עכשיו" },
        vip:      { count: DEMO.vip.length,      list: DEMO.vip,      label: "סוויטות VIP",  icon: "👑", sub: "שוהים / מגיעים" },
      });
      setSegsLoading(false);
      return;
    }
    try {
      const today    = todayStr();
      const tomorrow = offsetDay(1);
      const dayAfter = offsetDay(2);

      const [pastRes, upRes, curRes, vipRes] = await Promise.all([
        supabase.from("bookings").select("id", { count: "exact", head: true }).lt("arrival_date", today),
        supabase.from("bookings").select("guest_name,phone,arrival_date,confirmation_status")
          .in("arrival_date", [tomorrow, dayAfter])
          .in("confirmation_status", ["pending", "confirmed"]),
        supabase.from("bookings").select("guest_name,phone,arrival_date,confirmation_status")
          .eq("arrival_date", today).eq("confirmation_status", "confirmed"),
        supabase.from("rooms").select("current_guest,type,status")
          .eq("status", "occupied").ilike("type", "%VIP%"),
      ]);

      const vipNames = new Set((vipRes.data ?? []).map((r) => r.current_guest).filter(Boolean));
      const vipList  = [...(upRes.data ?? []), ...(curRes.data ?? [])].filter((b) =>
        vipNames.has(b.guest_name)
      );

      setSegments({
        past:     { count: pastRes.count ?? 0,               list: [],             label: "לקוחות עבר",   icon: "🕐", sub: "ביקרו בעבר"    },
        upcoming: { count: (upRes.data ?? []).length,         list: upRes.data ?? [],  label: "מגיעים בקרוב", icon: "📅", sub: "מחר / מחרתיים" },
        current:  { count: (curRes.data ?? []).length,        list: curRes.data ?? [],  label: "שוהים עכשיו",  icon: "🏨", sub: "בריזורט עכשיו" },
        vip:      { count: vipList.length,                    list: vipList,            label: "סוויטות VIP",  icon: "👑", sub: "שוהים / מגיעים" },
      });
    } catch { /* fallback to demo */ }
    setSegsLoading(false);
  }, []);

  useEffect(() => { loadSegments(); }, [loadSegments]);

  // ── Load templates from message_templates table (no Meta API cost) ──────────
  const fetchMetaTemplates = useCallback(async () => {
    setMetaLoading(true); setMetaError("");
    try {
      if (!isSupabaseConfigured) {
        setMetaTemplates([]); setMetaLoading(false); return;
      }
      const { data, error } = await supabase
        .from("message_templates")
        .select("id,name,category,body,header,footer,meta_status")
        .eq("is_active", true);
      if (error) throw new Error(error.message);
      const all = (data ?? []).map((t) => ({
        id: t.id, name: t.name, category: t.category,
        status: t.meta_status === "approved" ? "APPROVED" :
                t.meta_status === "pending_approval" ? "PENDING" : t.meta_status.toUpperCase(),
        components: [
          ...(t.header ? [{ type: "HEADER", text: t.header }] : []),
          { type: "BODY", text: t.body },
          ...(t.footer ? [{ type: "FOOTER", text: t.footer }] : []),
        ],
      }));
      setMetaTemplates(all);
    } catch (e) { setMetaError(e.message); }
    setMetaLoading(false);
  }, []);

  useEffect(() => { fetchMetaTemplates(); }, [fetchMetaTemplates]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const approved = useMemo(
    () => metaTemplates.filter((t) => t.status === "APPROVED"),
    [metaTemplates],
  );
  const pending = useMemo(
    () => metaTemplates.filter((t) => ["PENDING","IN_APPEAL"].includes(t.status)).length,
    [metaTemplates],
  );
  const selectedTpl = useMemo(
    () => approved.find((t) => t.name === selectedName) ?? null,
    [approved, selectedName],
  );
  const extraVars = useMemo(
    () => (selectedTpl ? getBodyVars(selectedTpl).filter((n) => n > 1) : []),
    [selectedTpl],
  );

  const activeRecipients = useMemo(
    () => segments[activeSegKey]?.list ?? [],
    [segments, activeSegKey],
  );

  const previewValues = useMemo(() => {
    if (!selectedTpl) return {};
    const v = {};
    for (const n of getBodyVars(selectedTpl)) {
      v[n] = n === 1 ? (activeRecipients[0]?.guest_name ?? "אורח יקר") : ((varValues[n] ?? "").trim() || `{{${n}}}`);
    }
    return v;
  }, [selectedTpl, activeRecipients, varValues]);

  // Recommend templates relevant to active segment
  const recommended = useMemo(() => {
    const kwMap = {
      past:     ["return","post","visit","review","seasonal","reactivate","event"],
      upcoming: ["arrival","confirm","checkin","morning","reminder"],
      current:  ["spa","culinary","wine","workshop","water","premium","culinary"],
      vip:      ["spa","vip","wine","suite","premium","special"],
    };
    const kw = kwMap[activeSegKey] ?? [];
    return approved
      .filter((t) => kw.some((k) => t.name.toLowerCase().includes(k)))
      .slice(0, 4);
  }, [activeSegKey, approved]);

  // ── Send ─────────────────────────────────────────────────────────────────
  const canSend = activeRecipients.length > 0 && !sending && (
    mode === "template"
      ? Boolean(selectedTpl) && extraVars.filter((n) => !(varValues[n] ?? "").trim()).length === 0
      : freeText.trim().length >= 3
  );

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    const ts      = new Date().toLocaleTimeString("he-IL");
    const results = [];

    for (const rec of activeRecipients) {
      const phone = normalizePhone(rec.phone);
      let result;
      try {
        if (mode === "template") {
          const vars = getBodyVars(selectedTpl);
          const params = vars.map((n) => n === 1 ? rec.guest_name : (varValues[n] ?? "").trim());
          result = await sendDirect(phone, {
            type: "template",
            template: {
              name: selectedTpl.name,
              language: { code: selectedTpl.language ?? "he" },
              ...(params.length ? { components: [{ type: "body", parameters: params.map((t) => ({ type: "text", text: t })) }] } : {}),
            },
          });
        } else {
          const body = freeText.replace(/\{guest_name\}/g, rec.guest_name);
          result = await sendDirect(phone, { type: "text", text: { body } });
        }
      } catch (e) { result = { ok: false, error: e.message }; }
      results.push({ name: rec.guest_name, phone, ...result });
    }

    const ok = results.filter((r) => r.ok).length;
    setSendLog((p) => [{
      id: Date.now(), ts,
      template: mode === "template" ? selectedTpl.name : "הודעה חופשית",
      segment:  segments[activeSegKey]?.label ?? activeSegKey,
      total:    results.length, ok, rows: results,
    }, ...p].slice(0, 10));
    showToast(`📤 נשלח ${ok}/${results.length}`);
    setSending(false);
  };

  const handleSendToOne = async (guest) => {
    if (!selectedTpl || sendingTo) return;
    const phone = normalizePhone(guest.phone);
    setSendingTo(phone);
    try {
      const vars = getBodyVars(selectedTpl);
      const params = vars.map((n) => n === 1 ? guest.guest_name : (varValues[n] ?? "").trim());
      const result = await sendDirect(phone, {
        type: "template",
        template: {
          name: selectedTpl.name,
          language: { code: selectedTpl.language ?? "he" },
          ...(params.length ? { components: [{ type: "body", parameters: params.map((t) => ({ type: "text", text: t })) }] } : {}),
        },
      });
      showToast(result.ok ? `✅ נשלח ל-${guest.guest_name}` : `❌ ${result.error}`);
    } catch (e) { showToast(`❌ ${e.message}`); }
    setSendingTo(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div dir="rtl">

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)",
          background: "#1A1A1A", color: "#fff", padding: "10px 28px", borderRadius: 30,
          fontWeight: 700, fontSize: 14, zIndex: 9999, boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
          whiteSpace: "nowrap", border: "1px solid rgba(201,169,110,0.3)" }}>
          {toast}
        </div>
      )}

      {/* ── Audience segments ── */}
      <div style={{ marginBottom: 4, fontSize: 12, color: "#8A7A6A", fontWeight: 600 }}>
        בחר קהל יעד:
      </div>
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        {Object.entries(segments).map(([key, seg]) => (
          <div key={key} onClick={() => setActiveSegKey(key)} className="stat-card"
            style={{ cursor: "pointer", transition: "all .15s",
              outline: activeSegKey === key ? "2px solid #C9A25A" : "none",
              background: activeSegKey === key ? "rgba(201,162,90,.07)" : undefined }}>
            <div className="stat-icon">{seg.icon}</div>
            <div className="stat-value" style={{ fontSize: key === "past" ? 20 : 22 }}>
              {segsLoading ? "…" : seg.count}
            </div>
            <div className="stat-label">{seg.label}</div>
            <div className="stat-sub">{seg.sub}</div>
            {key === "past" && (
              <div className="stat-sub" style={{ color: "#8A7A6A", fontSize: 10 }}>
                תבניות בלבד
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Active segment banner */}
      {activeRecipients.length > 0 ? (
        <div style={{ padding: "9px 16px", borderRadius: 10, marginBottom: 20,
          background: "rgba(26,122,74,0.07)", border: "1px solid rgba(26,122,74,0.2)",
          fontSize: 13, color: "#1A7A4A", fontWeight: 600, display: "flex", gap: 8, alignItems: "center" }}>
          ✅ חלון פתוח — {segments[activeSegKey].label} · {activeRecipients.length} נמענים
          <span style={{ fontWeight: 400, color: "#6b7280" }}>
            ({activeRecipients.map((r) => r.guest_name).slice(0,3).join(", ")}
            {activeRecipients.length > 3 ? ` +${activeRecipients.length - 3}` : ""})
          </span>
        </div>
      ) : !segsLoading && (
        <div style={{ padding: "9px 16px", borderRadius: 10, marginBottom: 20,
          background: "rgba(184,134,11,.07)", border: "1px solid rgba(184,134,11,.25)",
          fontSize: 13, color: "#8B6914", fontWeight: 600 }}>
          ⚠️ אין נמענים ב"{segments[activeSegKey]?.label}" כרגע
        </div>
      )}

      {/* ── Compose section ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 290px", gap: 20, marginBottom: 20 }}>

        {/* Left: compose */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              {mode === "template" ? "📋 תבנית מאושרת" : "✏️ הודעה חופשית"}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className={`btn btn-sm ${mode === "template" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setMode("template")}>📋 תבנית</button>
              <button className={`btn btn-sm ${mode === "free" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setMode("free")}>✏️ חופשי</button>
            </div>
          </div>

          <div style={{ padding: "16px 20px" }}>
            {mode === "template" ? (
              <>
                {/* Template picker row */}
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
                  <div style={{ flex: 1 }}>
                    {metaLoading ? (
                      <div style={{ fontSize: 13, color: "#8A7A6A", padding: "8px 0" }}>טוען תבניות...</div>
                    ) : approved.length === 0 ? (
                      <div style={{ fontSize: 13, color: "#B8860B", padding: "12px 14px",
                        background: "rgba(184,134,11,.07)", border: "1px solid rgba(184,134,11,.25)",
                        borderRadius: 10 }}>
                        📋 אין תבניות מאושרות עדיין — תצור <button onClick={() => setShowNewTpl(true)}
                          style={{ textDecoration: "underline", background: "none", border: "none",
                            color: "#B8860B", fontWeight: 600, cursor: "pointer" }}>תבנית חדשה</button>
                      </div>
                    ) : (
                      <select value={selectedName ?? ""}
                        onChange={(e) => { setSelectedName(e.target.value || null); setVarValues({}); }}
                        style={{ width: "100%", padding: "10px 14px", borderRadius: 10,
                          border: "1.5px solid #E0D5C5", fontSize: 14, direction: "rtl",
                          background: "#fff", cursor: "pointer" }}>
                        <option value="">— בחר תבנית —</option>
                        {approved.map((t) => (
                          <option key={t.name} value={t.name}>{t.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={fetchMetaTemplates}
                    disabled={metaLoading} title="רענן">🔄</button>
                  <button className="btn btn-primary btn-sm"
                    onClick={() => setShowNewTpl(true)} style={{ whiteSpace: "nowrap" }}>
                    ➕ תבנית חדשה
                  </button>
                </div>

                {pending > 0 && (
                  <div style={{ fontSize: 11, color: "#B8860B", marginBottom: 12 }}>
                    ⏳ {pending} תבנית/ות בבדיקת Meta
                  </div>
                )}

                {/* Auto name tag */}
                {selectedTpl && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8,
                    padding: "9px 14px", background: "rgba(26,122,74,.07)",
                    border: "1px solid rgba(26,122,74,.2)", borderRadius: 10, marginBottom: 14 }}>
                    <span>✅</span>
                    <span style={{ fontSize: 13, color: "#1A7A4A", fontWeight: 600 }}>
                      {"{{1}}"} = שם האורח — אוטומטי
                    </span>
                  </div>
                )}

                {/* Extra vars */}
                {extraVars.map((n) => (
                  <div key={n} className="form-field" style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 12 }}>{"{{" + n + "}}"} — ערך ידני *</label>
                    <input value={varValues[n] ?? ""} dir="auto"
                      onChange={(e) => setVarValues((v) => ({ ...v, [n]: e.target.value }))}
                      placeholder={`הכנס ערך עבור {{${n}}}`} style={{ padding: "8px 12px", fontSize: 13 }} />
                  </div>
                ))}

                {/* Preview */}
                {selectedTpl && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, color: "#8A7A6A", marginBottom: 6, fontWeight: 600 }}>
                      תצוגה מקדימה — {activeRecipients[0]?.guest_name ?? "אורח יקר"}:
                    </div>
                    <div style={{ maxWidth: 340, background: "#E8F5E9",
                      borderRadius: "2px 12px 12px 12px", padding: "10px 14px",
                      fontSize: 13, lineHeight: 1.65, border: "1px solid rgba(37,211,102,.25)" }}>
                      {getHeaderText(selectedTpl) && (
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>{getHeaderText(selectedTpl)}</div>
                      )}
                      <div style={{ whiteSpace: "pre-wrap" }}>{fillBody(getBodyText(selectedTpl), previewValues)}</div>
                      {getFooterText(selectedTpl) && (
                        <div style={{ fontSize: 11, color: "#666", marginTop: 6,
                          borderTop: "1px solid rgba(0,0,0,.08)", paddingTop: 6 }}>
                          {getFooterText(selectedTpl)}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* Free text */
              <div className="form-field">
                <label>תוכן ההודעה <span style={{ color: "#8A7A6A", fontWeight: 400 }}>⚠️ רק למי שכתב ב-24 השעות האחרונות</span></label>
                <textarea rows={5} value={freeText} onChange={(e) => setFreeText(e.target.value)}
                  placeholder={"היי {guest_name}!\n\nניתן להשתמש ב-{guest_name} לשם אישי."}
                  style={{ resize: "vertical" }} />
                <div style={{ fontSize: 11, color: "#8A7A6A", marginTop: 4 }}>
                  {freeText.length} תווים
                  {freeText.includes("{guest_name}") && <span className="badge badge-gold" style={{ fontSize: 10, marginRight: 8 }}>✓ שם אישי</span>}
                </div>
              </div>
            )}

            {/* Send button */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
              marginTop: 12, flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#8A7A6A" }}>
                {activeRecipients.length > 0
                  ? `${segments[activeSegKey]?.label} · ${activeRecipients.length} נמענים`
                  : "אין נמענים בקהל הנבחר"}
              </span>
              <button className="btn btn-primary" onClick={handleSend}
                disabled={!canSend} style={{ opacity: canSend ? 1 : 0.45 }}>
                {sending ? "שולח..." : `📤 שלח ל-${activeRecipients.length} אורחים`}
              </button>
            </div>
          </div>
        </div>

        {/* Right: recommended templates */}
        <div className="card">
          <div className="card-header">
            <div className="card-title" style={{ fontSize: 13 }}>תבניות מומלצות</div>
            <button className="btn btn-primary btn-sm"
              onClick={() => setShowNewTpl(true)}>➕ חדשה</button>
          </div>
          <div style={{ padding: "0 0 8px" }}>
            {recommended.length === 0 ? (
              <div style={{ padding: "20px 16px", fontSize: 12, color: "#8A7A6A", textAlign: "center" }}>
                לא נמצאו תבניות לקהל זה
              </div>
            ) : (
              recommended.map((t) => (
                <div key={t.name} onClick={() => { setMode("template"); setSelectedName(t.name); setVarValues({}); }}
                  style={{ padding: "10px 16px", borderBottom: "1px solid #F5F0E8",
                    cursor: "pointer", background: selectedName === t.name ? "rgba(201,162,90,.07)" : "transparent",
                    transition: "background .12s" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#1A1A1A", direction: "ltr",
                    display: "flex", alignItems: "center", gap: 6 }}>
                    {selectedName === t.name && <span style={{ color: "#C9A25A" }}>✓</span>}
                    {t.name}
                  </div>
                  <div style={{ fontSize: 11, color: "#8A7A6A", marginTop: 3, lineHeight: 1.4,
                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {getBodyText(t)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Guest preview with inline send ── */}
      {activeRecipients.length > 0 && mode === "template" && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <div className="card-title">👥 נמענים — {activeRecipients.length} אורחים</div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#FAF6EE", borderBottom: "2px solid #E0D5C5" }}>
                  {["שם אורח", "תאריך הגעה", "סטטוס", ""].map((h) => (
                    <th key={h} style={{ padding: "9px 14px", textAlign: "right", fontWeight: 700, color: "#1A1A1A", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeRecipients.map((g, i) => {
                  const phone  = normalizePhone(g.phone);
                  const isBusy = sendingTo === phone;
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid #F5F0E8", opacity: isBusy ? 0.5 : 1 }}>
                      <td style={{ padding: "9px 14px", fontWeight: 600 }}>{g.guest_name}</td>
                      <td style={{ padding: "9px 14px", color: "#8A7A6A", fontSize: 12 }}>{g.arrival_date}</td>
                      <td style={{ padding: "9px 14px" }}>
                        <span style={{
                          padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                          background: g.confirmation_status === "confirmed" ? "rgba(26,122,74,0.1)" : "rgba(184,134,11,0.1)",
                          color: g.confirmation_status === "confirmed" ? "#1A7A4A" : "#8B6914",
                        }}>
                          {g.confirmation_status === "confirmed" ? "✓ אישר" : "⏳ ממתין"}
                        </span>
                      </td>
                      <td style={{ padding: "9px 14px", textAlign: "left" }}>
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={!selectedTpl || !!sendingTo}
                          onClick={() => handleSendToOne(g)}
                          style={{ fontSize: 12, opacity: !selectedTpl ? 0.45 : 1 }}
                        >
                          {isBusy ? "שולח..." : "שלח"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Send log ── */}
      {sendLog.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <div className="card-title">📊 היסטוריית שליחות אחרונות</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setSendLog([])}>נקה</button>
          </div>
          <div style={{ padding: "0 0 8px" }}>
            {sendLog.map((b) => (
              <div key={b.id} style={{ padding: "12px 20px", borderBottom: "1px solid #F5F0E8" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {b.template}
                    <span style={{ fontWeight: 400, color: "#8A7A6A", fontSize: 12, marginRight: 8 }}>
                      → {b.segment}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className={`badge ${b.ok === b.total ? "badge-green" : "badge-orange"}`}>
                      ✓ {b.ok}/{b.total}
                    </span>
                    <span style={{ fontSize: 11, color: "#8A7A6A" }}>{b.ts}</span>
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {b.rows.map((r, i) => (
                    <span key={i} className={`badge ${r.ok ? "badge-green" : "badge-red"}`}
                      style={{ fontSize: 11 }} title={r.ok ? "" : r.error}>
                      {r.ok ? "✓" : "✗"} {r.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── New Template Modal ── */}
      {showNewTpl && (
        <NewTemplateModal
          onClose={() => setShowNewTpl(false)}
          onCreated={() => {
            setShowNewTpl(false);
            fetchMetaTemplates();
            showToast("✅ תבנית נשלחה לאישור Meta — עד 48 שעות");
          }}
        />
      )}
    </div>
  );
}

// ── NewTemplateModal ──────────────────────────────────────────────────────────
function NewTemplateModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: "", category: "MARKETING", body: "", header: "", language: "he",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState("");

  const cleanName   = toSnakeCase(form.name);
  const previewBody = form.body
    .replace(/\{\{1\}\}/g, "שרה")
    .replace(/\{\{2\}\}/g, "יום שישי 20.6")
    .replace(/\{\{(\d+)\}\}/g, "...");

  const handleSubmit = async () => {
    if (!cleanName || !form.body.trim()) { setError("שם ותוכן נדרשים"); return; }
    setSubmitting(true); setError("");
    try {
      let result;
      if (isSupabaseConfigured) {
        const { data, error: fnErr } = await supabase.functions.invoke("submit-wa-template", {
          body: {
            name:     cleanName,
            category: form.category,
            body:     form.body.trim(),
            header:   form.header.trim() || undefined,
            language: form.language,
          },
        });
        result = fnErr ? { ok: false, error: fnErr.message } : data;
      } else {
        result = { ok: false, error: "נדרש חיבור Supabase ליצירת תבניות" };
      }
      if (result.ok) { onCreated(); } else { setError(result.error ?? "שגיאה"); }
    } catch (e) { setError(e.message); }
    setSubmitting(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fff", borderRadius: 18, width: "100%", maxWidth: 580,
        maxHeight: "90vh", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 64px rgba(0,0,0,0.22)" }}>

        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #F0EBE0",
          display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 17 }}>➕ תבנית חדשה — שליחה לאישור Meta</div>
          <button onClick={onClose} style={{ background: "none", border: "none",
            cursor: "pointer", fontSize: 22, color: "#8A7A6A" }}>✕</button>
        </div>

        {/* Form */}
        <div style={{ overflowY: "auto", flex: 1, padding: "20px 24px" }}>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 150px 80px", gap: 10, marginBottom: 14 }}>
            <div className="form-field" style={{ margin: 0 }}>
              <label style={{ fontSize: 11 }}>שם תבנית (באנגלית)</label>
              <input value={form.name} dir="ltr"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="dream_summer_spa" style={{ padding: "8px 10px", fontSize: 13 }} />
              {form.name && (
                <div style={{ fontSize: 10, color: "#8A7A6A", marginTop: 3 }}>
                  → יישמר כ: {cleanName}
                </div>
              )}
            </div>
            <div className="form-field" style={{ margin: 0 }}>
              <label style={{ fontSize: 11 }}>קטגוריה</label>
              <select value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                style={{ padding: "8px 10px", fontSize: 13, borderRadius: 8,
                  border: "1.5px solid #E0D5C5", width: "100%" }}>
                <option value="MARKETING">📣 שיווק</option>
                <option value="UTILITY">🛎️ שירות</option>
                <option value="AUTHENTICATION">🔐 אימות</option>
              </select>
            </div>
            <div className="form-field" style={{ margin: 0 }}>
              <label style={{ fontSize: 11 }}>שפה</label>
              <select value={form.language}
                onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
                style={{ padding: "8px 10px", fontSize: 13, borderRadius: 8,
                  border: "1.5px solid #E0D5C5", width: "100%" }}>
                <option value="he">🇮🇱 עברית</option>
                <option value="en_US">🇺🇸 English</option>
                <option value="ar">🇸🇦 عربي</option>
              </select>
            </div>
          </div>

          <div className="form-field" style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11 }}>כותרת (HEADER) — אופציונלי</label>
            <input value={form.header} dir="rtl"
              onChange={(e) => setForm((f) => ({ ...f, header: e.target.value }))}
              placeholder="כותרת קצרה (ללא משתנים)" style={{ padding: "8px 10px", fontSize: 13 }} />
          </div>

          <div className="form-field" style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11 }}>
              גוף ההודעה (BODY) *
              <span style={{ fontWeight: 400, color: "#8A7A6A", marginRight: 8 }}>
                {"{{1}}"} = שם אורח · {"{{2}}"} = ערך נוסף
              </span>
            </label>
            <textarea rows={5} value={form.body} dir="rtl"
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              placeholder={"היי {{1}}! 🏝️\n\nיש לנו חדשות מדרים איילנד...\n\nלפרטים ולהזמנה:\n{{2}}"}
              style={{ resize: "vertical", fontSize: 13 }} />
            <div style={{ fontSize: 10, color: "#8A7A6A", marginTop: 3 }}>
              Footer קבוע: Dream Island Resort | 08-6705600
            </div>
          </div>

          {/* Live preview */}
          {form.body.trim() && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "#8A7A6A", marginBottom: 6, fontWeight: 600 }}>
                תצוגה מקדימה:
              </div>
              <div style={{ maxWidth: 320, background: "#E8F5E9",
                borderRadius: "2px 12px 12px 12px", padding: "10px 14px",
                fontSize: 13, lineHeight: 1.65, border: "1px solid rgba(37,211,102,.25)" }}>
                {form.header.trim() && (
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{form.header}</div>
                )}
                <div style={{ whiteSpace: "pre-wrap" }}>{previewBody}</div>
                <div style={{ fontSize: 11, color: "#666", marginTop: 6,
                  borderTop: "1px solid rgba(0,0,0,.08)", paddingTop: 6 }}>
                  Dream Island Resort | 08-6705600
                </div>
              </div>
            </div>
          )}

          {error && (
            <div style={{ padding: "10px 14px", background: "rgba(192,57,43,.06)",
              border: "1px solid rgba(192,57,43,.25)", borderRadius: 10,
              fontSize: 13, color: "#C0392B", marginBottom: 12 }}>
              ❌ {error}
            </div>
          )}

          <div style={{ background: "rgba(201,162,90,.08)", border: "1px solid rgba(201,162,90,.3)",
            borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#8B6914", marginBottom: 16 }}>
            ⏳ אחרי השליחה Meta בודקת את התבנית — בדרך כלל עד 24-48 שעות.
            בזמן הבדיקה ניתן לראות סטטוס PENDING בלשונית WhatsApp Broadcast.
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 24px", borderTop: "1px solid #F0EBE0",
          display: "flex", justifyContent: "flex-end", gap: 10, flexShrink: 0 }}>
          <button className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button className="btn btn-primary" onClick={handleSubmit}
            disabled={submitting || !cleanName || !form.body.trim()}>
            {submitting ? "שולח לאישור..." : "📤 שלח לאישור Meta"}
          </button>
        </div>
      </div>
    </div>
  );
}
