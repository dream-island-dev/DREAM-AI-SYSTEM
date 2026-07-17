// Operational home — live tasks + guest_alerts + urgent signals from Supabase.
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { canPerform } from "../utils/auth";
import {
  computeResortPulse,
  buildGuestsByPhoneKey,
  countActiveInboxAlerts,
} from "../utils/resortPulseStats";
import {
  isSuiteArrivingToday,
  israelTodayStr,
} from "../utils/guestTiming";

const GUEST_SELECT =
  "phone, status, arrival_date, departure_date, room, room_type, arrival_time, name";

const ALERT_TYPE_META = {
  complaint: { label: "🔴 תקלה" },
  date_change_request: { label: "🗓️ שינוי תאריך" },
  request: { label: "📝 בקשה" },
  upsell_opportunity: { label: "🌴 בקשה מהפורטל" },
  portal_room_service: { label: "🍽️ שירות לחדר" },
  financial_issue: { label: "💳 בעיית חיוב" },
  spa_request: { label: "💆 בקשת ספא" },
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
  shifts,
  checklist,
  employees,
  onNavigate,
  onOpenDreamBotChat,
  onAttentionClick,
  onArrivalsClick,
  onAutomationClick,
}) {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [requests, setRequests] = useState([]);
  const [pulse, setPulse] = useState(null);
  const [missingEtaCount, setMissingEtaCount] = useState(0);
  const [blockedAutomation, setBlockedAutomation] = useState(0);

  const todayStr = israelTodayStr();
  const canCreate = canPerform("create_ops_task", user);
  const userDept = user?.department || "";

  const onShift = useMemo(
    () => shifts.filter((s) => s.status === "פעיל" && s.date === todayStr),
    [shifts, todayStr],
  );

  const doneChecks = checklist.filter((c) => c.done).length;
  const checkPct = checklist.length
    ? Math.round((doneChecks / checklist.length) * 100)
    : 0;

  const openTasks = useMemo(
    () => tasks.filter((t) => t.status === "open" || t.status === "in_progress"),
    [tasks],
  );
  const pendingApproval = useMemo(
    () => tasks.filter((t) => t.status === "pending_approval"),
    [tasks],
  );
  const urgentTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.priority === "urgent" &&
          (t.status === "open" || t.status === "in_progress"),
      ),
    [tasks],
  );
  const openRequests = useMemo(
    () => requests.filter((r) => !r.resolved),
    [requests],
  );
  const complaintRequests = useMemo(
    () => openRequests.filter((r) => r.alert_type === "complaint"),
    [openRequests],
  );

  const recentTasks = useMemo(() => {
    const actionable = tasks.filter((t) =>
      ["pending_approval", "open", "in_progress"].includes(t.status),
    );
    const pool = actionable.length ? actionable : tasks;
    return [...pool]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5);
  }, [tasks]);

  const recentRequests = useMemo(
    () =>
      [...openRequests]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 5),
    [openRequests],
  );

  const urgentItems = useMemo(() => {
    const items = [];
    if (pendingApproval.length) {
      items.push({
        key: "pending",
        text: `${pendingApproval.length} משימות ממתינות לאישור צוות`,
        action: () => onNavigate?.("ops_board"),
      });
    }
    if (complaintRequests.length) {
      items.push({
        key: "complaints",
        text: `${complaintRequests.length} תלונות אורח פתוחות`,
        action: () => onNavigate?.("requests_board"),
      });
    }
    if ((pulse?.needsAttention ?? 0) > 0) {
      items.push({
        key: "inbox",
        text: `${pulse.needsAttention} שיחות Inbox דורשות טיפול`,
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
    pendingApproval.length,
    complaintRequests.length,
    pulse?.needsAttention,
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

      const [tasksRes, alertsRes, guestsRes, waRes] = await Promise.all([
        taskQuery,
        supabase
          .from("guest_alerts")
          .select("*, guests(name, room, arrival_date, departure_date, status)")
          .order("created_at", { ascending: false })
          .limit(40),
        supabase.from("guests").select(GUEST_SELECT),
        supabase
          .from("whatsapp_conversations")
          .select("phone")
          .eq("human_requested", true)
          .eq("direction", "inbound"),
      ]);

      if (tasksRes.error) throw tasksRes.error;
      if (alertsRes.error) throw alertsRes.error;
      if (guestsRes.error) throw guestsRes.error;
      if (waRes.error) throw waRes.error;

      const guests = guestsRes.data ?? [];
      const guestsByPhone = buildGuestsByPhoneKey(guests);
      const inboxAlertsCount = countActiveInboxAlerts(
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
        (g) =>
          isSuiteArrivingToday(g) &&
          !(g.arrival_time ?? "").trim(),
      ).length;

      setTasks(tasksRes.data ?? []);
      setRequests(alertsRes.data ?? []);
      setPulse(
        computeResortPulse(guests, {
          inboxAlertsCount,
          blockedAutomation: blocked,
          openOpsTasks: (tasksRes.data ?? []).filter((t) =>
            ["open", "in_progress"].includes(t.status),
          ).length,
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

  useEffect(() => {
    refresh();
    if (!isSupabaseConfigured || !supabase) return undefined;

    const chTasks = supabase
      .channel("ops-dashboard-tasks")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        () => refresh(),
      )
      .subscribe();
    const chAlerts = supabase
      .channel("ops-dashboard-alerts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "guest_alerts" },
        () => refresh(),
      )
      .subscribe();
    const chGuests = supabase
      .channel("ops-dashboard-guests")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "guests" },
        () => refresh(),
      )
      .subscribe();
    const chWa = supabase
      .channel("ops-dashboard-wa")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_conversations" },
        () => refresh(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(chTasks);
      supabase.removeChannel(chAlerts);
      supabase.removeChannel(chGuests);
      supabase.removeChannel(chWa);
    };
  }, [refresh]);

  if (loading && !tasks.length && !requests.length) {
    return (
      <div className="dash-empty-state" style={{ padding: 64 }}>
        טוען דאשבורד תפעולי...
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <div className="stat-grid">
        <button
          type="button"
          className="stat-card stat-card--shifts"
          onClick={onArrivalsClick}
          style={{ cursor: onArrivalsClick ? "pointer" : "default", textAlign: "right", border: "1px solid var(--border)" }}
        >
          <div className="stat-card-header">
            <div className="stat-icon">📅</div>
          </div>
          <div className="stat-value">{pulse?.arrivalsToday ?? "—"}</div>
          <div className="stat-label">מגיעים היום</div>
          {missingEtaCount > 0 && (
            <div className="stat-sub stat-sub--danger">
              {missingEtaCount} ללא שעת הגעה
            </div>
          )}
        </button>

        <button
          type="button"
          className="stat-card stat-card--depts"
          onClick={onAttentionClick}
          style={{ cursor: onAttentionClick ? "pointer" : "default", textAlign: "right", border: "1px solid var(--border)" }}
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
          style={{ cursor: "pointer", textAlign: "right", border: "1px solid var(--border)" }}
        >
          <div className="stat-card-header">
            <div className="stat-icon">📋</div>
          </div>
          <div className="stat-value">{openRequests.length}</div>
          <div className="stat-label">בקשות פתוחות</div>
          {complaintRequests.length > 0 && (
            <div className="stat-sub stat-sub--danger">
              {complaintRequests.length} תלונות
            </div>
          )}
        </button>

        <button
          type="button"
          className="stat-card stat-card--tasks"
          onClick={() => onNavigate?.("ops_board")}
          style={{ cursor: "pointer", textAlign: "right", border: "1px solid var(--border)" }}
        >
          <div className="stat-card-header">
            <div className="stat-icon">🛠️</div>
          </div>
          <div className="stat-value">{openTasks.length}</div>
          <div className="stat-label">משימות פתוחות</div>
          {pendingApproval.length > 0 && (
            <div className="stat-sub stat-sub--danger">
              {pendingApproval.length} ממתינות לאישור
            </div>
          )}
          {urgentTasks.length > 0 && (
            <div className="stat-sub stat-sub--danger">
              {urgentTasks.length} דחופות
            </div>
          )}
        </button>
      </div>

      {urgentItems.length > 0 && (
        <div className="dashboard-urgent">
          <span style={{ fontSize: 24, flexShrink: 0 }}>🚨</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="dashboard-urgent-title">דורש טיפול מיידי</div>
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

      <div className="dash-grid" style={{ marginTop: "var(--space-lg)" }}>
        <div className="card">
          <CardLinkHeader title="🕐 עובדים במשמרת עכשיו" onClick={() => onNavigate?.("shifts")} />
          <div className="card-body">
            {onShift.length === 0 ? (
              <div className="dash-empty-state">אין משמרות פעילות כרגע</div>
            ) : (
              onShift.map((s) => (
                <div key={s.id} className="dash-list-row">
                  <div
                    className="avatar"
                    style={{ width: 32, height: 32, fontSize: 11 }}
                  >
                    {s.employeeName
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </div>
                  <div className="dash-row-main">
                    <div className="dash-row-title">{s.employeeName}</div>
                    <div className="dash-row-sub">
                      {s.department} · {s.start}–{s.end}
                    </div>
                  </div>
                  <span className="badge badge-green">פעיל</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <CardLinkHeader
            title="✅ צ'קליסט יומי"
            onClick={() => onNavigate?.("checklist")}
            linkLabel={`${checkPct}% · הצג הכל ←`}
          />
          <div className="card-body">
            {checklist.length === 0 ? (
              <div className="dash-empty-state">אין פריטי צ'קליסט להיום</div>
            ) : (
              <>
                <div style={{ padding: "12px 20px" }}>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${checkPct}%` }}
                    />
                  </div>
                  <div className="dash-row-sub" style={{ marginTop: 8 }}>
                    {doneChecks} מתוך {checklist.length} הושלמו ·{" "}
                    {employees.length} עובדים במערכת
                  </div>
                </div>
                {checklist.slice(0, 4).map((c) => (
                  <div key={c.id} className="dash-list-row">
                    <div className="dash-row-main">
                      <div className="dash-row-title dash-row-title--clip">
                        {c.task}
                      </div>
                      <div className="dash-row-sub">{c.department}</div>
                    </div>
                    <span className={`badge ${c.done ? "badge-green" : "badge-gray"}`}>
                      {c.done ? "✓" : "ממתין"}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
