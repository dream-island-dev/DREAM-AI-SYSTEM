// Operational home — live tasks + guest_alerts + urgent signals from Supabase.
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { usePageVisibility } from "../hooks/usePageVisibility";
import { useDebouncedCallback } from "../hooks/useDebouncedCallback";
import { canPerform } from "../utils/auth";
import {
  computeResortPulse,
  buildGuestsByPhoneKey,
  countActiveInboxAlerts,
} from "../utils/resortPulseStats";
import { fetchGuestsForResortPulse } from "../utils/resortPulseFetch";
import { isSuiteArrivingToday, israelTodayStr } from "../utils/guestTiming";

const ALERT_TYPE_META = {
  complaint: { label: "🔴 תקלה" },
  date_change_request: { label: "🗓️ שינוי תאריך" },
  request: { label: "📝 בקשה" },
  upsell_opportunity: { label: "🌴 בקשה מהפורטל" },
  portal_room_service: { label: "🍽️ שירות לחדר" },
  financial_issue: { label: "💳 בעיית חיוב" },
  spa_request: { label: "💆 בקשת ספא" },
  spa_upsell_accept: { label: "💆 אישור הצעת ספא" },
  arrival_eta: { label: "🕐 שעת הגעה" },
};

function alertTypeLabel(type) {
  return ALERT_TYPE_META[type]?.label ?? `⚠ ${type ?? "ללא סוג"}`;
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

function fmtTodayLabel(ymd) {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

function taskStatusBadge(status) {
  if (status === "done") return { cls: "badge-green", text: "בוצע" };
  if (status === "in_progress") return { cls: "badge-orange", text: "בטיפול" };
  if (status === "pending_approval") return { cls: "badge-purple", text: "ממתין לאישור" };
  if (status === "rejected") return { cls: "badge-gray", text: "נדחה" };
  return { cls: "badge-red", text: "פתוח" };
}

function priorityDot(priority) {
  if (priority === "urgent") return "red";
  if (priority === "normal") return "orange";
  return "green";
}

function CardLinkHeader({ title, onClick, linkLabel = "הצג הכל ←" }) {
  return (
    <div className="card-header">
      <div className="card-title">{title}</div>
      {onClick && (
        <button
          type="button"
          onClick={onClick}
          style={{
            border: "none",
            background: "transparent",
            color: "var(--gold-dark)",
            fontWeight: 700,
            fontSize: 12,
            cursor: "pointer",
            fontFamily: "Heebo, sans-serif",
          }}
        >
          {linkLabel}
        </button>
      )}
    </div>
  );
}

export default function OperationalDashboard({
  user,
  onNavigate,
  onOpenDreamBotChat,
  onAttentionClick,
  onArrivalsClick,
  onInResortClick,
  onAutomationClick,
}) {
  const pageVisible = usePageVisibility();
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [requests, setRequests] = useState([]);
  const [pulse, setPulse] = useState(null);
  const [missingEtaCount, setMissingEtaCount] = useState(0);
  const [blockedAutomation, setBlockedAutomation] = useState(0);
  const [kpi, setKpi] = useState({
    openTasks: 0,
    pendingApproval: 0,
    urgentTasks: 0,
    openRequests: 0,
    complaints: 0,
  });
  const todayStr = israelTodayStr();
  const canCreate = canPerform("create_ops_task", user);
  const userDept = user?.department || "";

  const recentTasks = useMemo(() => {
    const actionable = tasks.filter((t) =>
      ["pending_approval", "open", "in_progress"].includes(t.status),
    );
    const pool = actionable.length ? actionable : tasks;
    return [...pool]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5);
  }, [tasks]);

  const openRequests = useMemo(
    () => requests.filter((r) => !r.resolved),
    [requests],
  );

  const recentRequests = useMemo(
    () =>
      [...openRequests]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 5),
    [openRequests],
  );

  const urgentItems = useMemo(() => {
    const items = [];
    if (kpi.pendingApproval > 0) {
      items.push({
        key: "pending",
        text: `${kpi.pendingApproval} משימות ממתינות לאישור צוות`,
        action: () => onNavigate?.("ops_board"),
      });
    }
    if (kpi.complaints > 0) {
      items.push({
        key: "complaints",
        text: `${kpi.complaints} תלונות אורח פתוחות`,
        action: () => onNavigate?.("requests_board"),
      });
    }
    if ((pulse?.needsAttentionSuite ?? 0) > 0) {
      items.push({
        key: "inbox_suite",
        text: `${pulse.needsAttentionSuite} שיחות Inbox דורשות טיפול (סוויטות)`,
        action: () => onAttentionClick?.("suite"),
      });
    }
    if ((pulse?.needsAttentionDaypass ?? 0) > 0) {
      items.push({
        key: "inbox_daypass",
        text: `${pulse.needsAttentionDaypass} שיחות Inbox דורשות טיפול (בילוי יומי)`,
        action: () => onAttentionClick?.("daypass"),
      });
    }
    if ((pulse?.needsAttentionUnmatched ?? 0) > 0) {
      items.push({
        key: "inbox_unmatched",
        text: `${pulse.needsAttentionUnmatched} שיחות Inbox דורשות טיפול (לא משויך לאורח)`,
        action: onAttentionClick,
      });
    }
    if (missingEtaCount > 0) {
      items.push({
        key: "eta",
        text: `${missingEtaCount} הגעות היום ללא שעת הגעה`,
        action: onArrivalsClick,
      });
    }
    if (blockedAutomation > 0) {
      items.push({
        key: "automation",
        text: `${blockedAutomation} אוטומציות חסומות ב-Meta`,
        action: onAutomationClick,
      });
    }
    return items;
  }, [
    kpi.pendingApproval,
    kpi.complaints,
    pulse?.needsAttentionSuite,
    pulse?.needsAttentionDaypass,
    pulse?.needsAttentionUnmatched,
    missingEtaCount,
    blockedAutomation,
    onNavigate,
    onAttentionClick,
    onArrivalsClick,
    onAutomationClick,
  ]);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      let taskQuery = supabase
        .from("tasks")
        .select("*, guests(name, room, arrival_date, departure_date, status)")
        .order("created_at", { ascending: false })
        .limit(40);
      if (!canCreate && userDept) {
        taskQuery = taskQuery.eq("department", userDept);
      }

      const openTasksCountQ = (() => {
        let q = supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .in("status", ["open", "in_progress"]);
        if (!canCreate && userDept) q = q.eq("department", userDept);
        return q;
      })();
      const pendingCountQ = (() => {
        let q = supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending_approval");
        if (!canCreate && userDept) q = q.eq("department", userDept);
        return q;
      })();
      const urgentCountQ = (() => {
        let q = supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("priority", "urgent")
          .in("status", ["open", "in_progress"]);
        if (!canCreate && userDept) q = q.eq("department", userDept);
        return q;
      })();

      const [
        tasksRes,
        alertsRes,
        guestsPack,
        waRes,
        openTasksRes,
        pendingRes,
        urgentRes,
        openAlertsRes,
        complaintRes,
      ] = await Promise.all([
        taskQuery,
        supabase
          .from("guest_alerts")
          .select("*, guests(name, room, arrival_date, departure_date, status)")
          .order("created_at", { ascending: false })
          .limit(40),
        fetchGuestsForResortPulse(supabase),
        supabase
          .from("whatsapp_conversations")
          .select("phone")
          .eq("human_requested", true)
          .eq("direction", "inbound"),
        openTasksCountQ,
        pendingCountQ,
        urgentCountQ,
        supabase
          .from("guest_alerts")
          .select("id", { count: "exact", head: true })
          .eq("resolved", false),
        supabase
          .from("guest_alerts")
          .select("id", { count: "exact", head: true })
          .eq("resolved", false)
          .eq("alert_type", "complaint"),
      ]);

      if (tasksRes.error) throw tasksRes.error;
      if (alertsRes.error) throw alertsRes.error;
      if (waRes.error) throw waRes.error;

      const guests = guestsPack.guests ?? [];
      const guestsByPhone = buildGuestsByPhoneKey(guests);
      const inboxAlerts = countActiveInboxAlerts(
        (waRes.data ?? []).map((r) => r.phone),
        guestsByPhone,
      );

      let blocked = 0;
      try {
        const { data: q } = await supabase.functions.invoke("automation-queue");
        if (q?.attentionRequired) {
          blocked = q.attentionRequired.filter(
            (r) => r.status === "blocked_by_meta",
          ).length;
        }
      } catch {
        /* optional preview */
      }

      const missingEta = guests.filter(
        (g) => isSuiteArrivingToday(g) && !(g.arrival_time ?? "").trim(),
      ).length;

      const openTaskCount = openTasksRes.count ?? 0;
      setTasks(tasksRes.data ?? []);
      setRequests(alertsRes.data ?? []);
      setKpi({
        openTasks: openTaskCount,
        pendingApproval: pendingRes.count ?? 0,
        urgentTasks: urgentRes.count ?? 0,
        openRequests: openAlertsRes.count ?? 0,
        complaints: complaintRes.count ?? 0,
      });
      setPulse(
        computeResortPulse(guests, {
          inboxAlertsCount: inboxAlerts.total,
          inboxAlertsCountSuite: inboxAlerts.suite,
          inboxAlertsCountDaypass: inboxAlerts.daypass,
          inboxAlertsCountUnmatched: inboxAlerts.unmatched,
          blockedAutomation: blocked,
          openOpsTasks: openTaskCount,
        }),
      );
      setMissingEtaCount(missingEta);
      setBlockedAutomation(blocked);
    } catch (e) {
      console.warn("[OperationalDashboard] refresh:", e?.message ?? e);
    } finally {
      setLoading(false);
    }
  }, [canCreate, userDept]);

  const debouncedRefresh = useDebouncedCallback(refresh, 2500);

  useEffect(() => {
    if (!pageVisible) return undefined;
    refresh();
    if (!isSupabaseConfigured || !supabase) return undefined;

    const chTasks = supabase
      .channel("ops-dashboard-tasks")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        () => debouncedRefresh(),
      )
      .subscribe();
    const chAlerts = supabase
      .channel("ops-dashboard-alerts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "guest_alerts" },
        () => debouncedRefresh(),
      )
      .subscribe();
    const chGuests = supabase
      .channel("ops-dashboard-guests")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "guests" },
        () => debouncedRefresh(),
      )
      .subscribe();
    const chWa = supabase
      .channel("ops-dashboard-wa")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_conversations" },
        () => debouncedRefresh(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(chTasks);
      supabase.removeChannel(chAlerts);
      supabase.removeChannel(chGuests);
      supabase.removeChannel(chWa);
    };
  }, [refresh, debouncedRefresh, pageVisible]);

  if (loading && !tasks.length && !requests.length && !pulse) {
    return (
      <div className="dash-empty-state" style={{ padding: 64 }}>
        טוען דאשבורד תפעולי...
      </div>
    );
  }

  const cardBtn = {
    cursor: "pointer",
    textAlign: "right",
    border: "1px solid var(--border)",
  };

  return (
    <div className="dashboard-shell">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text-main)" }}>
            היום בריזורט
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
            {fmtTodayLabel(todayStr)} · לחצו על מספר כדי לפתוח את הרשימה
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => refresh()}
          disabled={loading}
          title="רענון"
        >
          {loading ? "..." : "↺ רענון"}
        </button>
      </div>

      <div className="stat-grid">
        <button
          type="button"
          className="stat-card stat-card--shifts"
          onClick={onArrivalsClick}
          style={cardBtn}
        >
          <div className="stat-card-header">
            <div className="stat-icon">📅</div>
          </div>
          <div className="stat-value">{pulse?.arrivalsToday ?? "—"}</div>
          <div className="stat-label">מגיעים היום · עדיין לא נכנסו</div>
          {missingEtaCount > 0 ? (
            <div className="stat-sub stat-sub--danger">
              {missingEtaCount} בלי שעת הגעה
            </div>
          ) : (
            <div className="stat-sub">פתחו את רשימת ההגעות</div>
          )}
        </button>

        <button
          type="button"
          className="stat-card stat-card--depts"
          onClick={onInResortClick}
          style={cardBtn}
        >
          <div className="stat-card-header">
            <div className="stat-icon">🟢</div>
          </div>
          <div className="stat-value">{pulse?.inResort ?? "—"}</div>
          <div className="stat-label">בריזורט עכשיו</div>
          <div className="stat-sub stat-sub--info">
            {pulse?.departingToday ?? 0} עוזבים היום
          </div>
        </button>

        <button
          type="button"
          className="stat-card stat-card--requests"
          onClick={() => onNavigate?.("requests_board")}
          style={cardBtn}
        >
          <div className="stat-card-header">
            <div className="stat-icon">📋</div>
          </div>
          <div className="stat-value">{kpi.openRequests}</div>
          <div className="stat-label">בקשות פתוחות</div>
          {kpi.complaints > 0 && (
            <div className="stat-sub stat-sub--danger">
              {kpi.complaints} תלונות
            </div>
          )}
        </button>

        <button
          type="button"
          className="stat-card stat-card--tasks"
          onClick={() => onNavigate?.("ops_board")}
          style={cardBtn}
        >
          <div className="stat-card-header">
            <div className="stat-icon">🛠️</div>
          </div>
          <div className="stat-value">{kpi.openTasks}</div>
          <div className="stat-label">משימות לטיפול</div>
          {kpi.pendingApproval > 0 && (
            <div className="stat-sub stat-sub--danger">
              {kpi.pendingApproval} ממתינות לאישור
            </div>
          )}
          {kpi.urgentTasks > 0 && (
            <div className="stat-sub stat-sub--danger">
              {kpi.urgentTasks} דחופות
            </div>
          )}
        </button>
      </div>

      {urgentItems.length > 0 && (
        <div className="dashboard-urgent">
          <span style={{ fontSize: 24, flexShrink: 0 }}>🚨</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="dashboard-urgent-title">דורש טיפול עכשיו</div>
            <div className="dashboard-urgent-body">
              {urgentItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={item.action}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "right",
                    border: "none",
                    background: "transparent",
                    padding: "4px 0",
                    cursor: "pointer",
                    color: "var(--text-main)",
                    fontFamily: "Heebo, sans-serif",
                    fontSize: 13,
                  }}
                >
                  • {item.text}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="dash-grid">
        <div className="card">
          <CardLinkHeader
            title="📋 בקשות אחרונות"
            onClick={() => onNavigate?.("requests_board")}
          />
          <div className="card-body">
            {recentRequests.length === 0 ? (
              <div className="dash-empty-state">אין בקשות פתוחות 🎉</div>
            ) : (
              recentRequests.map((r) => {
                const guestName = r.guests?.name || "אורח";
                const room = r.guests?.room ? ` · ${r.guests.room}` : "";
                return (
                  <div
                    key={r.id}
                    className="dash-list-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => onNavigate?.("requests_board")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onNavigate?.("requests_board");
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <div className="dash-row-main">
                      <div className="dash-row-title dash-row-title--clip">
                        {alertTypeLabel(r.alert_type)} — {guestName}
                        {room}
                      </div>
                      <div className="dash-row-sub dash-row-title--clip">
                        {(r.message ?? "").slice(0, 80) || "—"} ·{" "}
                        {fmtTime(r.created_at)}
                      </div>
                    </div>
                    {r.phone && onOpenDreamBotChat && (
                      <button
                        type="button"
                        title="פתח שיחה"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenDreamBotChat({ phone: r.phone, guestName });
                        }}
                        style={{
                          border: "1px solid var(--border)",
                          background: "var(--ivory)",
                          borderRadius: 8,
                          padding: "4px 8px",
                          cursor: "pointer",
                          flexShrink: 0,
                        }}
                      >
                        💬
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="card">
          <CardLinkHeader
            title="🛠️ משימות אחרונות"
            onClick={() => onNavigate?.("ops_board")}
          />
          <div className="card-body">
            {recentTasks.length === 0 ? (
              <div className="dash-empty-state">אין משימות להצגה</div>
            ) : (
              recentTasks.map((t) => {
                const badge = taskStatusBadge(t.status);
                return (
                  <div
                    key={t.id}
                    className="dash-list-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => onNavigate?.("ops_board")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onNavigate?.("ops_board");
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <span
                      className={`priority-dot dot-${priorityDot(t.priority)}`}
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        display: "block",
                        flexShrink: 0,
                      }}
                    />
                    <div className="dash-row-main">
                      <div className="dash-row-title dash-row-title--clip">
                        {t.description}
                      </div>
                      <div className="dash-row-sub">
                        {t.department} · {fmtTime(t.created_at)}
                      </div>
                    </div>
                    <span className={`badge ${badge.cls}`}>{badge.text}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
