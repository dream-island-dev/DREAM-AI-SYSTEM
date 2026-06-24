// src/components/cms/CMSPrivateRoute.js
// Sprint 7.2 — strict gate: blocks rendering of CMS children entirely unless
// both a live Supabase session AND aal2 (TOTP-verified) are present. Mirrors
// App.js's existing guardPage() pattern but checks the Supabase Auth session
// itself rather than the app-level `user.role`.
import { useAuth } from "../../context/AuthContext";
import CMSLogin from "./CMSLogin";
import SessionExpiryModal from "./SessionExpiryModal";

export default function CMSPrivateRoute({ children }) {
  const { loading, session, isAal2, sessionWarning } = useAuth();

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>
        טוען אבטחה...
      </div>
    );
  }

  if (!session || !isAal2) {
    return <CMSLogin />;
  }

  return (
    <>
      {sessionWarning && <SessionExpiryModal />}
      {children}
    </>
  );
}
