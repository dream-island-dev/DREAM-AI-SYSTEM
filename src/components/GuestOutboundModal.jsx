// GuestOutboundModal — single-guest WhatsApp compose (channel + free text + Meta templates).
// Used by GuestDashboard and ReceptionistView; mirrors Inbox NewChatModal contracts.

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import QuietHoursGate from "./QuietHoursGate";
import { useQuietHoursSend } from "../hooks/useQuietHoursSend";
import {
  canSendGuestFreeText,
  inferGuestOutboundDefaults,
} from "../utils/guestOutboundChannel";
import {
  SERVICE_FALLBACK_TEMPLATE,
  substituteTemplateVars,
  buildWaTemplateOptions,
  autoFillGuestTemplateVars,
  TEMPLATE_VAR_LABELS,
} from "../utils/waTemplateUi";
import { formatInboxOutboundError } from "../utils/inboxSendErrors";
import { formatDeliveredChannelLabel } from "../utils/guestQuickWhapiTest";

export default function GuestOutboundModal({ guest, onClose, onSent }) {
  const {
    quietActive,
    overrideChecked,
    setOverrideChecked,
    ensureCanSend,
    canSend,
  } = useQuietHoursSend();

  const [mode, setMode] = useState("free");
  const [sendChannel, setSendChannel] = useState("meta");
  const [freeText, setFreeText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState(null);

  const [inboundRows, setInboundRows] = useState([]);
  const [inboundFetched, setInboundFetched] = useState(false);
  const [whapiSosActive, setWhapiSosActive] = useState(false);
  const [windowStatus, setWindowStatus] = useState({
    metaOpen: false,
    whapiOpen: false,
    whapiDisabled: false,
  });

  const [waTemplates, setWaTemplates] = useState([]);
  const [dbTemplates, setDbTemplates] = useState([]);
  const [loadingTmpls, setLoadingTmpls] = useState(false);
  const [tmplLoadError, setTmplLoadError] = useState(null);
  const [selectedTmpl, setSelectedTmpl] = useState(null);
  const [varValues, setVarValues] = useState([]);

  const didInitChannel = useRef(false);

  useEffect(() => {
    setFreeText(`שלום ${guest?.name ?? ""}! 👋\nכאן Dream Island — `);
    setMode("free");
    setErr(null);
    setSelectedTmpl(null);
    setVarValues([]);
    didInitChannel.current = false;
    setInboundFetched(false);
    setInboundRows([]);
  }, [guest?.id, guest?.name]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !guest?.phone) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("whatsapp_conversations")
        .select("inbox_channel, created_at")
        .eq("phone", guest.phone)
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(20);
      if (!cancelled) {
        setInboundRows(data ?? []);
        setInboundFetched(true);
      }
    })();
    return () => { cancelled = true; };
  }, [guest?.phone]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    supabase
      .from("bot_config")
      .select("config_value")
      .eq("config_key", "whapi_guest_sos_active")
      .maybeSingle()
      .then(({ data }) => setWhapiSosActive(data?.config_value === "true"));
  }, []);

  useEffect(() => {
    if (!guest || !inboundFetched || didInitChannel.current) return;
    const d = inferGuestOutboundDefaults(guest, inboundRows, whapiSosActive);
    setSendChannel(d.defaultChannel);
    setWindowStatus(d);
    didInitChannel.current = true;
  }, [guest, inboundRows, inboundFetched, whapiSosActive]);

  const fetchTemplates = useCallback(() => {
    if (!isSupabaseConfigured || !supabase) return;
    setLoadingTmpls(true);
    setTmplLoadError(null);
    Promise.all([
      supabase.functions.invoke("get-wa-templates").then(({ data, error }) => {
        if (error) throw new Error(`תבניות Meta: ${error.message ?? "שגיאה"}`);
        return data?.templates ?? [];
      }),
      supabase.from("message_templates").select("*").order("sort_order").then(({ data, error }) => {
        if (error) throw new Error(`תבניות שמורות: ${error.message}`);
        return data ?? [];
      }),
    ])
      .then(([wa, db]) => {
        setWaTemplates(wa);
        setDbTemplates(db);
      })
      .catch((e) => {
        setTmplLoadError(e?.message || "טעינת התבניות נכשלה");
        setWaTemplates([]);
        setDbTemplates([]);
      })
      .finally(() => setLoadingTmpls(false));
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const allTmpls = buildWaTemplateOptions(waTemplates, dbTemplates);

  function pickTemplate(tmpl) {
    setSelectedTmpl(tmpl);
    const count = tmpl?.varCount ?? 0;
    setVarValues(autoFillGuestTemplateVars(guest, count, []));
  }

  const freeTextAllowed = canSendGuestFreeText(sendChannel, {
    metaOpen: windowStatus.metaOpen,
    whapiSosActive,
  });

  const canSubmit =
    canSend &&
    !sending &&
    guest?.phone &&
    (mode === "template"
      ? selectedTmpl && (
          (selectedTmpl.varCount ?? 0) === 0 ||
          !varValues.some((v) => !(v ?? "").trim())
        )
      : freeText.trim() && (sendChannel === "whapi" || freeTextAllowed));

  async function handleSendFree() {
    if (!guest?.phone) return setErr("לאורח זה אין מספר טלפון");
    if (!freeText.trim()) return setErr("נא לכתוב הודעה");
    if (!ensureCanSend()) return setErr("שליחה חסומה בשעות שקט — סמן את האישור למטה");
    if (sendChannel === "meta" && !freeTextAllowed) {
      return setErr("חלון Dream Bot סגור — בחר «מכשיר הסוויטות» או שלח תבנית / פתיחת חלון שירות");
    }
    if (sendChannel === "whapi" && whapiSosActive) {
      return setErr("מכשיר הסוויטות חסום (SOS) — השתמש ב-Dream Bot או בתבנית Meta");
    }

    setSending(true);
    setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: {
          trigger: "inbox_reply",
          phone: guest.phone,
          message: freeText.trim(),
          inbox_channel: sendChannel,
        },
      });
      if (error || (data && !data.ok)) {
        throw new Error(formatInboxOutboundError(data, error?.message ?? data?.error, { whapiSosActive }));
      }
      onSent?.(guest, {
        simulation: data?.simulation,
        deliveredChannel: data?.delivered_channel,
        channelLabel: formatDeliveredChannelLabel(data?.delivered_channel),
      });
      onClose();
    } catch (e) {
      setErr(e?.message ?? "שגיאה");
    } finally {
      setSending(false);
    }
  }

  async function handleSendTemplate() {
    if (!guest?.id) return setErr("חסר מזהה אורח לשליחת תבנית");
    if (!selectedTmpl) return setErr("נא לבחור תבנית");
    if (!ensureCanSend()) return setErr("שליחה חסומה בשעות שקט — סמן את האישור למטה");
    const vars = autoFillGuestTemplateVars(guest, selectedTmpl.varCount ?? 0, varValues);
    if ((selectedTmpl.varCount ?? 0) > 0 && vars.some((v) => !v.trim())) {
      return setErr("נא למלא את כל שדות המשתנים");
    }

    setSending(true);
    setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: {
          trigger: "broadcast",
          guestId: guest.id,
          waTemplateName: selectedTmpl.name,
          templateVariables: vars,
          target_channel: sendChannel,
        },
      });
      if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? "שגיאה בשליחה");
      onSent?.(guest, data?.simulation);
      onClose();
    } catch (e) {
      setErr(e?.message ?? "שגיאה");
    } finally {
      setSending(false);
    }
  }

  async function handleOpenServiceWindow() {
    if (!guest?.phone) return;
    if (!ensureCanSend()) return setErr("שליחה חסומה בשעות שקט — סמן את האישור למטה");

    const guestName = String(guest.name ?? "").trim() || "אורח יקר";
    setSending(true);
    setErr(null);
    try {
      const payload = guest.id
        ? {
            trigger: "broadcast",
            guestId: guest.id,
            waTemplateName: SERVICE_FALLBACK_TEMPLATE,
            templateVariables: [guestName],
            target_channel: "meta",
          }
        : {
            trigger: "broadcast",
            phone: guest.phone,
            waTemplateName: SERVICE_FALLBACK_TEMPLATE,
            templateVariables: [guestName],
            target_channel: "meta",
          };

      const { data, error } = await supabase.functions.invoke("whatsapp-send", { body: payload });
      if (error || !data?.ok) {
        throw new Error(formatInboxOutboundError(data, error?.message ?? data?.error, {
          opLabel: "שגיאת שליחה (פתיחת חלון)",
          whapiSosActive,
        }));
      }
      setWindowStatus((prev) => ({ ...prev, metaOpen: true }));
      onSent?.(guest, data?.simulation);
    } catch (e) {
      setErr(e?.message ?? "שגיאה");
    } finally {
      setSending(false);
    }
  }

  const previewText = selectedTmpl?.bodyText
    ? substituteTemplateVars(selectedTmpl.bodyText, varValues)
    : null;

  const showServiceWindowBtn =
    mode === "free" && sendChannel === "meta" && !windowStatus.metaOpen && !whapiSosActive;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9998,
        background: "rgba(0,0,0,0.45)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--card-bg)", borderRadius: 16, padding: 0,
          width: "100%", maxWidth: 480, maxHeight: "92vh", overflowY: "auto",
          boxShadow: "0 16px 48px rgba(0,0,0,0.2)", direction: "rtl",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          padding: "18px 20px",
          borderBottom: "1px solid var(--border)",
          background: "linear-gradient(135deg, rgba(7,94,84,0.08), rgba(201,169,110,0.12))",
        }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>💬 הודעה ל{guest?.name}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, direction: "ltr" }}>
            {guest?.phone}
            {guest?.room ? ` · ${guest.room}` : ""}
          </div>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <QuietHoursGate
            active={quietActive}
            checked={overrideChecked}
            onChange={setOverrideChecked}
          />

          {/* Channel */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#555", marginBottom: 6, textTransform: "uppercase" }}>
              📡 ערוץ שליחה
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => setSendChannel("meta")}
                style={{
                  flex: 1, padding: "8px 10px", borderRadius: 10,
                  border: `2px solid ${sendChannel === "meta" ? "var(--gold,#C9A96E)" : "#ddd"}`,
                  background: sendChannel === "meta" ? "rgba(201,169,110,0.12)" : "#fff",
                  fontWeight: sendChannel === "meta" ? 700 : 400, cursor: "pointer", fontSize: 12,
                  fontFamily: "Heebo, sans-serif",
                }}
              >
                🤖 Dream Bot
              </button>
              <button
                type="button"
                onClick={() => !windowStatus.whapiDisabled && setSendChannel("whapi")}
                disabled={windowStatus.whapiDisabled}
                title={windowStatus.whapiDisabled ? "מכשיר הסוויטות חסום (SOS) — Dream Bot בלבד" : undefined}
                style={{
                  flex: 1, padding: "8px 10px", borderRadius: 10,
                  border: `2px solid ${sendChannel === "whapi" ? "#1A7A4A" : "#ddd"}`,
                  background: sendChannel === "whapi" ? "rgba(26,122,74,0.08)" : windowStatus.whapiDisabled ? "#F3F4F6" : "#fff",
                  fontWeight: sendChannel === "whapi" ? 700 : 400,
                  cursor: windowStatus.whapiDisabled ? "not-allowed" : "pointer",
                  opacity: windowStatus.whapiDisabled ? 0.55 : 1,
                  fontSize: 12, fontFamily: "Heebo, sans-serif",
                }}
              >
                📱 מכשיר סוויטות
              </button>
            </div>
            <div style={{ marginTop: 8, fontSize: 11.5, color: "#555", display: "flex", flexDirection: "column", gap: 4 }}>
              <span>{windowStatus.metaOpen ? "🟢" : "🔴"} Dream Bot — חלון 24ש׳ {windowStatus.metaOpen ? "פתוח" : "סגור"}</span>
              <span>
                {windowStatus.whapiDisabled ? "⚫" : windowStatus.whapiOpen ? "🟢" : "🟡"}
                {" "}
                מכשיר סוויטות
                {windowStatus.whapiDisabled ? " — SOS (חסום)" : windowStatus.whapiOpen ? " — שיחה פעילה" : " — טקסט חופשי זמין גם בלי חלון Meta"}
              </span>
            </div>
            {sendChannel === "whapi" && mode === "template" && (
              <div style={{
                marginTop: 8, fontSize: 11.5, color: "#92400E", background: "#FFF8E7",
                border: "1px solid #C9A96E", borderRadius: 8, padding: "6px 10px",
              }}>
                ⚠ דרך Whapi התבנית נשלחת כטקסט חופשי — בלי כפתורים Meta.
              </div>
            )}
          </div>

          {/* Mode tabs */}
          <div style={{ display: "flex", background: "#F3F4F6", borderRadius: 10, padding: 3, gap: 2 }}>
            {[
              { id: "free", label: "✍️ טקסט חופשי" },
              { id: "template", label: "📋 תבנית Meta" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => { setMode(tab.id); setErr(null); }}
                style={{
                  flex: 1, padding: "8px 0", border: "none", borderRadius: 8,
                  fontFamily: "Heebo, sans-serif", fontWeight: 700, fontSize: 12, cursor: "pointer",
                  background: mode === tab.id ? "white" : "transparent",
                  color: mode === tab.id ? "#075E54" : "#6B7280",
                  boxShadow: mode === tab.id ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {mode === "free" && (
            <>
              <textarea
                autoFocus
                rows={5}
                value={freeText}
                onChange={(e) => setFreeText(e.target.value.slice(0, 1000))}
                style={{
                  width: "100%", borderRadius: 10, border: "1px solid var(--border)",
                  padding: "10px 12px", fontSize: 14, fontFamily: "Heebo, sans-serif",
                  direction: "rtl", resize: "vertical", boxSizing: "border-box",
                  background: "var(--ivory)",
                }}
              />
              {sendChannel === "meta" && !freeTextAllowed && (
                <div style={{
                  fontSize: 12, color: "#92400E", background: "#FFF8E7",
                  border: "1px solid #C9A96E", borderRadius: 8, padding: "8px 10px",
                }}>
                  חלון Dream Bot סגור — בחר מכשיר סוויטות, שלח תבנית, או פתח חלון שירות.
                </div>
              )}
            </>
          )}

          {mode === "template" && (
            <>
              {loadingTmpls ? (
                <div style={{ fontSize: 13, color: "#888", textAlign: "center" }}>⏳ טוען תבניות...</div>
              ) : tmplLoadError ? (
                <div style={{ fontSize: 13, color: "#C0392B" }}>⚠ {tmplLoadError}</div>
              ) : (
                <select
                  value={selectedTmpl?.name ?? ""}
                  onChange={(e) => {
                    const tmpl = allTmpls.find((t) => t.name === e.target.value) ?? null;
                    pickTemplate(tmpl);
                  }}
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: 10,
                    border: "1px solid var(--border)", fontSize: 14, fontFamily: "Heebo, sans-serif",
                  }}
                >
                  <option value="">— בחר תבנית —</option>
                  {allTmpls.map((t) => (
                    <option key={t.name} value={t.name}>{t.displayName}</option>
                  ))}
                </select>
              )}

              {selectedTmpl && (selectedTmpl.varCount ?? 0) > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {Array.from({ length: selectedTmpl.varCount }, (_, idx) => (
                    <div key={idx}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: "#555" }}>
                        {TEMPLATE_VAR_LABELS[idx] ?? `משתנה ${idx + 1}`}
                      </label>
                      <input
                        type="text"
                        value={varValues[idx] ?? ""}
                        onChange={(e) => {
                          const next = [...varValues];
                          next[idx] = e.target.value;
                          setVarValues(next);
                        }}
                        style={{
                          width: "100%", boxSizing: "border-box", marginTop: 4,
                          padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)",
                          fontFamily: "Heebo, sans-serif", fontSize: 13,
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}

              {previewText && (
                <div style={{
                  background: "#DCF8C6", borderRadius: 12, padding: "10px 12px",
                  fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap",
                }}>
                  {previewText}
                </div>
              )}
            </>
          )}

          {err && (
            <div style={{
              background: "#FFF0EE", border: "1px solid #C0392B", borderRadius: 8,
              padding: "8px 10px", fontSize: 13, color: "#C0392B",
            }}>
              {err}
            </div>
          )}

          {showServiceWindowBtn && (
            <button
              type="button"
              onClick={handleOpenServiceWindow}
              disabled={sending}
              style={{
                width: "100%", padding: "10px", borderRadius: 10,
                border: "1.5px solid #0369A1", background: "#E0F2FE",
                color: "#0369A1", fontWeight: 700, fontSize: 13, cursor: "pointer",
                fontFamily: "Heebo, sans-serif",
              }}
            >
              🌴 פתיחת חלון שירות (dream_service_fallback)
            </button>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "10px 20px", borderRadius: 8, border: "1px solid var(--border)",
                background: "var(--card-bg)", cursor: "pointer", fontFamily: "Heebo, sans-serif",
                fontSize: 14, color: "var(--text-muted)",
              }}
            >
              ביטול
            </button>
            <button
              type="button"
              onClick={mode === "template" ? handleSendTemplate : handleSendFree}
              disabled={!canSubmit}
              title={
                mode === "free" && sendChannel === "meta" && !freeTextAllowed
                  ? "חלון Dream Bot סגור — בחר ערוץ אחר או תבנית"
                  : undefined
              }
              style={{
                padding: "10px 24px", borderRadius: 8, border: "none",
                background: !canSubmit ? "#ccc" : "linear-gradient(135deg, var(--gold), var(--gold-dark))",
                color: "#fff", fontFamily: "Heebo, sans-serif", fontWeight: 700,
                fontSize: 14, cursor: !canSubmit ? "not-allowed" : "pointer",
              }}
            >
              {sending ? "⏳ שולח..." : "📤 שלח"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
