// Armonim shift session — context for kiosk (roster, active session, floor view).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import {
  BOT_CONFIG_RESTAURANT_KIOSK_UI_KEY,
  normalizeRestaurantKioskUi,
} from "../utils/restaurantKioskUi";
import {
  readLocalShiftSession,
  writeLocalShiftSession,
  isRestaurantFloorLeadRole,
} from "../utils/restaurantShiftSession";

const RestaurantShiftContext = createContext(null);

export function useRestaurantShift() {
  const ctx = useContext(RestaurantShiftContext);
  return ctx;
}

export function RestaurantShiftProvider({ user, children }) {
  const [kioskUi, setKioskUi] = useState(() => normalizeRestaurantKioskUi(null));
  const [roster, setRoster] = useState([]);
  const [session, setSession] = useState(null);
  const [activeOnFloor, setActiveOnFloor] = useState([]);
  const [booting, setBooting] = useState(true);

  const deviceProfileId = user?.id ?? null;

  const loadKioskUi = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const { data } = await supabase
      .from("bot_config")
      .select("config_value")
      .eq("config_key", BOT_CONFIG_RESTAURANT_KIOSK_UI_KEY)
      .maybeSingle();
    let raw = data?.config_value;
    if (typeof raw === "string") {
      try { raw = JSON.parse(raw); } catch { raw = null; }
    }
    setKioskUi(normalizeRestaurantKioskUi(raw));
  }, []);

  const loadRoster = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const { data, error } = await supabase
      .from("restaurant_floor_staff")
      .select("id, display_name, can_be_shift_manager, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("display_name", { ascending: true });
    if (!error) setRoster(data ?? []);
  }, []);

  const loadActiveFloor = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const { data, error } = await supabase
      .from("restaurant_shift_sessions")
      .select("id, display_name, session_role, started_at, device_profile_id")
      .is("ended_at", null)
      .order("started_at", { ascending: true });
    if (!error) setActiveOnFloor(data ?? []);
  }, []);

  const restoreSession = useCallback(async () => {
    const local = readLocalShiftSession();
    if (!local?.sessionId || !supabase) {
      setSession(null);
      setBooting(false);
      return;
    }
    const { data, error } = await supabase
      .from("restaurant_shift_sessions")
      .select("id, display_name, session_role, started_at, staff_id, orders_count, wa_sent_count")
      .eq("id", local.sessionId)
      .is("ended_at", null)
      .maybeSingle();
    if (error || !data) {
      writeLocalShiftSession(null);
      setSession(null);
    } else {
      setSession({
        sessionId: data.id,
        displayName: data.display_name,
        sessionRole: data.session_role,
        startedAt: data.started_at,
        staffId: data.staff_id ?? null,
        ordersCount: data.orders_count ?? 0,
        waSentCount: data.wa_sent_count ?? 0,
      });
      writeLocalShiftSession({
        sessionId: data.id,
        displayName: data.display_name,
        sessionRole: data.session_role,
        startedAt: data.started_at,
        staffId: data.staff_id ?? null,
      });
    }
    setBooting(false);
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([loadKioskUi(), loadRoster(), loadActiveFloor()]);
      await restoreSession();
    })();
  }, [loadKioskUi, loadRoster, loadActiveFloor, restoreSession]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const ch = supabase
      .channel("restaurant-shift-sessions")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "restaurant_shift_sessions" },
        () => { loadActiveFloor(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadActiveFloor]);

  const startShift = useCallback(async ({
    displayName,
    sessionRole,
    staffId = null,
    mealPeriod = "dinner",
    shiftManagerPin = "",
  }) => {
    if (!supabase || !deviceProfileId) throw new Error("לא מחובר למערכת");
    const name = String(displayName ?? "").trim();
    if (!name) throw new Error("נא לבחור שם");

    if (sessionRole === "shift_manager") {
      const pinRequired = String(kioskUi.shift_manager_pin ?? "").trim();
      if (pinRequired && pinRequired !== String(shiftManagerPin ?? "").trim()) {
        throw new Error("קוד מנהל משמרת שגוי");
      }
    }

    const { data, error } = await supabase
      .from("restaurant_shift_sessions")
      .insert({
        staff_id: staffId,
        display_name: name,
        session_role: sessionRole,
        meal_period: mealPeriod,
        device_profile_id: deviceProfileId,
      })
      .select("id, display_name, session_role, started_at, staff_id, orders_count, wa_sent_count")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new Error("שגיאה בפתיחת משמרת");

    const next = {
      sessionId: data.id,
      displayName: data.display_name,
      sessionRole: data.session_role,
      startedAt: data.started_at,
      staffId: data.staff_id ?? null,
      ordersCount: 0,
      waSentCount: 0,
    };
    setSession(next);
    writeLocalShiftSession({
      sessionId: next.sessionId,
      displayName: next.displayName,
      sessionRole: next.sessionRole,
      startedAt: next.startedAt,
      staffId: next.staffId,
    });
    await loadActiveFloor();
    return next;
  }, [deviceProfileId, kioskUi.shift_manager_pin, loadActiveFloor]);

  const endShift = useCallback(async () => {
    if (!session?.sessionId || !supabase) return;
    const endedAt = new Date().toISOString();
    const { error } = await supabase
      .from("restaurant_shift_sessions")
      .update({ ended_at: endedAt })
      .eq("id", session.sessionId)
      .is("ended_at", null);
    if (error) throw new Error(error.message);
    setSession(null);
    writeLocalShiftSession(null);
    await loadActiveFloor();
  }, [session?.sessionId, loadActiveFloor]);

  const bumpStat = useCallback(async (field) => {
    if (!session?.sessionId || !supabase) return;
    const col = field === "orders" ? "orders_count" : "wa_sent_count";
    const current = field === "orders" ? session.ordersCount : session.waSentCount;
    const nextVal = (current ?? 0) + 1;
    const { error } = await supabase
      .from("restaurant_shift_sessions")
      .update({ [col]: nextVal })
      .eq("id", session.sessionId);
    if (error) return;
    setSession((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        ordersCount: field === "orders" ? nextVal : prev.ordersCount,
        waSentCount: field === "wa" ? nextVal : prev.waSentCount,
      };
    });
  }, [session?.sessionId, session?.ordersCount, session?.waSentCount]);

  const recordOrderSent = useCallback(() => bumpStat("orders"), [bumpStat]);
  const recordWaSent = useCallback(() => bumpStat("wa"), [bumpStat]);

  const value = useMemo(() => ({
    kioskUi,
    roster,
    session,
    booting,
    activeOnFloor,
    isShiftManager: session?.sessionRole === "shift_manager",
    isHostess: session?.sessionRole === "hostess",
    isFloorLead: isRestaurantFloorLeadRole(session?.sessionRole),
    startShift,
    endShift,
    recordOrderSent,
    recordWaSent,
    refreshRoster: loadRoster,
  }), [
    kioskUi,
    roster,
    session,
    booting,
    activeOnFloor,
    startShift,
    endShift,
    recordOrderSent,
    recordWaSent,
    loadRoster,
  ]);

  return (
    <RestaurantShiftContext.Provider value={value}>
      {children}
    </RestaurantShiftContext.Provider>
  );
}
