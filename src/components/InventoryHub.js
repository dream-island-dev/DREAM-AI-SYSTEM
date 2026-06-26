// src/components/InventoryHub.js
// Inventory Smart-Intake Module — top-level shell mounted at the "agent"
// route (replaces AgentQuestionnaire/AgentChat there; those files + their
// tables are left untouched/orphaned per the owner's explicit choice).
// Sub-tab shell pattern copied from AutomationControlCenter.js.

import { useState } from "react";
import InventoryImportPanel from "./InventoryImportPanel";
import InventoryLinksPanel from "./InventoryLinksPanel";
import InventoryApprovalQueue from "./InventoryApprovalQueue";

export default function InventoryHub({ user, onOpenScheduler }) {
  const [subTab, setSubTab] = useState("import"); // "import" | "links" | "approvals"

  return (
    <div>
      <style>{`
        @media (max-width: 640px) {
          .invhub-tabs { flex-direction: column; }
          .invhub-tabs button { width: 100%; text-align: center; padding: 12px 16px !important; min-height: 44px; }
        }
      `}</style>

      <div className="invhub-tabs" style={{ display: "flex", borderBottom: "2px solid var(--border)", marginBottom: 20, gap: 4 }}>
        {[
          { key: "import",    label: "📦 ייבוא מסמך" },
          { key: "links",     label: "🔗 קישורים" },
          { key: "approvals", label: "✅ ממתינים לאישור" },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setSubTab(key)} style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "10px 20px", fontSize: 14, fontWeight: subTab === key ? 800 : 500,
            color: subTab === key ? "var(--gold-dark)" : "var(--text-muted)",
            borderBottom: subTab === key ? "2px solid var(--gold-dark)" : "2px solid transparent",
            marginBottom: -2, fontFamily: "Heebo, sans-serif",
          }}>{label}</button>
        ))}
      </div>

      {subTab === "import"    && <InventoryImportPanel onOpenScheduler={onOpenScheduler} />}
      {subTab === "links"     && <InventoryLinksPanel />}
      {subTab === "approvals" && <InventoryApprovalQueue user={user} />}
    </div>
  );
}
