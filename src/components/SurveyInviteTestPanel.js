// src/components/SurveyInviteTestPanel.js
// Staff QA: preview survey WhatsApp invite + open portal #survey + optional
// single-guest Whapi send (hermetic: confirm, one guest, force Override path).

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const SURVEY_SCRIPT_KEY = "survey_invite_daypass";
const PROD_PORTAL_BASE = "https://dream-ai-system.vercel.app";

function resolveInvitePreview(template, { guestName, portalUrl }) {
  let text = String(template ?? "");
  text = text.replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, guestName || "אורח יקר");
  if (portalUrl) {
    text = text.replace(/\{\{\s*(?:PORTAL_LINK|portal_url)\s*\}\}/gi, portalUrl);
  } else {
    text = text.replace(/[^\n.!?]*\{\{\s*(?:PORTAL_LINK|portal_url)\s*\}\}[^\n.!?]*[.!?]?\s*/gi, "");
  }
  return text.trim();
}

function localPortalSurveyUrl(token) {
  if (!token) return null;
  return `${window.location.origin}/portal/${token}#survey`;
}

function prodPortalSurveyUrl(token) {
  if (!token) return null;
  return `${PROD_PORTAL_BASE}/portal/${token}#survey`;
}

export default function SurveyInviteTestPanel({ onToast }) {
  const [scriptText, setScriptText] = useState("");
  const [guests, setGuests] = useState([]);
  const [guestId, setGuestId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
    const from = new Date(Date.now() - 14 * 86400000).toLocaleDateString("en-CA", {
      timeZone: "Asia/Jerusalem",
    });

    const [{ data: scriptRow, error: scriptErr }, { data: guestRows, error: guestErr }] =
      await Promise.all([
        supabase
          .from("bot_scripts")
          .select("message_text, is_active")
          .eq("script_key", SURVEY_SCRIPT_KEY)
          .maybeSingle(),
        supabase
          .from("guests")
          .select("id, name, phone, room_type, room, spa_date, spa_time, portal_token, status, arrival_date")
          .not("portal_token", "is", null)
          .neq("status", "cancelled")
          .gte("arrival_date", from)
          .order("arrival_date", { ascending: false })
          .limit(80),
      ]);

    if (scriptErr) onToast?.("err", "שגיאה בטעינת סקריפט סקר: " + scriptErr.message);
    else setScriptText(String(scriptRow?.message_text ?? "").trim());

    if (guestErr) {
      onToast?.("err", "שגיאה בטעינת אורחים: " + guestErr.message);
      setGuests([]);
    } else {
      const ranked = (guestRows ?? []).slice().sort((a, b) => {
        const aSpa = a.spa_date && a.spa_date === a.arrival_date ? 1 : 0;
        const bSpa = b.spa_date && b.spa_date === b.arrival_date ? 1 : 0;
        if (bSpa !== aSpa) return bSpa - aSpa;
        const aToday = a.arrival_date === today ? 1 : 0;
        const bToday = b.arrival_date === today ? 1 : 0;
        return bToday - aToday;
      });
      setGuests(ranked);
      setGuestId((prev) => (prev ? prev : ranked[0] ? String(ranked[0].id) : ""));
    }
    setLoading(false);
  }, [onToast]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = useMemo(
    () => guests.find((g) => String(g.id) === String(guestId)) ?? null,
    [guests, guestId],
  );

  const prodUrl = prodPortalSurveyUrl(selected?.portal_token);
  const localUrl = localPortalSurveyUrl(selected?.portal_token);

  const previewWithHash = useMemo(() => {
    if (!scriptText) return "";
    const base = prodUrl ? prodUrl.replace(/#survey$/, "") : "";
    return resolveInvitePreview(scriptText, {
      guestName: selected?.name,
      portalUrl: base,
    });
  }, [scriptText, selected, prodUrl]);

  async function sendInvite() {
    if (!selected?.id || busy) return;
    setBusy(true);
    setConfirmSend(false);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: {
          trigger: SURVEY_SCRIPT_KEY,
          guestId: selected.id,
          force: true,
          force_channel: "whapi_session",
        },
      });
      if (error) throw new Error(error.message);
      if (data?.ok === false || data?.error) {
        throw new Error(data.error || data.reason || "שליחה נכשלה");
      }
      if (data?.skipped) {
        onToast?.("err", `דולג: ${data.reason || data.status || "skipped"}`);
      } else {
        onToast?.(
          "ok",
          `✅ נשלח ל־${selected.name || selected.phone} — בדקו Inbox לתג [WHAPI] ולקישור #survey`,
        );
      }
    } catch (e) {
      onToast?.("err", e?.message || "שגיאה בשליחת הזמנת סקר");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="card"
      style={{
        padding: "16px 18px",
        marginBottom: 20,
        borderInlineStart: "4px solid var(--gold-dark)",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 800, color: "var(--black)", marginBottom: 6 }}>
        📨 הודעת סקר בוואטסאפ + קישור לפורטל
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 14 }}>
        תצוגה מקדימה של אותה הודעה שהאוטומציה שולחת (כולל קישור <code>#survey</code>).
        שליחה = אורח אחד, Whapi, עם אישור — לא במכה.
      </div>

      {loading ? (
        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>טוען…</div>
      ) : (
        <>
          <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
            אורח לבדיקה (מועדף: בילוי יומי + ספא + portal_token)
          </label>
          <select
            value={guestId}
            onChange={(e) => setGuestId(e.target.value)}
            style={{
              width: "100%",
              maxWidth: 520,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              fontFamily: "inherit",
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {guests.length === 0 && (
              <option value="">אין אורחים עם קישור פורטל (14 יום)</option>
            )}
            {guests.map((g) => {
              const spa =
                g.spa_date && g.spa_date === g.arrival_date
                  ? ` · ספא ${g.spa_time || "—"}`
                  : "";
              return (
                <option key={g.id} value={g.id}>
                  {g.name || "ללא שם"} · {g.phone} · {g.arrival_date}
                  {spa}
                </option>
              );
            })}
          </select>

          {selected && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                תצוגת הודעה (כמו בוואטסאפ)
              </div>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontFamily: "inherit",
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: "var(--ivory)",
                  border: "1px solid var(--border)",
                  marginBottom: 12,
                  color: "var(--black)",
                }}
              >
                {previewWithHash || "— אין טקסט ב־bot_scripts.survey_invite_daypass"}
              </pre>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
                <button
                  type="button"
                  disabled={!localUrl}
                  onClick={() => window.open(localUrl, "_blank", "noopener,noreferrer")}
                  style={{
                    padding: "10px 16px",
                    borderRadius: 12,
                    border: "1.5px solid var(--gold-dark)",
                    background: "var(--ivory)",
                    color: "var(--gold-dark)",
                    fontWeight: 800,
                    cursor: localUrl ? "pointer" : "not-allowed",
                    fontFamily: "inherit",
                    fontSize: 13.5,
                    opacity: localUrl ? 1 : 0.5,
                  }}
                >
                  👁️ פתח סקר בפורטל (מקומי)
                </button>
                <button
                  type="button"
                  disabled={!prodUrl}
                  onClick={() => window.open(prodUrl, "_blank", "noopener,noreferrer")}
                  style={{
                    padding: "10px 16px",
                    borderRadius: 12,
                    border: "1.5px solid var(--border)",
                    background: "var(--card-bg)",
                    color: "var(--black)",
                    fontWeight: 800,
                    cursor: prodUrl ? "pointer" : "not-allowed",
                    fontFamily: "inherit",
                    fontSize: 13.5,
                    opacity: prodUrl ? 1 : 0.5,
                  }}
                >
                  🌐 פתח קישור כמו באורח (פרוד)
                </button>
                <button
                  type="button"
                  disabled={!selected || busy}
                  onClick={() => setConfirmSend(true)}
                  style={{
                    padding: "10px 16px",
                    borderRadius: 12,
                    border: "1.5px solid var(--gold-dark)",
                    background: "var(--gold-dark)",
                    color: "#fff",
                    fontWeight: 800,
                    cursor: busy ? "wait" : "pointer",
                    fontFamily: "inherit",
                    fontSize: 13.5,
                    opacity: busy ? 0.7 : 1,
                  }}
                >
                  {busy ? "שולח…" : "📱 שלח הודעה בוואטסאפ"}
                </button>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
                קישור בפרוד / בהודעה: {prodUrl || "—"}
              </div>
              {!(selected.spa_date && selected.spa_date === selected.arrival_date) && (
                <div style={{
                  marginTop: 10, fontSize: 12, color: "#9A3412", background: "#FFEDD5",
                  border: "1px solid #F97316", borderRadius: 10, padding: "8px 12px", lineHeight: 1.5,
                }}>
                  ⚠ לאורח זה אין ספא ביום ההגעה — בפורטל הסקר עלול לא להופיע (רק קוהורט בילוי-יומי+ספא).
                  בחרו אורח עם ספא ברשימה אם אפשר.
                </div>
              )}
            </>
          )}
        </>
      )}

      {confirmSend && selected && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => !busy && setConfirmSend(false)}
        >
          <div
            className="card"
            style={{ maxWidth: 420, width: "100%", padding: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 10 }}>לאשר שליחה?</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 16 }}>
              הודעת סקר אחת ל־<strong>{selected.name || selected.phone}</strong> דרך מכשיר הסוויטות.
              לא שידור המוני.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmSend(false)}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--card-bg)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: 700,
                }}
              >
                ביטול
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={sendInvite}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "none",
                  background: "var(--gold-dark)",
                  color: "#fff",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: 800,
                }}
              >
                כן — שלח
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
