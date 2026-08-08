// src/components/GuestsPage.js
// Guest / daily check-in management. Scoped fetch + cross-mount memory cache.
// Manager can flip a guest to "Room Ready" → fires WhatsApp Trigger 3
// (suites) immediately via the whatsapp-send edge function.
import { useState, useEffect, useCallback, useRef } from "react";
import { useIntervalWhenVisible } from "../hooks/usePageVisibility";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { Toast, useToast } from "./Toast";
import { SUITE_REGISTRY } from "../data/suiteRegistry";
import { hasSuiteRoomTypeConflict, hasPremiumDayRoomTypeConflict, describeArrivalConfirmedSource, israelTodayStr } from "../utils/guestTiming";
import { loadCheckinFilter } from "../utils/checkinFilterStorage";
import {
  fetchCheckinGuestsForScope,
  fetchCheckinRoomByPhone,
  fetchCheckinScopeCounts,
  getCheckinScopeCacheKey,
  guestsPageMemoryCache,
  readCachedCheckinScope,
  writeCachedCheckinScope,
} from "../utils/checkinGuestsFetch";
import AddGuestModal from "./AddGuestModal";
import GuestAttentionBadge from "./GuestAttentionBadge";
import GuestContextDrawer from "./GuestContextDrawer";
import MissingDepartureBadge from "./MissingDepartureBadge";
import QuietHoursGate from "./QuietHoursGate";
import { STATUS_META } from "../utils/guestStatusMeta";
import CheckinTimelineFilterBar from "./CheckinTimelineFilterBar";
import { useCheckinTimelineFilter } from "../hooks/useCheckinTimelineFilter";
import {
  CHECKIN_TIMELINE_ARCHIVE,
  CHECKIN_TIMELINE_TODAY,
  CHECKIN_TIMELINE_TOMORROW,
  CHECKIN_TIMELINE_WEEK7,
  applyCheckinRosterFilter,
  formatCheckinArrivalDisplay,
  getCheckinRowHighlight,
  isPreArrivalTodayGuest,
  resolveEffectiveGuestStatus,
  sortCheckinRosterGuests,
} from "../utils/guestCheckinMatrix";
import { useQuietHoursSend } from "../hooks/useQuietHoursSend";
import { formatSpaSchedule } from "../utils/israeliTime";
import {
  performSuiteCheckIn,
  performSuiteCheckInRevert,
  markGuestRoomReadyAfterNotify,
} from "../utils/suiteCheckinSync";
import {
  fetchSuiteRoomsForGuestIds,
  isSuiteRoomReadySent,
  resolveSuiteRoomDisplayLabel,
  sendGuestRoomReadyMessage,
  classifyRoomReadySendResult,
} from "../utils/suiteRoomReady";
import { formatSuiteRoomLine } from "../utils/guestStaySummary";
import {
  buildHousekeepingSyncMap,
  fetchHousekeepingActivityForDate,
  fetchHousekeepingCheckInsForDate,
  indexHousekeepingActivityRoomIds,
  indexHousekeepingCheckInsByRoom,
  markHousekeepingEventSynced,
  reconcileHousekeepingCheckIns,
} from "../utils/housekeepingCheckInReconcile";

function isTodayCheckinScope(scope, customDate) {
  if (customDate) return customDate === israelTodayStr();
  return scope === CHECKIN_TIMELINE_TODAY;
}

