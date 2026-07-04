// src/components/EditableGrid.js
// Universal Editable Grid — column-driven, reusable across import surfaces.
// Originally built inside DataHub.js; extracted so any future data source
// (suites, spa, shifts) can reuse the same inline-edit + bulk-replace UX
// instead of each import tool reinventing its own table.

import { useState } from "react";

// ── Grid ─────────────────────────────────────────────────────────────────────
export function EditableGrid({ columns, rows, onRowsChange, selectedIds, onSelectionChange }) {
  const [editingCell, setEditingCell] = useState(null); // { ri, colId }

  const startEdit = (ri, colId) => {
    const col = columns.find(c => c.id === colId);
    if (!col?.editable) return;
    const row = rows[ri];
    if (col.cellEditable && row && !col.cellEditable(row)) return;
    setEditingCell({ ri, colId });
  };

  const commitEdit = (ri, colId, val) => {
    onRowsChange(rows.map((r, i) => i === ri ? { ...r, [colId]: val } : r));
    setEditingCell(null);
  };

  const handleKeyDown = (e, ri, colId) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const val     = e.target.value;
      const colIdx  = columns.findIndex(c => c.id === colId);
      const nextCol = columns.slice(colIdx + 1).find(c => c.editable);
      commitEdit(ri, colId, val);
      if (nextCol) setTimeout(() => setEditingCell({ ri, colId: nextCol.id }), 30);
    } else if (e.key === "Enter") {
      commitEdit(ri, colId, e.target.value);
    } else if (e.key === "Escape") {
      setEditingCell(null);
    }
  };

  const toggleRow = (id) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    onSelectionChange(next);
  };

  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r._id));
  const partSelected = rows.some((r) => selectedIds.has(r._id)) && !allSelected;

  return (
    <div style={{
      overflowX: "auto", overflowY: "auto", maxHeight: "58vh",
      border: "1px solid var(--border)", borderRadius: 10,
    }}>
      <table style={{ borderCollapse: "collapse", minWidth: "100%", fontSize: 13, fontFamily: "Heebo,sans-serif" }}>
        <thead>
          <tr style={{ background: "var(--ivory)", position: "sticky", top: 0, zIndex: 10 }}>
            <th style={{ padding: "10px 10px", borderBottom: "2px solid var(--border)", width: 38, textAlign: "center" }}>
              <input
                type="checkbox"
                checked={allSelected}
                ref={el => { if (el) el.indeterminate = partSelected; }}
                onChange={() => onSelectionChange(allSelected ? new Set() : new Set(rows.map(r => r._id)))}
                style={{ cursor: "pointer" }}
              />
            </th>
            <th style={{ padding: "10px 8px", borderBottom: "2px solid var(--border)", width: 36, color: "var(--text-muted)", fontSize: 10, fontWeight: 700, textAlign: "center" }}>#</th>
            {columns.map(col => (
              <th key={col.id} style={{
                padding: "10px 12px", borderBottom: "2px solid var(--border)",
                textAlign: "right", whiteSpace: "nowrap", minWidth: col.w ?? 100,
                fontFamily: "Heebo,sans-serif", fontSize: 11, fontWeight: 700,
                letterSpacing: "0.4px", textTransform: "uppercase",
                color:      col.gold ? "var(--gold-dark)" : "var(--text-muted)",
                background: col.gold ? "rgba(201,169,110,0.08)" : undefined,
              }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const isSelected = selectedIds.has(row._id);
            return (
              <tr key={row._id} style={{
                background: isSelected
                  ? "rgba(201,169,110,0.1)"
                  : ri % 2 === 0 ? "#fff" : "var(--ivory)",
                transition: "background 0.1s",
              }}>
                <td style={{ padding: "5px 10px", borderBottom: "1px solid var(--border)", textAlign: "center" }}>
                  <input type="checkbox" checked={isSelected} onChange={() => toggleRow(row._id)} style={{ cursor: "pointer" }} />
                </td>
                <td style={{ padding: "5px 8px", borderBottom: "1px solid var(--border)", textAlign: "center", fontSize: 11, color: "var(--text-muted)" }}>
                  {ri + 1}
                </td>
                {columns.map(col => {
                  const isEditing = editingCell?.ri === ri && editingCell?.colId === col.id;
                  const val       = row[col.id] ?? "";
                  const canEdit   = col.editable && (!col.cellEditable || col.cellEditable(row));

                  return (
                    <td key={col.id}
                      onClick={() => !isEditing && canEdit && startEdit(ri, col.id)}
                      style={{
                        padding:     isEditing ? 0 : "7px 12px",
                        borderBottom: "1px solid var(--border)",
                        minWidth:    col.w ?? 100,
                        background:  col.gold ? "rgba(201,169,110,0.06)" : undefined,
                        borderLeft:  col.gold ? "2px solid rgba(201,169,110,0.4)" : undefined,
                        cursor:      canEdit ? "text" : "default",
                        position:    "relative",
                      }}>
                      {isEditing ? (
                        col.options ? (
                          <select
                            autoFocus
                            defaultValue={val}
                            onChange={e  => commitEdit(ri, col.id, e.target.value)}
                            onBlur={e    => commitEdit(ri, col.id, e.target.value)}
                            style={{
                              width: "100%", height: 34, padding: "4px 8px",
                              border: "2px solid var(--gold)", borderRadius: 4,
                              fontFamily: "Heebo,sans-serif", fontSize: 13, outline: "none",
                            }}
                          >
                            {col.options.map(o => (
                              <option key={o.value ?? o} value={o.value ?? o}>
                                {(o.label ?? o) || "— בחר —"}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            autoFocus
                            defaultValue={val}
                            onBlur={e    => commitEdit(ri, col.id, e.target.value)}
                            onKeyDown={e => handleKeyDown(e, ri, col.id)}
                            style={{
                              width: "100%", height: 34, padding: "4px 12px",
                              border: `2px solid ${col.gold ? "var(--gold)" : "#6366f1"}`,
                              borderRadius: 4, boxSizing: "border-box",
                              fontFamily: "Heebo,sans-serif", fontSize: 13, outline: "none",
                              background: col.gold ? "rgba(201,169,110,0.1)" : "#fff",
                            }}
                          />
                        )
                      ) : col.gold && !val ? (
                        <span style={{ color: "var(--gold)", fontStyle: "italic", fontSize: 12, opacity: 0.7 }}>
                          לחץ לבחירה...
                        </span>
                      ) : (
                        <span style={{
                          display: "block",
                          fontWeight: col.gold && val ? 700 : undefined,
                          color:     col.gold && val ? "var(--gold-dark)" : undefined,
                          direction: col.id === "phone" || col.id === "guestPhone" ? "ltr" : undefined,
                          textAlign: col.id === "phone" || col.id === "guestPhone" ? "right" : undefined,
                        }}>
                          {col.options
                            ? (col.options.find((o) => String(o.value ?? o) === String(val))?.label ?? (val || "—"))
                            : (col.id === "phone" || col.id === "guestPhone") && val
                              ? String(val).replace(/^\+?972/, "0")
                              : (val || "—")}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Bulk edit bar ────────────────────────────────────────────────────────────
export function BulkEditBar({ count, columns, onReplace, onClear }) {
  const editableCols    = columns.filter(c => c.editable);
  const [col,    setCol]    = useState(editableCols[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [repl,   setRepl]   = useState("");

  const apply = () => {
    if (!col) return;
    onReplace(col, search, repl);
    setSearch(""); setRepl("");
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
      background: "linear-gradient(135deg,rgba(201,169,110,0.15),rgba(201,169,110,0.04))",
      border: "1px solid var(--gold)", borderRadius: 10, padding: "10px 14px", marginBottom: 10,
    }}>
      <span style={{ fontWeight: 800, fontSize: 13, color: "var(--gold-dark)", whiteSpace: "nowrap" }}>
        ✏️ {count} שורות
      </span>
      <select value={col} onChange={e => setCol(e.target.value)}
        style={{ padding: "7px 10px", borderRadius: 7, border: "1.5px solid var(--border)", fontFamily: "Heebo,sans-serif", fontSize: 13, background: "#fff" }}>
        {editableCols.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      <input placeholder="חפש טקסט..." value={search} onChange={e => setSearch(e.target.value)}
        onKeyDown={e => e.key === "Enter" && apply()}
        style={{ padding: "7px 10px", borderRadius: 7, border: "1.5px solid var(--border)", fontFamily: "Heebo,sans-serif", fontSize: 13, width: 140, background: "#fff" }} />
      <span style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1 }}>→</span>
      <input placeholder="החלף ב..." value={repl} onChange={e => setRepl(e.target.value)}
        onKeyDown={e => e.key === "Enter" && apply()}
        style={{ padding: "7px 10px", borderRadius: 7, border: "1.5px solid var(--border)", fontFamily: "Heebo,sans-serif", fontSize: 13, width: 140, background: "#fff" }} />
      <button onClick={apply}
        style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--gold)", color: "#0F0F0F", fontWeight: 800, fontFamily: "Heebo,sans-serif", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
        החל
      </button>
      <button onClick={onClear}
        style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "#fff", fontFamily: "Heebo,sans-serif", fontSize: 13, cursor: "pointer", color: "var(--text-muted)" }}>
        ✕ בטל
      </button>
    </div>
  );
}

// ── Excel export helper (shared by shift_schedule profile etc.) ────────────
export async function exportToExcel(columns, rows, filename = "export.xlsx") {
  const XLSX    = await import("xlsx");
  const headers = columns.map(c => c.label);
  const data    = rows.map(r => columns.map(c => r[c.id] ?? ""));
  const ws      = XLSX.utils.aoa_to_sheet([headers, ...data]);
  const colWidths = columns.map(c => ({ wch: Math.max(c.label.length + 2, 14) }));
  ws["!cols"] = colWidths;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, filename);
}
