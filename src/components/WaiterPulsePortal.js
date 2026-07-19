// Public waiter service pulse — /pulse/:token (no login).

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import WaiterPulseForm from "./WaiterPulseForm";

const GOLD = "#C9A96E";
const BG = "#0f172a";

export default function WaiterPulsePortal({ token }) {
  const [ui, setUi] = useState(null);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!isSupabaseConfigured || !supabase || !token) {
        setLoadError("הקישור אינו תקין.");
        setLoading(false);
        return;
      }
      try {
        const { data, error } = await supabase.functions.invoke("waiter-pulse-data", { body: { token } });
        if (!active) return;
        if (error || !data?.ok) {
          setLoadError(
            data?.error === "link_not_found"
              ? "הקישור אינו תקין, או שהוחלף בקישור חדש — פנו למנהל."
              : "שגיאה בטעינת הסקר.",
          );
        } else {
          setUi(data.ui);
          setLabel(data.label ?? "");
        }
      } catch (e) {
        if (active) setLoadError(e?.message ?? "שגיאה בטעינה.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token]);

  const handleSubmit = async (answers) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data, error } = await supabase.functions.invoke("waiter-pulse-submit", {
        body: { token, answers },
      });
      if (error || !data?.ok) {
        throw new Error(data?.message || data?.error || error?.message || "שגיאה בשליחה");
      }
      setDone({
        title: data.thank_you_title,
        body: data.thank_you_body,
      });
    } catch (e) {
      setSubmitError(e?.message ?? "השליחה נכשלה — נסו שוב.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: `linear-gradient(180deg, ${BG} 0%, #09090b 100%)`,
      padding: "24px 16px 40px",
      fontFamily: "Heebo, sans-serif",
      direction: "rtl",
    }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        {label && !done && (
          <div style={{ fontSize: 12, color: "rgba(248,250,252,0.45)", marginBottom: 12, textAlign: "center" }}>
            {label}
          </div>
        )}

        {loading && (
          <div style={{ textAlign: "center", color: GOLD, padding: 48 }}>טוען…</div>
        )}

        {loadError && (
          <div style={{
            textAlign: "center", color: "#F8FAFC", padding: 32,
            border: "1px solid rgba(231,76,60,0.4)", borderRadius: 16,
            background: "rgba(231,76,60,0.08)",
          }}>
            {loadError}
          </div>
        )}

        {done && (
          <div style={{ textAlign: "center", padding: "40px 12px" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <h1 style={{ color: GOLD, fontSize: 22, margin: "0 0 12px" }}>{done.title}</h1>
            <p style={{ color: "rgba(248,250,252,0.7)", lineHeight: 1.65, fontSize: 15 }}>{done.body}</p>
          </div>
        )}

        {!loading && !loadError && !done && ui && (
          <>
            <WaiterPulseForm ui={ui} variant="portal" onSubmit={handleSubmit} submitting={submitting} />
            {submitError && (
              <div style={{
                marginTop: 14, padding: "10px 12px", borderRadius: 10,
                background: "rgba(231,76,60,0.12)", color: "#FCA5A5", fontSize: 13,
              }}>
                {submitError}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
