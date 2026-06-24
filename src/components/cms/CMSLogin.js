// src/components/cms/CMSLogin.js
// Sprint 7.2 — pristine login gateway for Admin CMS surfaces.
// Flow: email+password (supabase.auth.signInWithPassword) -> if no verified
// TOTP factor yet, enroll one (QR + manual secret) -> verify a 6-digit code
// to reach aal2. If a verified factor already exists, skip straight to the
// code-challenge step. Re-uses the existing .login-* classes from App.js's
// global stylesheet so this looks identical to the main LoginPage.
import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../../supabaseClient";
import { useAuth } from "../../context/AuthContext";

export default function CMSLogin() {
  const { session, signInWithPassword, refreshAal } = useAuth();

  const [phase, setPhase] = useState("credentials"); // credentials | enroll | challenge
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [enrollInfo, setEnrollInfo] = useState(null);   // { id, totp: { qr_code, secret } }
  const [activeFactorId, setActiveFactorId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Once a Supabase session exists (already logged into the main app, or
  // just signed in below), figure out whether this user needs to enroll a
  // fresh TOTP factor or just challenge an existing one.
  useEffect(() => {
    if (!session) { setPhase("credentials"); return; }
    let active = true;
    (async () => {
      setError("");
      const { data, error: listErr } = await supabase.auth.mfa.listFactors();
      if (!active) return;
      if (listErr) { setError(listErr.message); return; }
      const verified = (data?.totp ?? []).find((f) => f.status === "verified");
      if (verified) {
        setActiveFactorId(verified.id);
        setPhase("challenge");
        return;
      }
      const { data: enrolled, error: enrollErr } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `cms-${Date.now()}`,
      });
      if (!active) return;
      if (enrollErr) { setError(enrollErr.message); return; }
      setEnrollInfo(enrolled);
      setPhase("enroll");
    })();
    return () => { active = false; };
  }, [session]);

  const handleCredentialsSubmit = async () => {
    setError("");
    const raw = email.trim().toLowerCase();
    if (!raw || !password) { setError("נא למלא אימייל וסיסמה"); return; }
    setBusy(true);
    const { error: authErr } = await signInWithPassword(raw, password);
    setBusy(false);
    if (authErr) setError("אימייל או סיסמה שגויים");
    // success → session updates via onAuthStateChange → effect above runs
  };

  const handleVerify = async () => {
    const factorId = phase === "enroll" ? enrollInfo?.id : activeFactorId;
    if (!factorId) return;
    const code = otp.trim();
    if (code.length !== 6) { setError("קוד האימות צריך 6 ספרות"); return; }
    setError("");
    setBusy(true);
    const { error: verifyErr } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (verifyErr) { setError("קוד שגוי — נסה שוב"); return; }
    setOtp("");
    await refreshAal(); // session.currentLevel is now "aal2" → CMSPrivateRoute renders children
  };

  if (!isSupabaseConfigured) {
    return (
      <div className="login-bg">
        <div className="login-card">
          <div className="login-logo">
            <div className="island">🔐</div>
            <h1>CMS Security</h1>
            <div className="login-divider" />
          </div>
          <div className="login-error" style={{ marginTop: 0 }}>
            תכונת אבטחה זו דורשת חיבור Supabase פעיל — לא ניתן לאמת זהות במצב Demo/Offline
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-logo">
          <div className="island">🔐</div>
          <h1>CMS Security</h1>
          <p>ADMIN ACCESS · TWO-FACTOR AUTHENTICATION</p>
          <div className="login-divider" />
        </div>

        {phase === "credentials" && (
          <>
            <div className="login-field">
              <label>אימייל</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@dream.io"
                onKeyDown={(e) => e.key === "Enter" && handleCredentialsSubmit()}
                autoFocus
              />
            </div>
            <div className="login-field">
              <label>סיסמה</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                onKeyDown={(e) => e.key === "Enter" && handleCredentialsSubmit()}
              />
            </div>
            <button className="login-btn" onClick={handleCredentialsSubmit} disabled={busy}>
              {busy ? "מתחבר..." : "המשך לאימות דו-שלבי →"}
            </button>
          </>
        )}

        {phase === "enroll" && enrollInfo && (
          <>
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, textAlign: "center", marginBottom: 16 }}>
              הגדרה חד-פעמית: סרוק את הקוד עם אפליקציית Authenticator (Google Authenticator / Authy וכו')
            </div>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
              <img
                src={enrollInfo.totp?.qr_code}
                alt="TOTP QR"
                style={{ width: 180, height: 180, borderRadius: 8, background: "#fff", padding: 8 }}
              />
            </div>
            <div style={{
              textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.4)",
              marginBottom: 18, wordBreak: "break-all", direction: "ltr",
            }}>
              קוד ידני: {enrollInfo.totp?.secret}
            </div>
            <div className="login-field">
              <label>קוד אימות (6 ספרות)</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                style={{ textAlign: "center", letterSpacing: 4, direction: "ltr" }}
                onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                autoFocus
              />
            </div>
            <button className="login-btn" onClick={handleVerify} disabled={busy}>
              {busy ? "מאמת..." : "אשר והפעל 2FA"}
            </button>
          </>
        )}

        {phase === "challenge" && (
          <>
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, textAlign: "center", marginBottom: 18 }}>
              הזן את הקוד הנוכחי מאפליקציית Authenticator שלך
            </div>
            <div className="login-field">
              <label>קוד אימות (6 ספרות)</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                style={{ textAlign: "center", letterSpacing: 4, direction: "ltr" }}
                onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                autoFocus
              />
            </div>
            <button className="login-btn" onClick={handleVerify} disabled={busy}>
              {busy ? "מאמת..." : "אשר וכניסה"}
            </button>
          </>
        )}

        {error && <div className="login-error">{error}</div>}
      </div>
    </div>
  );
}
