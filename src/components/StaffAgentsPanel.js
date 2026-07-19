// StaffAgentsPanel — living persona cards for XOS staff assistants.

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { STAFF_AGENTS } from "../data/staffAgentRoster";

function formatWhen(iso) {
  if (!iso) return "עדיין לא פעילה";
  return new Date(iso).toLocaleString("he-IL", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function hoursSince(iso) {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

function pulseStatus(lastAt) {
  const h = hoursSince(lastAt);
  if (h === null) return { label: "ממתינה", color: "#94A3B8", dot: "#CBD5E1" };
  if (h < 26) return { label: "חיה", color: "#1A7A4A", dot: "#22C55E" };
  if (h < 72) return { label: "שקטה", color: "#B45309", dot: "#F59E0B" };
  return { label: "לא נשמעה", color: "#94A3B8", dot: "#CBD5E1" };
}

function excerptBody(text, lines = 4) {
  if (!text?.trim()) return "—";
  return text.split("\n").slice(0, lines).join("\n");
}

export default function StaffAgentsPanel({ showToast, onOpenStaffNotify, onOpenPlaybook, onOpenRoute }) {
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(STAFF_AGENTS[0]?.id ?? null);
  const [live, setLive] = useState({});
  const [previewing, setPreviewing] = useState(false);
  const [previewBody, setPreviewBody] = useState("");

  const selected = useMemo(() => STAFF_AGENTS.find((a) => a.id === selectedId) ?? null, [selectedId]);

  const fetchLive = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const since24h = new Date(Date.now() - 24 * 3_600_000).toISOString();

    const [
      eliadDigest,
      adirBrief,
      oritDigest,
      oritAlert,
      rulesExec,
      rulesDesk,
      botActive,
      botWhapi,
      ...actionLogs
    ] = await Promise.all([
      supabase.from("resort_digest_log").select("body_sent, sent_at, period").eq("period", "daily").order("sent_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("front_desk_morning_log").select("body_sent, sent_at, digest_date").order("sent_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("orit_agent_digest_log").select("body_sent, sent_at, digest_date").order("sent_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("orit_agent_alert_log").select("body_sent, sent_at").order("sent_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("xos_ai_rules").select("id", { count: "exact", head: true }).eq("module", "executive"),
      supabase.from("xos_ai_rules").select("id", { count: "exact", head: true }).eq("module", "front_desk"),
      supabase.from("bot_config").select("config_value").eq("config_key", "bot_active").maybeSingle(),
      supabase.from("bot_config").select("config_value").eq("config_key", "bot_active_whapi").maybeSingle(),
      ...STAFF_AGENTS.filter((a) => a.phoneDigits).map((a) =>
        supabase.from("executive_action_log").select("tool_name, created_at").eq("phone", a.phoneDigits).gte("created_at", since24h).order("created_at", { ascending: false }).limit(5),
      ),
    ]);

    const phoneAgents = STAFF_AGENTS.filter((a) => a.phoneDigits);
    const actionByPhone = {};
    phoneAgents.forEach((a, i) => {
      const res = actionLogs[i];
      actionByPhone[a.phoneDigits] = res?.data ?? [];
    });

    const oritDigestAt = oritDigest.data?.sent_at ? new Date(oritDigest.data.sent_at).getTime() : 0;
    const oritAlertAt = oritAlert.data?.sent_at ? new Date(oritAlert.data.sent_at).getTime() : 0;
    const oritUseAlert = oritAlertAt >= oritDigestAt && oritAlertAt > 0;

    setLive({
      eliad: {
        lastAt: eliadDigest.data?.sent_at ?? null,
        lastBody: eliadDigest.data?.body_sent ?? null,
        rulesCount: rulesExec.count ?? 0,
        actions24h: actionByPhone["972505421751"]?.length ?? 0,
      },
      adir: {
        lastAt: adirBrief.data?.sent_at ?? null,
        lastBody: adirBrief.data?.body_sent ?? null,
        rulesCount: rulesDesk.count ?? 0,
        actions24h: actionByPhone["972546294885"]?.length ?? 0,
      },
      mike: {
        lastAt: actionByPhone["972506842439"]?.[0]?.created_at ?? null,
        lastBody: actionByPhone["972506842439"]?.length
          ? `פעולות אחרונות (24ש׳):\n${actionByPhone["972506842439"].map((r) => `• ${r.tool_name}`).join("\n")}`
          : null,
        rulesCount: rulesExec.count ?? 0,
        actions24h: actionByPhone["972506842439"]?.length ?? 0,
      },
      orit: {
        lastAt: oritUseAlert
          ? oritAlert.data?.sent_at ?? null
          : oritDigest.data?.sent_at ?? oritAlert.data?.sent_at ?? null,
        lastBody: oritUseAlert
          ? oritAlert.data?.body_sent ?? null
          : oritDigest.data?.body_sent ?? oritAlert.data?.body_sent ?? null,
      },
      dream: {
        metaOn: String(botActive.data?.config_value ?? "true").toLowerCase() !== "false",
        whapiOn: String(botWhapi.data?.config_value ?? "true").toLowerCase() !== "false",
      },
    });
    setLoading(false);
  }, []);

  useEffect(() => { fetchLive(); }, [fetchLive]);

  const liveForAgent = useCallback((agent) => {
    if (agent.id === "noa_eliad") return live.eliad ?? {};
    if (agent.id === "liat_adir") return live.adir ?? {};
    if (agent.id === "maya_mike") return live.mike ?? {};
    if (agent.id === "sigal_orit") return live.orit ?? {};
    if (agent.id === "dream_bot") return live.dream ?? {};
    return {};
  }, [live]);

  const runPreview = useCallback(async () => {
    if (!selected?.previewTemplateKey || !isSupabaseConfigured || !supabase) return;
    setPreviewing(true);
    setPreviewBody("");
    const payload = { template_key: selected.previewTemplateKey };
    if (selected.previewPeriod) payload.period = selected.previewPeriod;
    const { data, error } = await supabase.functions.invoke("staff-notify-preview", { body: payload });
    setPreviewing(false);
    if (error || !data?.ok) {
      showToast("err", "תצוגה מקדימה נכשלה");
      return;
    }
    setPreviewBody(data.preview_body ?? "");
  }, [selected, showToast]);

  useEffect(() => {
    setPreviewBody("");
    if (selected?.previewTemplateKey) runPreview();
  }, [selectedId, selected?.previewTemplateKey, runPreview]);

  return (
    <div>
      <div style={{
        background: "linear-gradient(135deg, rgba(26,122,74,0.08) 0%, rgba(107,33,168,0.06) 100%)",
        border: "1px solid var(--border)", borderRadius: 12,
        padding: "14px 20px", marginBottom: 20, fontSize: 13, lineHeight: 1.65, color: "var(--text-muted)",
      }}>
        כל כרטיס = <strong>דמות חיה</strong> במערכת: מי היא, למי מלווה, מתי נשמעה לאחרונה, ומה שלחה.
        עומק מלא — בלשוניות פרומפט / הודעות.
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>⏳ טוען סוכנים…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14, marginBottom: 24 }}>
          {STAFF_AGENTS.map((agent) => {
            const stats = liveForAgent(agent);
            const lastAt = stats.lastAt ?? null;
            const status = agent.id === "dream_bot"
              ? { label: stats.metaOn || stats.whapiOn ? "פעיל" : "כבוי", color: stats.metaOn || stats.whapiOn ? "#1A7A4A" : "#94A3B8", dot: stats.metaOn || stats.whapiOn ? "#22C55E" : "#CBD5E1" }
              : pulseStatus(lastAt);
            const isSelected = selectedId === agent.id;
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => setSelectedId(agent.id)}
                style={{
                  textAlign: "right", cursor: "pointer", padding: "16px 14px", borderRadius: 14,
                  border: isSelected ? `2px solid ${agent.accent}` : "1px solid var(--border)",
                  background: isSelected ? agent.accentSoft : "var(--card-bg, #fff)",
                  boxShadow: isSelected ? `0 4px 20px ${agent.accentSoft}` : "none",
                  transition: "border 0.15s, box-shadow 0.15s",
                }}
              >
                <div style={{ fontSize: 36, marginBottom: 8, lineHeight: 1 }}>{agent.emoji}</div>
                <div style={{ fontWeight: 800, fontSize: 16, color: agent.accent }}>{agent.name}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{agent.roleHe}</div>
                <div style={{ fontSize: 11, marginTop: 6, color: "var(--text-muted)" }}>מלווה את {agent.owner}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 11, fontWeight: 700, color: status.color }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: status.dot, flexShrink: 0 }} />
                  {status.label}
                  {lastAt && <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>· {formatWhen(lastAt)}</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="card" style={{ borderColor: selected.accent }}>
          <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div className="card-title" style={{ color: selected.accent }}>
                {selected.emoji} {selected.name} — {selected.roleHe}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                {selected.ownerTitle ? `${selected.owner} (${selected.ownerTitle})` : selected.owner} · {selected.channel}
              </div>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={fetchLive}>🔄 רענן</button>
          </div>
          <div style={{ padding: "16px 20px" }}>
            <p style={{ margin: "0 0 14px", fontSize: 14, lineHeight: 1.65 }}>{selected.tagline}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
              {selected.capabilities.map((c) => (
                <span key={c} style={{
                  fontSize: 11, padding: "4px 10px", borderRadius: 20,
                  background: selected.accentSoft, color: selected.accent, fontWeight: 600,
                }}>
                  {c}
                </span>
              ))}
            </div>

            {selected.id === "dream_bot" && live.dream && (
              <div style={{ fontSize: 13, marginBottom: 14 }}>
                Dream Bot (Meta): <strong>{live.dream.metaOn ? "🟢 פעיל" : "⚫ כבוי"}</strong>
                {" · "}
                Whapi אורחים: <strong>{live.dream.whapiOn ? "🟢 פעיל" : "⚫ כבוי"}</strong>
              </div>
            )}

            {liveForAgent(selected).rulesCount != null && selected.rulesModule && (
              <div style={{ fontSize: 13, marginBottom: 10 }}>
                כללים שנלמדו: <strong>{liveForAgent(selected).rulesCount}</strong>
                {liveForAgent(selected).actions24h != null && (
                  <> · פעולות ב-24ש׳: <strong>{liveForAgent(selected).actions24h}</strong></>
                )}
              </div>
            )}

            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>מה נשלח לאחרונה</div>
            <pre style={{
              margin: 0, padding: "12px 14px", borderRadius: 8, background: "var(--ivory)",
              border: "1px solid var(--border)", fontSize: 12, lineHeight: 1.55,
              whiteSpace: "pre-wrap", direction: "rtl", fontFamily: "inherit", maxHeight: 220, overflow: "auto",
            }}>
              {excerptBody(liveForAgent(selected).lastBody, 8)}
            </pre>

            {selected.previewTemplateKey && (
              <>
                <div style={{ fontWeight: 700, fontSize: 13, margin: "16px 0 8px" }}>תצוגה מקדימה (דאטה חי עכשיו)</div>
                <pre style={{
                  margin: 0, padding: "12px 14px", borderRadius: 8,
                  border: `1px solid ${selected.accent}`, background: selected.accentSoft,
                  fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap", direction: "rtl",
                  fontFamily: "inherit", maxHeight: 260, overflow: "auto",
                }}>
                  {previewing ? "⏳ טוען…" : (previewBody || "—")}
                </pre>
              </>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
              {selected.staffNotifyRecipient && onOpenStaffNotify && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => onOpenStaffNotify(selected.staffNotifyRecipient)}
                >
                  📨 עריכת הודעות
                </button>
              )}
              {selected.rulesModule && onOpenPlaybook && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenPlaybook}>
                  🧠 פרומפט וכללים
                </button>
              )}
              {selected.appRoute && onOpenRoute && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpenRoute(selected.appRoute)}>
                  ↗ פתח מסך
                </button>
              )}
              {selected.previewTemplateKey && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={runPreview} disabled={previewing}>
                  👁 רענן תצוגה
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
