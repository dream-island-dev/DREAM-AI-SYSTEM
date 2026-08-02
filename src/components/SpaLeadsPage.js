// Dedicated spa coordinator view — open upsell acceptance leads, no dispatch UI.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { israelTodayYmd } from "../utils/spaUpsellAudience";
import {
  buildSpaUpsellStaffCopy,
  fetchAllOpenSpaUpsellLeads,
  fmtLeadTime,
  resolveSpaUpsellLead,
} from "../utils/spaUpsellHub";
import { isEffectiveDayPassGuest, isEffectiveSuiteGuest } from "../utils/pipelineSegment";
import { isManualSpaUpsellLeadMessage } from "../utils/spaUpsellLeadManual";

const FILTER_ALL = "all";
const FILTER_TODAY = "today";
const FILTER_TOMORROW = "tomorrow";
const FILTER_CUSTOM = "custom";

function tomorrowYmd() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function formatPhoneTel(phone) {
  const raw = String(phone ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("+")) return raw.replace(/[^\d+]/g, "");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("972")) return `+${digits}`;
  if (digits.startsWith("0")) return `+972${digits.slice(1)}`;
  return `+${digits}`;
}

function formatPhoneDisplay(phone) {
  const raw = String(phone ?? "").trim();
  if (!raw) return "—";
  const digits = raw.replace(/\D/g, "");
  let local = "";
  if (digits.startsWith("972") && digits.length >= 11) local = `0${digits.slice(3)}`;
  else if (digits.startsWith("0") && digits.length === 10) local = digits;
  else if (digits.length >= 9) return raw.startsWith("+") ? raw : `+${digits}`;
  else return raw;
  if (local.length === 10) {
    return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  }
  return raw;
}

function resolveLeadPhone(lead) {
  return lead.phone || lead.guests?.phone || "";
}

function leadTypeLabel(alertType) {
  if (alertType === "spa_request") return "בקשת ספא";
  return "הצעת ספא";
}

function leadCohortLabel(guest) {
  if (isEffectiveSuiteGuest(guest)) return "👑 סוויטה";
  if (isEffectiveDayPassGuest(guest)) return "🌴 בילוי יומי";
  return null;
}

function fmtArrivalDate(ymd) {
  if (!ymd) return "—";
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("he-IL", { weekday: "short", day: "numeric", month: "numeric" });
}

