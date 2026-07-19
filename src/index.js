import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";
import App from "./App";
import GuestPortal from "./components/GuestPortal";
import InventoryPortal from "./components/InventoryPortal";
import WaiterPulsePortal from "./components/WaiterPulsePortal";
import KitchenDisplayScreen from "./components/KitchenDisplayScreen";
import { captureStaffDeepLinkFromUrl } from "./utils/staffDeepLink";

const rootElement = document.getElementById("root");
const root = createRoot(rootElement);

// Guest Portal — public, password-less magic-link route (Pre-Arrival Guest
// Portal session). Checked HERE, before <App/> ever mounts, so the entire
// staff-auth hook chain (Supabase session listener, push-notification
// subscription, etc.) never initializes for an unauthenticated guest opening
// their own portal link. There's no react-router-dom in this project
// (CLAUDE.md §2 — deliberate, no routing library) — this is the one public
// surface, so a single window.location.pathname check is simpler and safer
// than adding a routing library just for it. Vercel's CRA preset already
// rewrites unknown paths to /index.html (no vercel.json needed), and CRA's
// own dev server does the same via its built-in historyApiFallback.
const portalMatch = window.location.pathname.match(/^\/portal\/([^/?#]+)/);
// Inventory Smart-Intake Module — same no-auth-chain reasoning as the Guest
// Portal above, for the employee's daily-fill phone screen.
const inventoryMatch = window.location.pathname.match(/^\/inv\/([^/?#]+)/);
const pulseMatch = window.location.pathname.match(/^\/pulse\/([^/?#]+)/);
const kdsMatch = window.location.pathname.match(/^\/kds\/([^/?#]+)/);
const adminUpdatesPath = /^\/admin\/updates\/?$/.test(window.location.pathname);

if (!portalMatch && !inventoryMatch && !pulseMatch && !kdsMatch) {
  captureStaffDeepLinkFromUrl();
}

root.render(
  <StrictMode>
    {portalMatch ? (
      <GuestPortal token={portalMatch[1]} />
    ) : inventoryMatch ? (
      <InventoryPortal token={inventoryMatch[1]} />
    ) : pulseMatch ? (
      <WaiterPulsePortal token={pulseMatch[1]} />
    ) : kdsMatch ? (
      <KitchenDisplayScreen token={kdsMatch[1]} />
    ) : (
      <App initialPage={adminUpdatesPath ? "admin_updates" : "dashboard"} />
    )}
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
