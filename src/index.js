import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";
import App from "./App";

const rootElement = document.getElementById("root");
const root = createRoot(rootElement);

root.render(
  <StrictMode>
    <App />
  </StrictMode>
);

// ── Service Worker Registration (PWA + Push Notifications) ───────────────────
// Only active in production builds — avoids CRA hot-reload conflicts in dev.
if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
  window.addEventListener("load", function () {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then(function (reg) {
        console.log("[SW] registered, scope:", reg.scope);

        // Listen for subscription-change messages from the SW
        navigator.serviceWorker.addEventListener("message", function (event) {
          if (event.data && event.data.type === "PUSH_SUBSCRIPTION_CHANGED") {
            // Dispatch a custom DOM event so App.js can re-sync to Supabase
            window.dispatchEvent(
              new CustomEvent("pushsubscriptionchanged", { detail: event.data.subscription })
            );
          }
        });
      })
      .catch(function (err) {
        console.warn("[SW] registration failed:", err);
      });
  });
}