export default function SpaLeadsPage({ onOpenDreamBotChat, onNavigate }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [resolvingId, setResolvingId] = useState(null);
  const [dateFilter, setDateFilter] = useState(FILTER_TODAY);
  const [customDate, setCustomDate] = useState(israelTodayYmd());

  const loadLeads = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setLoading(true);
    setLoadError(null);
    const { leads: rows, error } = await fetchAllOpenSpaUpsellLeads(supabase);
    if (error) {
      setLoadError(error.message);
      setLeads([]);
    } else {
      setLeads(rows);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadLeads(); }, [loadLeads]);

  useEffect(() => {
    if (!supabase) return;
    const ch = supabase
      .channel("spa-leads-page-alerts")
      .on("postgres_changes", { event: "*", schema: "public", table: "guest_alerts" }, () => {
        loadLeads();
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [loadLeads]);

  const activeArrivalYmd = useMemo(() => {
    if (dateFilter === FILTER_TODAY) return israelTodayYmd();
    if (dateFilter === FILTER_TOMORROW) return tomorrowYmd();
    if (dateFilter === FILTER_CUSTOM) return customDate;
    return null;
  }, [dateFilter, customDate]);

  const filteredLeads = useMemo(() => {
    if (!activeArrivalYmd) return leads;
    return leads.filter((l) => l.guests?.arrival_date === activeArrivalYmd);
  }, [leads, activeArrivalYmd]);

  const groupedByArrival = useMemo(() => {
    const map = new Map();
    for (const lead of filteredLeads) {
      const key = lead.guests?.arrival_date || "ללא תאריך";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(lead);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredLeads]);

  const handleResolve = async (leadId) => {
    if (!supabase) return;
    setResolvingId(leadId);
    const { error } = await resolveSpaUpsellLead(supabase, leadId);
    setResolvingId(null);
    if (error) setLoadError(error.message);
    else setLeads((prev) => prev.filter((l) => l.id !== leadId));
  };

  const copyList = async () => {
    const text = buildSpaUpsellStaffCopy(
      filteredLeads,
      activeArrivalYmd || "כל התאריכים",
    );
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setLoadError("לא הצלחנו להעתיק ללוח");
    }
  };

  const filterBtn = (id, label) => (
    <button
      key={id}
      type="button"
      onClick={() => setDateFilter(id)}
      style={{
        padding: "8px 14px",
        borderRadius: 20,
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
        border: dateFilter === id ? "2px solid #7C3AED" : "1px solid #DDD6FE",
        background: dateFilter === id ? "#F3E8FF" : "#fff",
        color: dateFilter === id ? "#5B21B6" : "#6B7280",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ direction: "rtl", fontFamily: "Heebo, sans-serif", maxWidth: 1080, margin: "0 auto" }}>
      <div style={{
        background: "linear-gradient(135deg, #5B21B6 0%, #7C3AED 55%, #A78BFA 100%)",
        borderRadius: 16,
        padding: "22px 24px",
        color: "#fff",
        marginBottom: 20,
        boxShadow: "0 8px 28px rgba(91,33,182,0.25)",
      }}>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>💆 לידים לתיאום ספא</div>
        <div style={{ fontSize: 13.5, opacity: 0.92, lineHeight: 1.55, maxWidth: 560 }}>
          אורחים שרוצים לתאם טיפול בספא (בילוי יומי, סוויטה, פורטל) — שבצי בלוח הספא, חזרי לאורח בוואטסאפ, וסמני ✓ בוצע.
        </div>
        <div style={{
          marginTop: 16,
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          background: "rgba(255,255,255,0.18)",
          borderRadius: 12,
          padding: "10px 18px",
        }}>
          <span style={{ fontSize: 32, fontWeight: 800, lineHeight: 1 }}>{filteredLeads.length}</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>ממתינים לטיפול</span>
        </div>
      </div>

      <div style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        alignItems: "center",
        marginBottom: 16,
      }}>
        {filterBtn(FILTER_ALL, "הכל")}
        {filterBtn(FILTER_TODAY, "היום")}
        {filterBtn(FILTER_TOMORROW, "מחר")}
        {filterBtn(FILTER_CUSTOM, "תאריך…")}
        {dateFilter === FILTER_CUSTOM && (
          <input
            type="date"
            value={customDate}
            onChange={(e) => setCustomDate(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #DDD6FE" }}
          />
        )}
        <button
          type="button"
          onClick={loadLeads}
          disabled={loading}
          style={{
            marginRight: "auto",
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "#fff",
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          ↺ רענון
        </button>
        {filteredLeads.length > 0 && (
          <button
            type="button"
            onClick={copyList}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #C4B5FD",
              background: "#F5F3FF",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              color: "#5B21B6",
            }}
          >
            📋 העתק רשימה
          </button>
        )}
        {onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate("spa_board")}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "none",
              background: "var(--gold)",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              color: "#412402",
            }}
          >
            📅 לוח ספא
          </button>
        )}
      </div>

      {loadError && (
        <div style={{
          background: "#FFF0EE",
          border: "1px solid #C0392B",
          borderRadius: 10,
          padding: "10px 14px",
          color: "#C0392B",
          fontSize: 13,
          marginBottom: 14,
        }}>
          ❌ {loadError}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>טוען לידים…</div>
      ) : filteredLeads.length === 0 ? (
        <div style={{
          textAlign: "center",
          padding: 40,
          border: "2px dashed #DDD6FE",
          borderRadius: 14,
          color: "#7C3AED",
          background: "#FAF5FF",
        }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>אין ממתינים כרגע</div>
          <div style={{ fontSize: 13, marginTop: 6, color: "#9CA3AF" }}>
            תשובות «אשמח לתאם» יופיעו כאן אוטומטית
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {groupedByArrival.map(([arrivalYmd, rows]) => (
            <section key={arrivalYmd}>
              <div style={{
                fontSize: 13,
                fontWeight: 800,
                color: "#5B21B6",
                marginBottom: 10,
                paddingBottom: 6,
                borderBottom: "2px solid #EDE9FE",
              }}>
                הגעה {fmtArrivalDate(arrivalYmd)} · {rows.length} אורחים
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {rows.map((lead) => {
                  const phoneRaw = resolveLeadPhone(lead);
                  const phoneTel = formatPhoneTel(phoneRaw);
                  const phoneDisplay = formatPhoneDisplay(phoneRaw);
                  const quote = String(lead.message ?? "").trim().replace(/^\[ידני מ-Inbox\]\s*/i, "") || "אשמח לתאם";
                  return (
                  <div
                    key={lead.id}
                    style={{
                      background: "#fff",
                      border: "1px solid #E9D5FF",
                      borderRight: "5px solid #7C3AED",
                      borderRadius: 14,
                      padding: "18px 20px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 16,
                      flexWrap: "wrap",
                      boxShadow: "0 2px 12px rgba(91,33,182,0.06)",
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                        {isManualSpaUpsellLeadMessage(lead.message) && (
                          <span style={{
                            fontSize: 11, fontWeight: 800, color: "#92400E",
                            background: "#FEF3C7", padding: "3px 10px", borderRadius: 8,
                          }}
                          >
                            ידני
                          </span>
                        )}
                        <span style={{
                          fontSize: 11, fontWeight: 800, color: "#5B21B6",
                          background: "#EDE9FE", padding: "3px 10px", borderRadius: 8,
                        }}
                        >
                          {leadTypeLabel(lead.alert_type)}
                        </span>
                        {leadCohortLabel(lead.guests) ? (
                          <span style={{
                            fontSize: 11, fontWeight: 800, color: "#1E40AF",
                            background: "#DBEAFE", padding: "3px 10px", borderRadius: 8,
                          }}
                          >
                            {leadCohortLabel(lead.guests)}
                          </span>
                        ) : null}
                        {lead.guests?.room ? (
                          <span style={{
                            fontSize: 11, fontWeight: 700, color: "#6B7280",
                            background: "#F3F4F6", padding: "3px 10px", borderRadius: 8,
                          }}
                          >
                            {lead.guests.room}
                          </span>
                        ) : null}
                      </div>

                      <div style={{
                        fontWeight: 900,
                        fontSize: "clamp(22px, 4vw, 28px)",
                        color: "#111827",
                        lineHeight: 1.25,
                        letterSpacing: "-0.02em",
                        marginBottom: 8,
                      }}
                      >
                        {lead.guests?.name || "אורח"}
                      </div>

                      {phoneTel ? (
                        <a
                          href={`tel:${phoneTel}`}
                          style={{
                            display: "inline-block",
                            fontWeight: 800,
                            fontSize: "clamp(20px, 3.5vw, 24px)",
                            color: "#5B21B6",
                            textDecoration: "none",
                            direction: "ltr",
                            unicodeBidi: "embed",
                            letterSpacing: "0.04em",
                            marginBottom: 10,
                            padding: "4px 0",
                          }}
                        >
                          📱 {phoneDisplay}
                        </a>
                      ) : (
                        <div style={{ fontSize: 18, color: "#9CA3AF", marginBottom: 10 }}>אין טלפון</div>
                      )}

                      <div style={{
                        fontSize: "clamp(16px, 2.5vw, 18px)",
                        fontWeight: 800,
                        color: "#6B21A8",
                        marginBottom: 12,
                      }}
                      >
                        📅 הגעה {fmtArrivalDate(lead.guests?.arrival_date)}
                      </div>

                      <div style={{
                        fontSize: 15,
                        color: "#4C1D95",
                        lineHeight: 1.5,
                        fontStyle: "italic",
                        opacity: 0.9,
                      }}>
                        «{quote}»
                      </div>
                      <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 10 }}>
                        התקבל {fmtLeadTime(lead.created_at)}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      {onOpenDreamBotChat && resolveLeadPhone(lead) && (
                        <button
                          type="button"
                          onClick={() => onOpenDreamBotChat({
                            phone: resolveLeadPhone(lead),
                            guestName: lead.guests?.name,
                            returnPage: "spa_leads",
                            returnPageLabel: "לידים ספא",
                          })}
                          style={actionBtn("#EEF2FF", "#3730A3")}
                        >
                          💬 שיחה
                        </button>
                      )}
                      {onNavigate && (
                        <button
                          type="button"
                          onClick={() => onNavigate("spa_board")}
                          style={actionBtn("#FEF3C7", "#92400E")}
                        >
                          📅 שבץ
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleResolve(lead.id)}
                        disabled={resolvingId === lead.id}
                        style={actionBtn("#DCFCE7", "#166534", true)}
                      >
                        {resolvingId === lead.id ? "…" : "✓ בוצע"}
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function actionBtn(bg, color, bold) {
  return {
    padding: "12px 18px",
    minHeight: 48,
    borderRadius: 12,
    border: `1px solid ${color}33`,
    background: bg,
    color,
    fontWeight: bold ? 800 : 700,
    fontSize: 14,
    cursor: "pointer",
    fontFamily: "Heebo, sans-serif",
    whiteSpace: "nowrap",
  };
}