export default function GuestsPage({
  initialTimelineScope = null,
  initialCustomArrivalDate = null,
  onTimelineScopeConsumed,
  onOpenDreamBotChat,
  onOpenCheckin,
}) {
  const bootFilter = loadCheckinFilter();
  const bootScope = initialTimelineScope || bootFilter.scope || CHECKIN_TIMELINE_TODAY;
  const bootDate = initialCustomArrivalDate ?? bootFilter.customDate ?? null;
  const bootCache = readCachedCheckinScope(bootScope, bootDate);

  const {
    quietActive,
    overrideChecked,
    setOverrideChecked,
    ensureCanSend,
    canSend,
  } = useQuietHoursSend();

  const [guests, setGuests]   = useState(() => bootCache?.guests ?? []);
  const [loading, setLoading] = useState(() => bootCache === null);
  const [refreshing, setRefreshing] = useState(false);
  const [scopeCounts, setScopeCounts] = useState(() => bootCache?.scopeCounts ?? {});
  const [busy, setBusy]       = useState(null);
  const skipRealtimeUntilRef = useRef(0);
  const realtimeDebounceRef = useRef(null);
  const [toast, showToast] = useToast(3500);
  const [profileGuest, setProfileGuest] = useState(null); // guest object or null — GuestContextDrawer
  const [profileEditOnOpen, setProfileEditOnOpen] = useState(false);
  const [etaBoardOpen, setEtaBoardOpen] = useState(() => {
    try { return sessionStorage.getItem("checkin_eta_board_open") === "1"; } catch { return false; }
  });
  const [badgeHover, setBadgeHover] = useState(null);
  const [paymentModal, setPaymentModal] = useState(null); // { id, name, phone, amount, link }
  const [paymentBusy, setPaymentBusy]   = useState(null); // guestId being sent
  const [selectedIds, setSelectedIds]   = useState(new Set()); // batch selection
  const [deleteBusy, setDeleteBusy]     = useState(false);
  const [editGuest,     setEditGuest]    = useState(null);  // {} = new guest, {id,...} = existing
  const [roomByPhone,    setRoomByPhone]    = useState(() => bootCache?.roomByPhone ?? guestsPageMemoryCache.roomByPhone ?? {});
  const [suiteRoomsByGuestId, setSuiteRoomsByGuestId] = useState(() => bootCache?.suiteRoomsByGuestId ?? {});
  const [hkSyncByGuestId, setHkSyncByGuestId] = useState({});

  const {
    timelineScope,
    customArrivalDate,
    setTimelineScope,
    setCustomArrivalDate,
    filterLabel,
    isCustomDateActive,
  } = useCheckinTimelineFilter({
    initialScope: initialTimelineScope,
    initialCustomDate: initialCustomArrivalDate,
    onInitialConsumed: onTimelineScopeConsumed,
  });

  const persistScopeCache = useCallback((rows, suiteMap) => {
    writeCachedCheckinScope(timelineScope, customArrivalDate, {
      guests: rows,
      suiteRoomsByGuestId: suiteMap,
    });
  }, [timelineScope, customArrivalDate]);

  const suppressRealtimeRefresh = useCallback((ms = 2500) => {
    skipRealtimeUntilRef.current = Date.now() + ms;
  }, []);

  const applyHousekeepingGroupSync = useCallback(async (rows, suiteMap, { silent = false } = {}) => {
    if (!supabase || !isTodayCheckinScope(timelineScope, customArrivalDate) || !rows?.length) {
      setHkSyncByGuestId({});
      return rows;
    }

    const [
      { rows: hkEvents, error: hkFetchError },
      { rows: activityEvents, error: activityFetchError },
    ] = await Promise.all([
      fetchHousekeepingCheckInsForDate(supabase, israelTodayStr()),
      fetchHousekeepingActivityForDate(supabase, israelTodayStr()),
    ]);
    if (hkFetchError || activityFetchError) {
      // FAIL VISIBLE (P0 2026-08-05): a fetch failure must never look like "no
      // signals today" — the ✅/⚠️ chips below would otherwise silently go stale.
      showToast("err", "⚠ סנכרון קבוצת ניקיון נכשל — צ'יפים עשויים להיות לא מעודכנים");
    }
    const hkByRoom = indexHousekeepingCheckInsByRoom(hkEvents);
    const activityRoomIds = indexHousekeepingActivityRoomIds(activityEvents);
    setHkSyncByGuestId(buildHousekeepingSyncMap(rows, suiteMap, hkByRoom, activityRoomIds));

    const reconciled = await reconcileHousekeepingCheckIns(supabase, rows, suiteMap, hkByRoom);
    if (!reconciled.length) return rows;

    const patchById = new Map(reconciled.map((r) => [r.guestId, r.guestPatch]));
    const nextRows = rows.map((g) => (patchById.has(g.id) ? { ...g, ...patchById.get(g.id) } : g));
    setHkSyncByGuestId(buildHousekeepingSyncMap(nextRows, suiteMap, hkByRoom, activityRoomIds));
    suppressRealtimeRefresh();
    if (!silent) {
      showToast("ok", `סונכרנו ${reconciled.length} צ'ק-אינים מקבוצת הניקיון`);
    }
    return nextRows;
  }, [timelineScope, customArrivalDate, suppressRealtimeRefresh, showToast]);

  const loadGuests = useCallback(async ({ showSpinner = false, forceScopeCounts = false } = {}) => {
    const cacheKey = getCheckinScopeCacheKey(timelineScope, customArrivalDate);
    const hasCachedScope = Object.prototype.hasOwnProperty.call(
      guestsPageMemoryCache.guestsByScope,
      cacheKey,
    );

    if (showSpinner && !hasCachedScope) setLoading(true);
    if (!isSupabaseConfigured || !supabase) {
      if (showSpinner && !hasCachedScope) setLoading(false);
      return;
    }

    const [guestsRes, countsRes] = await Promise.all([
      fetchCheckinGuestsForScope(supabase, { scope: timelineScope, customArrivalDate }),
      fetchCheckinScopeCounts(supabase, { force: forceScopeCounts }),
    ]);

    if (countsRes.counts) setScopeCounts(countsRes.counts);
    if (guestsRes.error) {
      showToast("err", "שגיאה: " + guestsRes.error.message);
    } else {
      const rows = guestsRes.data ?? [];
      const { map: suiteMap, error: suiteRoomsError } = await fetchSuiteRoomsForGuestIds(supabase, rows);
      if (suiteRoomsError) {
        // FAIL VISIBLE (P0 2026-08-05): don't let a failed suite_rooms fetch
        // silently render as "this suite has no extra rooms".
        showToast("err", "⚠ טעינת נתוני חדרים נכשלה — ייתכן שחלק מהחדרים חסרים בתצוגה");
      }
      const syncedRows = await applyHousekeepingGroupSync(rows, suiteMap, { silent: !showSpinner });
      setGuests(syncedRows);
      setSuiteRoomsByGuestId(suiteMap);
      persistScopeCache(syncedRows, suiteMap);
    }
    if (showSpinner && !hasCachedScope) setLoading(false);
  }, [timelineScope, customArrivalDate, persistScopeCache, showToast, applyHousekeepingGroupSync]);

  const fetchGuestsSilent = useCallback(() => loadGuests(), [loadGuests]);

  const fetchGuestsManual = useCallback(async () => {
    setRefreshing(true);
    await loadGuests({ forceScopeCounts: true });
    if (supabase) {
      const map = await fetchCheckinRoomByPhone(supabase);
      setRoomByPhone(map);
    }
    setRefreshing(false);
  }, [loadGuests]);

  useEffect(() => {
    const cached = readCachedCheckinScope(timelineScope, customArrivalDate);
    if (cached) {
      setGuests(cached.guests);
      setSuiteRoomsByGuestId(cached.suiteRoomsByGuestId);
      setLoading(false);
    }
    loadGuests({ showSpinner: !cached });
  }, [timelineScope, customArrivalDate, loadGuests]);

  useEffect(() => {
    if (!supabase) return;
    if (guestsPageMemoryCache.roomByPhone) {
      setRoomByPhone(guestsPageMemoryCache.roomByPhone);
      return;
    }
    fetchCheckinRoomByPhone(supabase).then(setRoomByPhone);
  }, []);

  useEffect(() => {
    if (!supabase) return undefined;
    const pageVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

    const scheduleRealtimeRefresh = () => {
      if (!pageVisible()) return;
      if (Date.now() < skipRealtimeUntilRef.current) return;
      clearTimeout(realtimeDebounceRef.current);
      realtimeDebounceRef.current = setTimeout(() => {
        if (!pageVisible()) return;
        if (Date.now() < skipRealtimeUntilRef.current) return;
        fetchGuestsSilent();
      }, 400);
    };

    let ch = null;
    const attachRealtime = () => {
      if (!pageVisible() || ch) return;
      ch = supabase
        .channel("guests-page-rt")
        .on("postgres_changes", { event: "*", schema: "public", table: "guests" }, scheduleRealtimeRefresh)
        .subscribe();
    };
    const detachRealtime = () => {
      if (!ch) return;
      supabase.removeChannel(ch);
      ch = null;
    };

    const onVisibility = () => {
      if (pageVisible()) {
        attachRealtime();
        fetchGuestsSilent();
      } else {
        clearTimeout(realtimeDebounceRef.current);
        detachRealtime();
      }
    };

    attachRealtime();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(realtimeDebounceRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
      detachRealtime();
    };
  }, [fetchGuestsSilent]);

  // P2 2026-08-05: was a hand-rolled duplicate of useIntervalWhenVisible's
  // exact logic (pageVisible() + immediate call + setInterval) sitting right
  // next to the realtime effect's own separate hand-rolled visibility
  // tracking — two visibility systems in one file. This is now the one
  // ready-made hook instead of a third copy.
  useIntervalWhenVisible(fetchGuestsSilent, 60_000, [fetchGuestsSilent]);

  const getGuestSuiteRooms = (guest) => suiteRoomsByGuestId[guest?.id] ?? [];

  const patchSuiteRoomReadyLocal = (guestId, roomLabel) => {
    setSuiteRoomsByGuestId((prev) => {
      const rows = prev[guestId];
      if (!rows?.length) return prev;
      const nextRows = rows.map((row) => {
        const label = resolveSuiteRoomDisplayLabel(row);
        if (label !== roomLabel) return row;
        return { ...row, room_ready_notified: true, msg_room_ready_sent: true };
      });
      return { ...prev, [guestId]: nextRows };
    });
  };

  const sendRoomReadyForSuiteRoom = async (guest, roomRow) => {
    if (!supabase || !guest?.id) return;
    const roomLabel = resolveSuiteRoomDisplayLabel(roomRow);
    if (!roomLabel) {
      showToast("err", "לא ניתן לזהות את שם החדר — ערוך את פרופיל האורח");
      return;
    }
    if (!ensureCanSend()) {
      showToast("err", "שליחה חסומה בשעות שקט — סמן אישור למעלה");
      return;
    }
    setBusy(`${guest.id}:${roomLabel}`);
    try {
      const result = await sendGuestRoomReadyMessage(supabase, { guestId: guest.id, roomLabel });
      const verdict = classifyRoomReadySendResult(result);
      if (!verdict.ok) {
        showToast("err", `שליחת WA ל${roomLabel} נכשלה: ${verdict.reason}`);
        return;
      }
      if (verdict.kind === "timeout") {
        patchSuiteRoomReadyLocal(guest.id, roomLabel);
        showToast("ok", `ℹ ${roomLabel} — לא ודאי אם ההודעה הגיעה, בדקו בוואטסאפ לפני שליחה חוזרת`);
      } else if (verdict.kind === "duplicate" || verdict.kind === "skipped") {
        patchSuiteRoomReadyLocal(guest.id, roomLabel);
        showToast("ok", `ℹ ${roomLabel} — ההודעה כבר נשלחה קודם`);
      } else {
        patchSuiteRoomReadyLocal(guest.id, roomLabel);
        await markGuestRoomReadyAfterNotify(supabase, guest.id);
        suppressRealtimeRefresh();
        setGuests((prev) => prev.map((g) => (
          g.id === guest.id && g.status !== "checked_in"
            ? { ...g, status: "room_ready" }
            : g
        )));
        showToast(
          "ok",
          `✅ חדר מוכן (${roomLabel}) + הודעת WA נשלחה ל${guest.name}${verdict.simulation ? " (סימולציה)" : ""}`,
        );
      }
    } catch (e) {
      showToast("err", `שליחת WA ל${roomLabel} נכשלה: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (guest, status, roomLabel = null) => {
    if (!supabase) return;
    setBusy(guest.id);

    if (status === "checked_in") {
      const result = await performSuiteCheckIn(supabase, guest);
      if (!result.ok) {
        showToast("err", "שגיאה: " + result.error);
        setBusy(null);
        return;
      }
      suppressRealtimeRefresh();
      setGuests((prev) => prev.map((g) => (g.id === guest.id ? { ...g, ...result.guestPatch } : g)));
      showToast("ok", result.noRoomLinked
        ? "צ'ק-אין ✓ (לא שובץ חדר בלוח סוויטות)"
        : "צ'ק-אין ✓ — מסונכרן ללוח סוויטות");
      setBusy(null);
      return;
    }

    if (status === "expected" && guest.status === "checked_in") {
      const result = await performSuiteCheckInRevert(supabase, guest);
      if (!result.ok) {
        showToast("err", "שגיאה: " + result.error);
        setBusy(null);
        return;
      }
      suppressRealtimeRefresh();
      setGuests((prev) => prev.map((g) => (g.id === guest.id ? { ...g, ...result.guestPatch } : g)));
      showToast("ok", result.revertStatus === "room_ready" ? "הוחזר לחדר מוכן ↩" : "הוחזר לממתין ↩");
      setBusy(null);
      return;
    }

    const patch = { status };
    if (status === "expected") patch.checkin_time = null;
    const { error } = await supabase.from("guests").update(patch).eq("id", guest.id);
    if (error) { showToast("err", "שגיאה: " + error.message); setBusy(null); return; }
    suppressRealtimeRefresh();
    setGuests((prev) => prev.map((g) => (g.id === guest.id ? { ...g, ...patch } : g)));

    // Room Ready → fire WhatsApp room_ready trigger (suites only).
    // Multi-room: caller passes roomLabel; single-room uses guests.room.
    if (status === "room_ready" && isSuite(guest)) {
      const suiteRooms = getGuestSuiteRooms(guest);
      if (suiteRooms.length > 1) {
        const targetRow = roomLabel
          ? suiteRooms.find((row) => resolveSuiteRoomDisplayLabel(row) === roomLabel)
          : suiteRooms.find((row) => !isSuiteRoomReadySent(row));
        if (!targetRow) {
          showToast("err", "כל החדרים כבר קיבלו הודעת חדר מוכן");
          setBusy(null);
          return;
        }
        await sendRoomReadyForSuiteRoom(guest, targetRow);
        setBusy(null);
        return;
      }

      if (!ensureCanSend()) {
        showToast("err", "חדר סומן כמוכן — אך שליחת WA חסומה בשעות שקט (סמן אישור למעלה)");
        setBusy(null);
        return;
      }
      const singleRoomLabel = roomLabel || guest.room || resolveSuiteRoomDisplayLabel(suiteRooms[0]) || undefined;
      try {
        const result = await sendGuestRoomReadyMessage(supabase, {
          guestId: guest.id,
          roomLabel: singleRoomLabel,
        });
        const verdict = classifyRoomReadySendResult(result);
        if (!verdict.ok) {
          showToast("err", `חדר סומן כמוכן — אך הודעת WA נכשלה: ${verdict.reason}`);
          setBusy(null);
          return;
        }
        // A skipped/duplicate-blocked/timeout send is still "ok" (no error) but
        // must never read as a fresh "sent" toast — the guest may not have
        // actually received a new message this time (FAIL VISIBLE).
        if (verdict.kind === "timeout") {
          showToast("ok", "ℹ️ חדר סומן כמוכן — לא ודאי אם הודעת ה-WA הגיעה, בדקו לפני שליחה חוזרת");
        } else if (verdict.kind === "duplicate" || verdict.kind === "skipped") {
          showToast("ok", `ℹ חדר סומן כמוכן — הודעת WA כבר נשלחה בעבר ל${guest.name}`);
        } else {
          showToast("ok", `✅ חדר מוכן + הודעת WA נשלחה ל${guest.name}${verdict.simulation ? " (סימולציה)" : ""}`);
        }
      } catch (e) {
        showToast("err", `חדר סומן כמוכן — אך הודעת WA נכשלה: ${e?.message ?? String(e)}`);
        setBusy(null);
        return;
      }
    } else {
      const labels = { checked_in: "צ'ק-אין ✓", room_ready: "חדר מוכן ✓", expected: "הוחזר לממתין ↩" };
      showToast("ok", labels[status] ?? "עודכן ✓");
    }
    setBusy(null);
  };

  const syncFromHousekeepingGroup = async (guest) => {
    if (!supabase || !guest?.id) return;
    const sync = hkSyncByGuestId[guest.id];
    if (!sync?.roomId || sync.state !== "pending") return;
    if (roomMissing(guest)) {
      showToast("err", "יש לשבץ חדר לפני סנכרון מקבוצה — לחץ ✏️ לעריכה");
      return;
    }
    setBusy(guest.id);
    const result = await performSuiteCheckIn(supabase, guest, {
      roomId: sync.roomId,
      auditSource: "צ'ק-אין מקבוצת ניקיון (סנכרון ידני)",
    });
    if (!result.ok) {
      showToast("err", "סנכרון מקבוצה נכשל: " + result.error);
      setBusy(null);
      return;
    }
    if (sync.eventId) {
      await markHousekeepingEventSynced(supabase, sync.eventId, guest.id);
    }
    suppressRealtimeRefresh();
    setGuests((prev) => prev.map((g) => (g.id === guest.id ? { ...g, ...result.guestPatch } : g)));
    setHkSyncByGuestId((prev) => ({
      ...prev,
      [guest.id]: { ...sync, state: "synced", action: "updated" },
    }));
    showToast("ok", "צ'ק-אין ✓ — סונכרן מקבוצת הניקיון");
    setBusy(null);
  };

  const renderHousekeepingSyncChip = (guest, rowStatus) => {
    const sync = hkSyncByGuestId[guest?.id];
    if (!sync || sync.state === "none") return null;

    if (sync.state === "synced" || rowStatus === "checked_in") {
      const at = sync.eventAt
        ? new Date(sync.eventAt).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" })
        : null;
      return (
        <span
          title={at ? `נקלט מקבוצת צ'ק-אין בשעה ${at}` : "נקלט מקבוצת צ'ק-אין"}
          style={{
            fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
            background: "#E8F5EF", color: "#1A7A4A", whiteSpace: "nowrap",
          }}
        >
          ✅ מקבוצה{at ? ` ${at}` : ""}
        </span>
      );
    }

    if (sync.state === "pending") {
      return (
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy === guest.id || roomMissing(guest)}
          onClick={() => syncFromHousekeepingGroup(guest)}
          title={
            roomMissing(guest)
              ? "יש לשבץ חדר לפני סנכרון"
              : "נשלח צ'ק-אין בקבוצה — לחץ לסנכרן ל-XOS"
          }
          style={{
            fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
            background: roomMissing(guest) ? "#F5F5F5" : "#FFF5E8",
            color: roomMissing(guest) ? "#AAAAAA" : "#B5600A",
            cursor: roomMissing(guest) ? "not-allowed" : "pointer",
            border: "1px solid #F5A623",
          }}
        >
          {busy === guest.id ? "⏳" : "⚠️ סנכרן מקבוצה"}
        </button>
      );
    }

    if (sync.state === "awaiting_group_signal") {
      // B1 (2026-08-08) FAIL VISIBLE: the room had ready/checkout activity in
      // the housekeeping group today but no check_in text was ever sent for
      // it — the forensic 2026-08-07 pattern (9/10 stuck rooms). Deliberately
      // NOT a button — there's no specific event to apply, so this only tells
      // staff to go verify manually. Never auto-applies, never touches
      // guests.status.
      return (
        <span
          title="קבוצת הניקיון סימנה פעילות בחדר הזה היום (מוכן/יציאה), אך לא נשלח צ'ק-אין מפורש — ודאו מול הצוות בשטח"
          style={{
            fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
            background: "#FEF2F2", color: "#B91C1C", whiteSpace: "nowrap",
            border: "1px solid #FCA5A5",
          }}
        >
          ⚠ ממתין לצ׳ק-אין מקבוצה
        </span>
      );
    }

    return (
      <span
        title={sync.error || sync.action || "צ'ק-אין מקבוצה לא הוחל"}
        style={{
          fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
          background: "#FFF0EE", color: "#C0392B", whiteSpace: "nowrap",
        }}
      >
        ⚠️ קבוצה — לא הוחל
      </span>
    );
  };

  const isSuite = (g) =>
    g.room_type === "suite" ||
    SUITE_REGISTRY.includes(g.room) ||
    (!!roomByPhone[g.phone] && !roomByPhone[g.phone].isDayGuest);

  // ── Room-prerequisite gating for check-in actions ───────────────────────────
  // Day packages (Premium Day 1/2, or any suite_rooms row flagged is_day_guest)
  // never get an actual room — they're exempt from the room requirement.
  const DAY_GUEST_ROOM_VALUES = new Set(["Premium Day 1", "Premium Day 2", "בילוי יומי"]);
  const isDayGuest = (g) =>
    DAY_GUEST_ROOM_VALUES.has(g.room) || !!roomByPhone[g.phone]?.isDayGuest;
  const hasRoomAssigned = (g) => {
    if (g.room || roomByPhone[g.phone]?.roomName) return true;
    return getGuestSuiteRooms(g).length > 0;
  };
  const roomMissing = (g) => !isDayGuest(g) && !hasRoomAssigned(g);

  // ── Batch selection helpers ──────────────────────────────────────────────────
  const toggleSelect = (id) =>
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleSelectAll = () =>
    setSelectedIds((prev) => prev.size === displayGuests.length ? new Set() : new Set(displayGuests.map((g) => g.id)));

  const roomNameFor = useCallback(
    (g) => {
      const rows = suiteRoomsByGuestId[g?.id];
      if (rows?.length > 1) {
        return rows.map(resolveSuiteRoomDisplayLabel).filter(Boolean).join(" · ");
      }
      if (rows?.length === 1) {
        return resolveSuiteRoomDisplayLabel(rows[0]) || g.room || "";
      }
      return g.room || roomByPhone[g.phone]?.roomName || "";
    },
    [roomByPhone, suiteRoomsByGuestId],
  );

  // ── Reception matrix filters — PMS timeline scopes ─────────────────────
  const suiteGuests = guests.filter((g) => isSuite(g));
  const displayGuests = sortCheckinRosterGuests(
    applyCheckinRosterFilter(suiteGuests, { scope: timelineScope, customArrivalDate }),
    new Date(),
    roomNameFor,
    { prioritizeEta: timelineScope === CHECKIN_TIMELINE_TODAY },
  );

  // ── Arrival ETA board — today's pre-arrival roster, ETA-sorted, FAIL VISIBLE ──
  const etaBoardGuests = timelineScope === CHECKIN_TIMELINE_TODAY
    ? sortCheckinRosterGuests(
        suiteGuests.filter((g) => isPreArrivalTodayGuest(g)),
        new Date(),
        roomNameFor,
        { prioritizeEta: true },
      )
    : [];
  const etaMissingCount = etaBoardGuests.filter((g) => {
    const eta = (g.arrival_time || "").trim();
    return !eta || !/^\d{2}:\d{2}$/.test(eta);
  }).length;

  // ── Bulk delete selected guests (same pattern as GuestDashboard.js) ────────
  const handleDeleteSelected = async () => {
    if (!selectedIds.size || !supabase) return;
    const ids = [...selectedIds];
    if (!window.confirm(`מחק ${ids.length} אורחים שנבחרו?\nפעולה זו לא ניתנת לביטול.`)) return;
    setDeleteBusy(true);
    try {
      let failed = 0;
      for (const id of ids) {
        const { data, error } = await supabase.rpc("delete_guest_profile", { p_guest_id: id });
        if (error || !data?.ok) failed++;
      }
      if (failed) throw new Error(`נכשלה מחיקה של ${failed} אורחים`);
      setGuests((prev) => prev.filter((g) => !ids.includes(g.id)));
      setSelectedIds(new Set());
      showToast("ok", `🗑️ נמחקו ${ids.length} אורחים בהצלחה`);
    } catch (e) {
      showToast("err", "שגיאה במחיקה: " + (e?.message ?? e));
    } finally {
      setDeleteBusy(false);
    }
  };

  // ── Payment template sender ──────────────────────────────────────────────────
  const doSendPayment = async (guestId) => {
    setPaymentBusy(guestId);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: { trigger: "payment_and_workshops", guestId: String(guestId) },
      });
      if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? "שגיאה בשליחה");
      showToast("ok", "💳 תבנית תשלום נשלחה בהצלחה ✓");
      setPaymentModal(null);
    } catch (e) {
      showToast("err", "שגיאה: " + (e?.message ?? e));
    } finally {
      setPaymentBusy(null);
    }
  };

  const handleSendPaymentTemplate = (g) => {
    if (!supabase) return;
    if (!g.payment_amount || !(g.direct_payment_url || g.payment_link_url)) {
      // Open modal to fill in missing payment data
      setPaymentModal({
        id:     g.id,
        name:   g.name,
        phone:  g.phone,
        amount: g.payment_amount ? String(g.payment_amount) : "",
        link:   g.direct_payment_url || g.payment_link_url || "",
      });
    } else {
      doSendPayment(g.id);
    }
  };

  const openProfile = (g, withEdit = false) => {
    setProfileGuest(g);
    setProfileEditOnOpen(withEdit);
  };
  const openEdit = (g) => openProfile(g, true);
  const openAdd  = () => setEditGuest({}); // empty = new guest (no id)

  const toggleEtaBoard = () => {
    setEtaBoardOpen((prev) => {
      const next = !prev;
      try { sessionStorage.setItem("checkin_eta_board_open", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  const handleGuestSaved = (saved) => {
    // P2 2026-08-05: without this, a realtime echo of the save could race the
    // optimistic local patch below and overwrite it with a stale read
    // (GuestDashboard.js added the same guard for the same reason).
    suppressRealtimeRefresh();
    setGuests((prev) => {
      const exists = prev.some((g) => g.id === saved.id);
      return exists
        ? prev.map((g) => (g.id === saved.id ? { ...g, ...saved } : g))
        : [saved, ...prev];
    });
  };

  const handleSavePaymentAndSend = async () => {
    if (!paymentModal || !supabase) return;
    if (!paymentModal.amount) { showToast("err", "נא להזין סכום תשלום"); return; }
    if (!paymentModal.link)   { showToast("err", "נא להזין קישור תשלום"); return; }

    setPaymentBusy(paymentModal.id);
    try {
      const { error } = await supabase.from("guests").update({
        payment_amount:   parseFloat(paymentModal.amount),
        payment_link_url: paymentModal.link.trim(),
      }).eq("id", paymentModal.id);
      if (error) throw error;

      setGuests((prev) => prev.map((g) => g.id === paymentModal.id
        ? { ...g, payment_amount: parseFloat(paymentModal.amount), payment_link_url: paymentModal.link.trim() }
        : g
      ));
      await doSendPayment(paymentModal.id);
    } catch (e) {
      showToast("err", "שגיאה: " + (e?.message ?? e));
      setPaymentBusy(null);
    }
  };

  const renderRoomReadyActions = (g, rowStatus) => {
    const suiteRooms = getGuestSuiteRooms(g);
    const multiRoom = suiteRooms.length > 1;

    if (multiRoom) {
      const pendingRooms = suiteRooms.filter((row) => !isSuiteRoomReadySent(row));
      const allSent = pendingRooms.length === 0;

      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 148 }}>
          {suiteRooms.map((row) => {
            const roomLabel = resolveSuiteRoomDisplayLabel(row);
            const sent = isSuiteRoomReadySent(row);
            const waKey = `${g.id}:${roomLabel}`;
            const isDisabled = sent || busy === waKey || !canSend || rowStatus === "checked_in";
            let tip = "";
            if (sent) tip = "כבר נשלחה הודעת חדר מוכן לחדר זה";
            else if (!canSend) tip = "שליחה חסומה בשעות שקט — סמן אישור למעלה";
            else if (rowStatus === "checked_in") tip = "האורח כבר בצ'ק-אין";

            return (
              <button
                key={row.res_line_id ?? row.id ?? roomLabel}
                className="btn btn-sm"
                disabled={isDisabled}
                title={tip || `שלח חדר מוכן — ${formatSuiteRoomLine(row)}`}
                onClick={() => sendRoomReadyForSuiteRoom(g, row)}
                style={{
                  background: sent ? "#E8F5EF" : isDisabled ? "#F5F5F5" : "#E8F5EF",
                  color: sent ? "#16A34A" : isDisabled ? "#AAAAAA" : "#1A7A4A",
                  cursor: isDisabled ? "not-allowed" : "pointer",
                  fontSize: 11,
                  whiteSpace: "nowrap",
                }}
              >
                {busy === waKey ? "⏳…" : sent ? `✅ ${roomLabel}` : `✓ ${roomLabel}`}
              </button>
            );
          })}
          {allSent && rowStatus === "room_ready" && (
            <button
              className="btn btn-sm"
              disabled={busy === g.id}
              onClick={() => setStatus(g, "expected")}
              style={{ background: "#FFF0EE", color: "#C0392B", fontSize: 11 }}
            >
              ↩ בטל חדר מוכן
            </button>
          )}
        </div>
      );
    }

    if (rowStatus === "room_ready") {
      return (
        <button className="btn btn-sm" disabled={busy === g.id}
          onClick={() => setStatus(g, "expected")}
          style={{ background: "#FFF0EE", color: "#C0392B" }}>
          ↩ בטל חדר מוכן
        </button>
      );
    }
    if (rowStatus === "checked_in") {
      return (
        <button className="btn btn-sm" disabled
          title="האורח כבר בצ'ק-אין"
          style={{ background: "#F5F5F5", color: "#AAAAAA", cursor: "not-allowed" }}>
          ✓ חדר מוכן
        </button>
      );
    }
    return (
      <button className="btn btn-sm" disabled={busy === g.id || roomMissing(g) || !canSend}
        onClick={() => setStatus(g, "room_ready")}
        title={
          !canSend ? "שליחה חסומה בשעות שקט — סמן אישור למעלה"
            : roomMissing(g) ? "יש לשבץ חדר לפני סימון כמוכן — לחץ ✏️ לעריכה"
            : undefined
        }
        style={{
          background: roomMissing(g) || !canSend ? "#F5F5F5" : "#E8F5EF",
          color:      roomMissing(g) || !canSend ? "#AAAAAA" : "#1A7A4A",
          cursor:     roomMissing(g) || !canSend ? "not-allowed" : "pointer",
        }}>
        ✓ חדר מוכן
      </button>
    );
  };

  /** Shared action buttons — desktop table + mobile cards (Disable Don't Hide §0.2). */
  const renderGuestActions = (g, rowStatus) => (
    <>
      <button
        className="btn btn-sm"
        onClick={() => openEdit(g)}
        title="ערוך פרופיל אורח"
        style={{ background: "var(--ivory)", color: "var(--gold-dark)", fontWeight: 700, border: "1px solid var(--gold)" }}>
        ✏️
      </button>
      {renderRoomReadyActions(g, rowStatus)}
      {rowStatus === "checked_in" ? (
        <button className="btn btn-sm" disabled={busy === g.id}
          onClick={() => setStatus(g, "expected")}
          style={{ background: "#FFF5E8", color: "#B5600A", fontWeight: 700 }}>
          ↩ בטל צ'ק-אין
        </button>
      ) : (
        <button className="btn btn-sm" disabled={busy === g.id || roomMissing(g)}
          onClick={() => setStatus(g, "checked_in")}
          title={roomMissing(g) ? "יש לשבץ חדר לפני צ'ק-אין — לחץ ✏️ לעריכה" : undefined}
          style={{
            background: roomMissing(g) ? "#F5F5F5" : "#EEF4FF",
            color:      roomMissing(g) ? "#AAAAAA" : "#2952A3",
            cursor:     roomMissing(g) ? "not-allowed" : "pointer",
          }}>
          🛎️ צ'ק-אין
        </button>
      )}
      <button
        className="btn btn-sm"
        disabled={!g.arrival_confirmed || paymentBusy === g.id || busy === g.id}
        onClick={() => handleSendPaymentTemplate(g)}
        title={
          !g.arrival_confirmed
            ? "האורח עדיין לא אישר הגעה — לא ניתן לשלוח תבנית תשלום"
            : (g.direct_payment_url || g.payment_link_url) ? "שלח תבנית תשלום + סדנאות" : "הגדר קישור תשלום לפני שליחה"
        }
        style={{
          background: !g.arrival_confirmed ? "#F5F5F5" : (g.direct_payment_url || g.payment_link_url) ? "#1B3A32" : "#FFF5E8",
          color:      !g.arrival_confirmed ? "#AAAAAA" : (g.direct_payment_url || g.payment_link_url) ? "#fff"    : "#B5600A",
          cursor:     !g.arrival_confirmed ? "not-allowed" : "pointer",
          fontWeight: 700,
        }}
      >
        {paymentBusy === g.id ? "⏳" : "💳 תשלום"}
      </button>
      {busy === g.id && (
        <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>⏳</span>
      )}
    </>
  );

  const renderGuestStatusBadge = (g, sm, rowStatus) => (
    <span
      onClick={rowStatus === "checked_in" ? () => setStatus(g, "expected") : undefined}
      onMouseEnter={rowStatus === "checked_in" ? () => setBadgeHover(g.id) : undefined}
      onMouseLeave={rowStatus === "checked_in" ? () => setBadgeHover(null) : undefined}
      title={rowStatus === "checked_in" ? "לחץ לביטול צ'ק-אין" : undefined}
      style={{
        padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
        background: badgeHover === g.id ? "#FFF0EE" : sm.bg,
        color:      badgeHover === g.id ? "#C0392B" : sm.color,
        cursor: rowStatus === "checked_in" ? "pointer" : "default",
        transition: "background 0.15s, color 0.15s",
        userSelect: "none",
        display: "inline-block",
      }}
    >
      {badgeHover === g.id ? "↩ בטל" : sm.label}
    </span>
  );

  return (
    <div className="checkin-page">
      {quietActive && (
        <div style={{ marginBottom: 16 }}>
          <QuietHoursGate
            active={quietActive}
            checked={overrideChecked}
            onChange={setOverrideChecked}
          />
        </div>
      )}

      {/* ── Payment data modal ─────────────────────────────────────────────── */}
      {paymentModal && (
        <div
          onClick={() => !paymentBusy && setPaymentModal(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
            zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--card-bg, #fff)", borderRadius: 16, padding: "28px 28px 24px",
              width: 360, boxShadow: "0 24px 64px rgba(0,0,0,0.25)", direction: "rtl",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>💳 שלח תשלום + סדנאות</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 22 }}>
              {paymentModal.name} · {paymentModal.phone}
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 5 }}>סכום לתשלום (₪)</label>
              <input
                type="number"
                value={paymentModal.amount}
                onChange={(e) => setPaymentModal((p) => ({ ...p, amount: e.target.value }))}
                placeholder="לדוגמה: 1200"
                disabled={!!paymentBusy}
                style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border, #ddd)", borderRadius: 8, fontSize: 15, direction: "ltr", boxSizing: "border-box" }}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 5 }}>קישור תשלום</label>
              <input
                type="url"
                value={paymentModal.link}
                onChange={(e) => setPaymentModal((p) => ({ ...p, link: e.target.value }))}
                placeholder="https://pay.dream-island.co.il/r/..."
                disabled={!!paymentBusy}
                style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border, #ddd)", borderRadius: 8, fontSize: 12, direction: "ltr", boxSizing: "border-box" }}
              />
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setPaymentModal(null)}
                disabled={!!paymentBusy}
              >ביטול</button>
              <button
                className="btn btn-sm"
                onClick={handleSavePaymentAndSend}
                disabled={!!paymentBusy}
                style={{ background: "#1B3A32", color: "#fff", fontWeight: 700 }}
              >
                {paymentBusy === paymentModal.id ? "⏳ שולח..." : "💳 שמור ושלח"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add guest modal — edit existing guests opens via GuestContextDrawer ── */}
      {editGuest && !editGuest.id && (
        <AddGuestModal
          guest={editGuest}
          onClose={() => setEditGuest(null)}
          onSaved={handleGuestSaved}
          showToast={showToast}
          onOpenDreamBotChat={onOpenDreamBotChat}
        />
      )}

      {/* ── Unified guest profile drawer — same component as WhatsAppInbox's
          roster/thread profile click; GuestDashboard.js's "ניהול אורחים" uses
          the same pattern. Self-fetches a fresh guests row keyed on phone. ── */}
      {profileGuest && (
        <GuestContextDrawer
          contact={{
            phone: profileGuest.phone,
            guestName: profileGuest.name,
            room: profileGuest.room,
            status: profileGuest.status,
            arrivalDate: profileGuest.arrival_date,
            departureDate: profileGuest.departure_date,
            claimedBy: profileGuest.claimed_by,
            portalToken: profileGuest.portal_token,
          }}
          onClose={() => { setProfileGuest(null); setProfileEditOnOpen(false); }}
          onOpenDreamBotChat={onOpenDreamBotChat}
          onOpenCheckin={onOpenCheckin}
          autoOpenEdit={profileEditOnOpen}
          onAutoOpenEditConsumed={() => setProfileEditOnOpen(false)}
          onGuestUpdated={(updated) => {
            setGuests((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)));
          }}
        />
      )}

      <Toast toast={toast} />

      <CheckinTimelineFilterBar
        timelineScope={timelineScope}
        customArrivalDate={customArrivalDate}
        onScopeChange={(scope) => {
          setTimelineScope(scope);
          setSelectedIds(new Set());
        }}
        onCustomDateChange={(date) => {
          setCustomArrivalDate(date);
          setSelectedIds(new Set());
        }}
        scopeCounts={scopeCounts}
        showLegend
      />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {displayGuests.length} אורחים · {filterLabel}
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
            background: "rgba(201,169,110,0.15)", color: "var(--gold-dark)",
            border: "1px solid var(--gold)",
          }}>👑 סוויטות בלבד</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {selectedIds.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              disabled={deleteBusy}
              style={{
                padding: "7px 14px", borderRadius: 8, border: "2px solid #DC2626",
                background: deleteBusy ? "var(--ivory)" : "#FEF2F2", color: "#DC2626",
                fontFamily: "Heebo, sans-serif", fontSize: 13, fontWeight: 700, cursor: deleteBusy ? "not-allowed" : "pointer",
              }}>
              {deleteBusy ? "⏳ מוחק..." : `🗑️ מחק נבחרים (${selectedIds.size})`}
            </button>
          )}
          <button
            onClick={openAdd}
            style={{
              padding: "7px 14px", borderRadius: 8, border: "none",
              background: "linear-gradient(135deg,var(--gold),var(--gold-dark))",
              color: "#0F0F0F", fontFamily: "Heebo,sans-serif",
              fontSize: 13, fontWeight: 800, cursor: "pointer",
            }}>
            + הוסף אורח
          </button>
          <button className="btn btn-ghost btn-sm" onClick={fetchGuestsManual} disabled={loading || refreshing}>
            {refreshing ? "..." : "↺ רענון"}
          </button>
        </div>
      </div>

      {timelineScope === CHECKIN_TIMELINE_TODAY && (
        <div className="card" style={{ padding: "16px 18px", marginBottom: 16 }}>
          <button
            type="button"
            onClick={toggleEtaBoard}
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              width: "100%", marginBottom: etaBoardOpen ? 12 : 0, flexWrap: "wrap", gap: 8,
              border: "none", background: "transparent", padding: 0, cursor: "pointer",
              fontFamily: "Heebo, sans-serif", textAlign: "right",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--black)", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{etaBoardOpen ? "▼" : "▶"}</span>
              🕐 לוח זמני הגעה — היום ({etaBoardGuests.length})
            </div>
            {etaMissingCount > 0 && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
                background: "#FFF0EE", color: "#C0392B", border: "1px solid #C0392B",
              }}>
                ⚠ {etaMissingCount} ללא שעת הגעה
              </span>
            )}
          </button>

          {etaBoardOpen && (etaBoardGuests.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "6px 2px" }}>
              אין אורחים בטרום-הגעה להיום.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {etaBoardGuests.map((g) => {
                const arr = formatCheckinArrivalDisplay(g);
                const hasValidEta = !!arr.eta && /^\d{2}:\d{2}$/.test(arr.eta);
                const rowHi = getCheckinRowHighlight(g);
                const sm = STATUS_META[g.status] ?? {};
                return (
                  <div
                    key={g.id}
                    onClick={() => openProfile(g)}
                    title="הצג פרופיל אורח"
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 12px", borderRadius: 8, cursor: "pointer",
                      background: rowHi.bg || "var(--ivory)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <span style={{
                      minWidth: 78, fontSize: 13, fontWeight: 800, direction: "ltr", textAlign: "center",
                      color: hasValidEta ? "var(--gold-dark)" : "#C0392B",
                    }}>
                      {hasValidEta ? `🕐 ${arr.eta}` : "⚠ טרם נמסר"}
                    </span>
                    <span style={{ minWidth: 90, fontSize: 13, color: "var(--text-muted)" }}>
                      {roomNameFor(g) || "—"}
                    </span>
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: "var(--black)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {g.name}
                      <MissingDepartureBadge guest={g} />
                    </span>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 20,
                      background: sm.bg ?? "var(--ivory)", color: sm.color ?? "var(--text-muted)",
                    }}>
                      {sm.label ?? g.status}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {!isSupabaseConfigured && (
        <div style={{ background: "#FFF5E8", border: "1px solid #F5A623", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#7A4A00" }}>
          Supabase לא מחובר — לא ניתן לטעון אורחים.
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>טוען אורחים...</div>
      ) : displayGuests.length === 0 ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>
          {isCustomDateActive
            ? `אין אורחי סוויטות עם הגעה ב-${filterLabel.replace("הגעה ", "")}.`
            : timelineScope === CHECKIN_TIMELINE_ARCHIVE
            ? "אין אורחי סוויטות בארכיון לאחר שהות."
            : timelineScope === CHECKIN_TIMELINE_TOMORROW
            ? "אין הגעות מתוכננות למחר — בדוק ב«7 ימים קרובים» או ייבא הגעות."
            : timelineScope === CHECKIN_TIMELINE_WEEK7
            ? "אין הגעות מתוכננות ב-7 הימים הקרובים."
            : "אין אורחים פעילים להיום — ייבא הגעות דרך \"סנכרון נתונים\" או הוסף אורח ידנית."}
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden", padding: 0 }}>
          <div className="checkin-table-wrap table-scroll">
            <table className="table" style={{ width: "100%", minWidth: 880 }}>
              <thead><tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox"
                    checked={displayGuests.length > 0 && selectedIds.size === displayGuests.length}
                    onChange={toggleSelectAll}
                    title="בחר הכל"
                    style={{ cursor: "pointer", accentColor: "var(--gold)" }} />
                </th>
                <th>שם</th><th>טלפון</th><th>חדר</th><th>סוג</th><th>הגעה</th>
                <th style={{ color: "#7c3aed" }}>ספא</th>
                <th>סטטוס</th><th>פעולות</th>
              </tr></thead>
              <tbody>
                {displayGuests.map((g) => {
                  const effectiveStatus = resolveEffectiveGuestStatus(g);
                  const sm = STATUS_META[effectiveStatus] ?? STATUS_META[g.status] ?? { label: `⚠ ${g.status ?? "ללא סטטוס"}`, bg: "#FFF0EE", color: "#C0392B" };
                  const rowStatus = g.status;
                  const rowHi = getCheckinRowHighlight(g);
                  const rowBg = selectedIds.has(g.id)
                    ? "rgba(201,169,110,0.12)"
                    : rowHi.bg;
                  return (
                    <tr
                      key={g.id}
                      title={rowHi.title ?? undefined}
                      style={{ background: rowBg }}
                    >
                      <td>
                        <input type="checkbox"
                          checked={selectedIds.has(g.id)}
                          onChange={() => toggleSelect(g.id)}
                          style={{ cursor: "pointer", accentColor: "var(--gold)" }} />
                      </td>
                      <td style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {rowHi.dot && (
                          <span
                            aria-hidden
                            title={rowHi.title ?? undefined}
                            style={{
                              display: "inline-block",
                              width: 7,
                              height: 7,
                              borderRadius: "50%",
                              background: rowHi.dot,
                              marginLeft: 6,
                              verticalAlign: "middle",
                              flexShrink: 0,
                            }}
                          />
                        )}
                        <span
                          onClick={() => openProfile(g)}
                          title="הצג פרופיל אורח · הקשר 360°"
                          style={{ cursor: "pointer", textDecoration: "underline", textDecorationColor: "transparent" }}
                          onMouseEnter={(e) => (e.currentTarget.style.textDecorationColor = "var(--gold)")}
                          onMouseLeave={(e) => (e.currentTarget.style.textDecorationColor = "transparent")}
                        >
                          {g.name}
                        </span>
                        {g.arrival_confirmed && (
                          <span title={describeArrivalConfirmedSource(g.arrival_confirmed_source)} style={{ fontSize: 10, marginRight: 6, background: "#E8F5EF", color: "#1A7A4A", padding: "2px 6px", borderRadius: 8, fontWeight: 700, verticalAlign: "middle" }}>✓ אישר</span>
                        )}
                        {g.automation_muted && (
                          <span title="אוטומציה מושתקת — הבוט לא ישלח הודעות אוטומטיות לאורח זה. לחץ ✏️ לביטול." style={{ fontSize: 10, marginRight: 6, background: "#F3F4F6", color: "#6B7280", padding: "2px 6px", borderRadius: 8, fontWeight: 700, verticalAlign: "middle" }}>🔇 מושתק</span>
                        )}
                        <GuestAttentionBadge
                          guest={g}
                          showToast={showToast}
                          onOpenDreamBotChat={onOpenDreamBotChat}
                          onOpenFullEdit={(guestRow) => openProfile(guestRow, true)}
                          onUpdated={(updated) =>
                            setGuests((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)))
                          }
                        />
                      </td>
                      <td style={{ direction: "ltr", fontSize: 13 }}>{g.phone ?? "—"}</td>
                      <td>{g.room ?? roomByPhone[g.phone]?.roomName ?? "—"}</td>
                      <td>
                        <span style={{
                          padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                          background: isSuite(g) ? "rgba(201,169,110,0.2)" : "var(--ivory)",
                          color: isSuite(g) ? "var(--gold-dark)" : "var(--text-muted)",
                        }}>{isSuite(g) ? "👑 סוויטה" : "סטנדרט"}</span>
                        {hasSuiteRoomTypeConflict(g) && (
                          <span
                            className="badge badge-orange"
                            title="סתירת סיווג: החדר הוא סוויטה אך סוג האורח מסומן יום-כיף — האוטומציה מנתבת כסוויטה. לחץ ✏️ ותקן את סוג החדר."
                            style={{ marginRight: 6, whiteSpace: "nowrap" }}
                          >
                            ⚠ סתירת סיווג
                          </span>
                        )}
                        {hasPremiumDayRoomTypeConflict(g) && (
                          <span
                            className="badge badge-orange"
                            title="סתירת סיווג: חבילת Premium Day אך סוג האורח מסומן סוויטה — האוטומציה מנתבת כיום-כיף. לחץ ✏️ ותקן את סוג החדר."
                            style={{ marginRight: 6, whiteSpace: "nowrap" }}
                          >
                            ⚠ פרימיום דיי
                          </span>
                        )}
                      </td>
                      <td style={{ fontSize: 13 }}>
                        {(() => {
                          const arr = formatCheckinArrivalDisplay(g);
                          return (
                            <>
                              <div>{arr.date}</div>
                              {arr.eta && (
                                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--gold-dark)", direction: "ltr" }}>
                                  🕐 {arr.eta}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </td>
                      <td style={{
                        fontSize: 13, fontWeight: (g.spa_time || g.spa_date) ? 800 : 400,
                        color: (g.spa_time || g.spa_date) ? "#7c3aed" : "var(--text-muted)",
                      }}>
                        {formatSpaSchedule(g.spa_date, g.spa_time) || "—"}
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                          {renderGuestStatusBadge(g, sm, rowStatus)}
                          {renderHousekeepingSyncChip(g, rowStatus)}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {renderGuestActions(g, rowStatus)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="checkin-guest-cards">
            {displayGuests.map((g) => {
              const effectiveStatus = resolveEffectiveGuestStatus(g);
              const sm = STATUS_META[effectiveStatus] ?? STATUS_META[g.status] ?? { label: `⚠ ${g.status ?? "ללא סטטוס"}`, bg: "#FFF0EE", color: "#C0392B" };
              const rowStatus = g.status;
              const rowHi = getCheckinRowHighlight(g);
              const rowBg = selectedIds.has(g.id) ? "rgba(201,169,110,0.12)" : rowHi.bg;
              return (
                <article
                  key={g.id}
                  className="checkin-guest-card"
                  title={rowHi.title ?? undefined}
                  style={{ background: rowBg }}
                >
                  <div className="checkin-guest-card-header">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(g.id)}
                      onChange={() => toggleSelect(g.id)}
                      style={{ cursor: "pointer", accentColor: "var(--gold)", marginTop: 4, flexShrink: 0 }}
                      aria-label={`בחר ${g.name}`}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                        {rowHi.dot && (
                          <span
                            aria-hidden
                            style={{
                              width: 8, height: 8, borderRadius: "50%",
                              background: rowHi.dot, flexShrink: 0,
                            }}
                          />
                        )}
                        <span
                          onClick={() => openProfile(g)}
                          style={{ fontWeight: 800, fontSize: 16, cursor: "pointer" }}
                        >
                          {g.name}
                        </span>
                        {g.arrival_confirmed && (
                          <span title={describeArrivalConfirmedSource(g.arrival_confirmed_source)} style={{ fontSize: 10, background: "#E8F5EF", color: "#1A7A4A", padding: "2px 6px", borderRadius: 8, fontWeight: 700 }}>✓ אישר</span>
                        )}
                        {g.automation_muted && (
                          <span title="אוטומציה מושתקת — הבוט לא ישלח הודעות אוטומטיות לאורח זה." style={{ fontSize: 10, background: "#F3F4F6", color: "#6B7280", padding: "2px 6px", borderRadius: 8, fontWeight: 700 }}>🔇 מושתק</span>
                        )}
                        {renderGuestStatusBadge(g, sm, rowStatus)}
                        {renderHousekeepingSyncChip(g, rowStatus)}
                      </div>
                      <GuestAttentionBadge
                        guest={g}
                        showToast={showToast}
                        onOpenDreamBotChat={onOpenDreamBotChat}
                        onOpenFullEdit={(guestRow) => openProfile(guestRow, true)}
                        onUpdated={(updated) =>
                          setGuests((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)))
                        }
                      />
                    </div>
                  </div>
                  <dl className="checkin-guest-card-meta">
                    <div>
                      <dt>טלפון</dt>
                      <dd style={{ direction: "ltr", textAlign: "right" }}>{g.phone ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>חדר</dt>
                      <dd>{g.room ?? roomByPhone[g.phone]?.roomName ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>סוג</dt>
                      <dd>
                        {isSuite(g) ? "👑 סוויטה" : "סטנדרט"}
                        {hasSuiteRoomTypeConflict(g) && (
                          <span
                            className="badge badge-orange"
                            title="סתירת סיווג: החדר הוא סוויטה אך סוג האורח מסומן יום-כיף — האוטומציה מנתבת כסוויטה. לחץ ✏️ ותקן את סוג החדר."
                            style={{ marginRight: 6, whiteSpace: "nowrap", display: "inline-block" }}
                          >
                            ⚠ סתירת סיווג
                          </span>
                        )}
                        {hasPremiumDayRoomTypeConflict(g) && (
                          <span
                            className="badge badge-orange"
                            title="סתירת סיווג: חבילת Premium Day אך סוג האורח מסומן סוויטה — האוטומציה מנתבת כיום-כיף. לחץ ✏️ ותקן את סוג החדר."
                            style={{ marginRight: 6, whiteSpace: "nowrap", display: "inline-block" }}
                          >
                            ⚠ פרימיום דיי
                          </span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>הגעה</dt>
                      <dd>
                        {(() => {
                          const arr = formatCheckinArrivalDisplay(g);
                          return arr.eta ? `${arr.date} · 🕐 ${arr.eta}` : arr.date;
                        })()}
                      </dd>
                    </div>
                    <div>
                      <dt>ספא</dt>
                      <dd style={{
                        color: (g.spa_time || g.spa_date) ? "#7c3aed" : "var(--text-muted)",
                        fontWeight: (g.spa_time || g.spa_date) ? 800 : 400,
                      }}>
                        {formatSpaSchedule(g.spa_date, g.spa_time) || "—"}
                      </dd>
                    </div>
                  </dl>
                  <div className="checkin-guest-card-actions">
                    {renderGuestActions(g, rowStatus)}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
