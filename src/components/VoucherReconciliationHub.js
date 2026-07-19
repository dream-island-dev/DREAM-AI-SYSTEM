// src/components/VoucherReconciliationHub.js
// Voucher Reconciliation Engine (Yelena) — top-level shell, mounted at the
// "voucher_reconciliation" route (admin/super_admin). Sub-tab shell pattern
// copied from InventoryHub.js/AutomationControlCenter.js. Backend is fully
// deployed (reconcile-vouchers + suggest-import-mapping, migration 091) —
// this is the first UI surface for it.

import { useState } from "react";
import VoucherImportPanel from "./VoucherImportPanel";
import VoucherExceptionsBoard from "./VoucherExceptionsBoard";

export default function VoucherReconciliationHub({ user }) {
  const [subTab, setSubTab] = useState("import"); // "import" | "exceptions"
  const [lastRunId, setLastRunId] = useState(null);
  const [lastRunStats, setLastRunStats] = useState(null);

  return (
    <div>
      <style>{`
        @media (max-width: 640px) {
          .voucherhub-tabs { flex-direction: column; }
          .voucherhub-tabs button { width: 100%; text-align: center; padding: 12px 16px !important; min-height: 44px; }
        }
      `}</style>

      <div className="voucherhub-tabs" style={{ display: "flex", borderBottom: "2px solid var(--border)", marginBottom: 20, gap: 4 }}>
        {[
          { key: "import",     label: "🧾 ייבוא והתאמה" },
          { key: "exceptions", label: "📋 דוח חריגים" },
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

      {subTab === "import"     && (
        <VoucherImportPanel
          onViewExceptions={(runId, stats) => {
            if (runId) setLastRunId(runId);
            if (stats) setLastRunStats(stats);
            setSubTab("exceptions");
          }}
        />
      )}
      {subTab === "exceptions" && (
        <VoucherExceptionsBoard user={user} filterRunId={lastRunId} runStats={lastRunStats} />
      )}
    </div>
  );
}
