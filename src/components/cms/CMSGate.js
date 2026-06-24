// src/components/cms/CMSGate.js
// Convenience wrapper — drop this around any admin page to require a fresh
// password + TOTP (aal2) re-auth before it renders. One import for callers.
import { AuthProvider } from "../../context/AuthContext";
import CMSPrivateRoute from "./CMSPrivateRoute";

export default function CMSGate({ children }) {
  return (
    <AuthProvider>
      <CMSPrivateRoute>{children}</CMSPrivateRoute>
    </AuthProvider>
  );
}
