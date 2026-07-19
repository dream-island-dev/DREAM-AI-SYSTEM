// Restaurant Board (לוח מסעדה) — תיאום צהריים + ערב בפרופיל אורח (מסנכרן לבוט + פורטל).

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import IsraeliTimeSelect from "./IsraeliTimeSelect";
import { israelTodayStr } from "../utils/guestTiming";
import {
  filterRestaurantDinnerGuests,
  sortRestaurantDinnerGuests,
  buildRestaurantDinnerMealPatch,
  getCoordinationSlotsForGuest,
  getLunchQuickSlots,
  guestNeedsMealCoordination,
  getEffectiveMealPlanForRestaurant,
  getGuestMealSlotTime,
} from "../utils/restaurantDinnerGuests";
import { mealPlanLabel, MEAL_SLOT_LABELS, normalizeMealPlan } from "../data/stayMealsSchema";
import { isSuiteGuestProfile } from "../utils/guestTiming";
import RestaurantWalkInModal from "./RestaurantWalkInModal";
import RestaurantMenuAdminPanel from "./RestaurantMenuAdminPanel";
import RestaurantOrderPanel from "./RestaurantOrderPanel";
import RestaurantActiveOrdersPanel from "./RestaurantActiveOrdersPanel";
import { canManageRestaurantMenu } from "../utils/auth";
import { formatGuestDietaryBrief, normalizeGuestProfile } from "../data/guestProfileSchema";
import {
  composeAskMessage,
  composeConfirmMessage,
  composeCustomMessage,
  normalizeRestaurantDinnerMessages,
  BOT_CONFIG_RESTAURANT_DINNER_MESSAGES_KEY,
  sendRestaurantGuestWa,
} from "../utils/restaurantDinnerMessaging";
import RestaurantDinnerTemplatesPanel from "./RestaurantDinnerTemplatesPanel";

const GOLD = "#C9A96E";
const GOLD_DARK = "#A8843A";

function mergeRestaurantAudit(profile, user) {
  const p = normalizeGuestProfile(profile);
  return {
    ...p,
    restaurant: {
      ...(p.restaurant && typeof p.restaurant === "object" ? p.restaurant : {}),
      meals_updated_at: new Date().toISOString(),
      meals_updated_by: user?.id ?? null,
      meals_updated_by_name: user?.name ?? null,
    },
  };
}

function SlotChip({ label, selected, onClick, disabled, title }) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      style={{
        padding: "6px 11px",
        borderRadius: 20,
        border: `2px solid ${selected ? GOLD_DARK : "var(--border, #ddd)"}`,
        background: selected ? "rgba(201,169,110,0.2)" : "#fff",
        color: selected ? "#9A7209" : "var(--text-muted, #666)",
        fontWeight: 700,
        fontSize: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "Heebo, sans-serif",
      }}
    >
      {label}
    </button>
  );
}

const WA_TABS = [
  { id: "ask", label: "📩 שאל תיאום" },
  { id: "confirm", label: "✓ אישור שעה" },
  { id: "custom", label: "✏️ חופשי" },
];

function MessageTextarea({ label, value, onChange, onReset, disabled, rows = 5 }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>{label}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={onReset}
          style={{
            border: "none", background: "transparent", color: "#4338CA",
            fontSize: 11, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer",
            fontFamily: "Heebo, sans-serif", padding: 0,
          }}
        >
          ↺ נוסח ברירת מחדל
        </button>
      </div>
      <textarea
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        style={{
          width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8,
          border: "1px solid var(--border, #ddd)", fontSize: 13, lineHeight: 1.55,
          fontFamily: "Heebo, sans-serif", textAlign: "right", resize: "vertical",
        }}
      />
    </div>
  );
}

function GuestListRow({ guest, selected, onSelect, onOpenChat }) {
  const vip = normalizeGuestProfile(guest.guest_profile).vip_status === "vip";
  const needsTime = guestNeedsMealCoordination(guest);
  const dinnerTime = getGuestMealSlotTime(guest, "dinner");
  const lunchTime = getGuestMealSlotTime(guest, "lunch");
  const isSuite = isSuiteGuestProfile(guest);
  const hasPhone = Boolean(String(guest.phone ?? "").trim());
  const effectivePlan = getEffectiveMealPlanForRestaurant(guest);

  const handleNameClick = (e) => {
    e.stopPropagation();
    if (hasPhone && onOpenChat) {
      onOpenChat(guest);
      return;
    }
    onSelect?.(guest);
  };

  return (
    <button
      type="button"
      onClick={() => onSelect?.(guest)}
      style={{
        width: "100%", textAlign: "right", cursor: "pointer",
        border: selected ? `2px solid ${GOLD_DARK}` : "1px solid var(--border, #E0D5C5)",
        borderRadius: 10, padding: "10px 12px", marginBottom: 6,
        background: selected ? "rgba(201,169,110,0.14)" : "var(--card-bg, #fff)",
        fontFamily: "Heebo, sans-serif", transition: "background 0.15s",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            role="button"
            tabIndex={0}
            onClick={handleNameClick}
            onKeyDown={(e) => { if (e.key === "Enter") handleNameClick(e); }}
            title={hasPhone ? "לחץ לפתיחת שיחת וואטסאפ לתיאום" : "אין טלפון — בחרו לעריכת שעות"}
            style={{
              fontWeight: 800, fontSize: 14, color: hasPhone ? "#1D4ED8" : "var(--black, #1A1A1A)",
              textDecoration: hasPhone ? "underline" : "none",
              textUnderlineOffset: 3, cursor: "pointer", marginBottom: 3,
            }}
          >
            {vip && "⭐ "}{guest.name || "—"}
            {hasPhone && <span style={{ marginRight: 4, fontSize: 11 }}>💬</span>}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.45 }}>
            {guest.room ? `🏨 ${guest.room}` : "ללא חדר"}
            {isSuite && !guest.room ? " · סוויטה" : ""}
            {guest.status === "checked_in" ? " · בבריזורט" : ""}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
            {mealPlanLabel(effectivePlan)}
            {dinnerTime ? ` · ערב ${dinnerTime}` : ""}
            {lunchTime ? ` · צהריים ${lunchTime}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          {needsTime ? (
            <span style={{
              fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 12,
              background: "rgba(220,38,38,0.1)", color: "#B91C1C",
            }}>
              חסרה שעה
            </span>
          ) : (
            <span style={{
              fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 12,
              background: "rgba(26,122,74,0.1)", color: "#1A7A4A",
            }}>
              ✓ מתואם
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function GuestDinnerRow({ guest, user, msgConfig, onSaved, onError, onNotify, onOpenChat }) {
  const cfg = normalizeRestaurantDinnerMessages(msgConfig);
  const offerSlots = cfg.offer_slots;
  const defaultAskSlots = cfg.default_ask_slots;
  const lunchQuickSlots = getLunchQuickSlots(cfg);
  const coordinationSlots = getCoordinationSlotsForGuest(guest);
  const showLunch = coordinationSlots.includes("lunch");
  const showDinner = coordinationSlots.includes("dinner")
    || (!coordinationSlots.length && Boolean(guest.guest_profile?.restaurant?.walk_in));

  const [lunchTime, setLunchTime] = useState(guest.lunch_time ?? "");
  const [dinnerTime, setDinnerTime] = useState(guest.dinner_time ?? guest.meal_time ?? "");
  const [mealLocation, setMealLocation] = useState(guest.meal_location ?? "מסעדת ערמונים");
  const [offerSlotsSelected, setOfferSlotsSelected] = useState(() => [...defaultAskSlots]);
  const [waTab, setWaTab] = useState("ask");
  const [askText, setAskText] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [customText, setCustomText] = useState("");
  const [askDirty, setAskDirty] = useState(false);
  const [confirmDirty, setConfirmDirty] = useState(false);
  const [customDirty, setCustomDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingWa, setSendingWa] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const savedTime = String(guest.dinner_time ?? guest.meal_time ?? "").trim();
  const hasPhone = Boolean(String(guest.phone ?? "").trim());
  const loc = (mealLocation || "מסעדת ערמונים").trim();
  const effectiveTime = String(dinnerTime || savedTime).trim();

  useEffect(() => {
    setLunchTime(guest.lunch_time ?? "");
    setDinnerTime(guest.dinner_time ?? guest.meal_time ?? "");
    setMealLocation(guest.meal_location ?? "מסעדת ערמונים");
  }, [guest.id, guest.lunch_time, guest.dinner_time, guest.meal_time, guest.meal_location]);

  useEffect(() => {
    setOfferSlotsSelected([...defaultAskSlots]);
  }, [guest.id, defaultAskSlots.join(",")]);

  const regenAsk = useCallback(() => {
    return composeAskMessage(cfg, {
      guestName: guest.name,
      slots: offerSlotsSelected.filter(Boolean),
      location: loc,
    });
  }, [cfg, guest.name, offerSlotsSelected, loc]);

  const regenConfirm = useCallback(() => {
    return composeConfirmMessage(cfg, {
      guestName: guest.name,
      time: effectiveTime,
      location: loc,
    });
  }, [cfg, guest.name, effectiveTime, loc]);

  const regenCustom = useCallback(() => {
    return composeCustomMessage(cfg, { guestName: guest.name, location: loc });
  }, [cfg, guest.name, loc]);

  useEffect(() => {
    if (!askDirty) setAskText(regenAsk());
  }, [askDirty, regenAsk]);

  useEffect(() => {
    if (!confirmDirty) setConfirmText(regenConfirm());
  }, [confirmDirty, regenConfirm]);

  useEffect(() => {
    if (!customDirty) setCustomText(regenCustom());
  }, [customDirty, regenCustom]);

  useEffect(() => {
    if (!askDirty) setAskText(regenAsk());
    if (!confirmDirty) setConfirmText(regenConfirm());
    if (!customDirty) setCustomText(regenCustom());
  }, [msgConfig]);

  const dietary = formatGuestDietaryBrief(guest.guest_profile);
  const vip = normalizeGuestProfile(guest.guest_profile).vip_status === "vip";
  const effectivePlan = getEffectiveMealPlanForRestaurant(guest);
  const planUnset = normalizeMealPlan(guest.meal_plan) === "none" && effectivePlan !== "none";

  const persistGuest = async () => {
    const mealPatch = buildRestaurantDinnerMealPatch(guest, {
      lunchTime,
      dinnerTime,
      mealLocation: loc,
    });

    const { data: current, error: readErr } = await supabase
      .from("guests")
      .select("guest_profile")
      .eq("id", guest.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);

    const guest_profile = mergeRestaurantAudit(current?.guest_profile, user);

    const { error } = await supabase
      .from("guests")
      .update({ ...mealPatch, guest_profile })
      .eq("id", guest.id);
    if (error) throw new Error(error.message);

    const updated = { ...guest, ...mealPatch, guest_profile };
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
    onSaved?.(updated);
    return updated;
  };

  const save = async () => {
    if (!supabase) return;
    setSaving(true);
    try {
      await persistGuest();
    } catch (e) {
      onError?.(e?.message ?? "שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  };

  const saveAndNotify = async () => {
    if (!supabase || !hasPhone) return;
    const time = String(dinnerTime ?? "").trim();
    if (!time) {
      onError?.("בחרו שעת ערב לפני שליחת אישור");
      return;
    }
    const msg = String(confirmText ?? "").trim();
    if (!msg) {
      onError?.("הודעת אישור ריקה");
      return;
    }
    setSaving(true);
    setSendingWa(true);
    try {
      await persistGuest();
      await sendRestaurantGuestWa(supabase, guest, msg);
      onNotify?.("נשמר בפרופיל + אישור נשלח לאורח");
    } catch (e) {
      onError?.(e?.message ?? "שגיאה");
    } finally {
      setSaving(false);
      setSendingWa(false);
    }
  };

  const sendWaMessage = async (message, successLabel) => {
    if (!supabase || !hasPhone) return;
    const msg = String(message ?? "").trim();
    if (!msg) {
      onError?.("הודעה ריקה");
      return;
    }
    setSendingWa(true);
    try {
      await sendRestaurantGuestWa(supabase, guest, msg);
      onNotify?.(successLabel);
    } catch (e) {
      onError?.(e?.message ?? "שגיאה בשליחה");
    } finally {
      setSendingWa(false);
    }
  };

  const askGuest = () => {
    const slots = offerSlotsSelected.filter(Boolean);
    if (!slots.length) {
      onError?.("בחרו לפחות שעה אחת להציע לאורח");
      return;
    }
    sendWaMessage(askText, "שאלת תיאום נשלחה לאורח");
  };

  const confirmOnly = () => {
    if (!effectiveTime) {
      onError?.("אין שעה — קבעו שעה קודם");
      return;
    }
    sendWaMessage(confirmText, "אישור נשלח לאורח");
  };

  const sendCustom = () => sendWaMessage(customText, "הודעה נשלחה לאורח");

  const toggleOfferSlot = (slot) => {
    setOfferSlotsSelected((prev) => {
      if (prev.includes(slot)) {
        if (prev.length <= 1) return prev;
        return prev.filter((s) => s !== slot);
      }
      return [...prev, slot].sort();
    });
    setAskDirty(false);
  };

  const dirty =
    lunchTime !== (guest.lunch_time ?? "")
    || dinnerTime !== (guest.dinner_time ?? guest.meal_time ?? "")
    || mealLocation !== (guest.meal_location ?? "");

  const busy = saving || sendingWa;

  return (
    <div style={{
      border: "1px solid var(--border, #E0D5C5)",
      borderRadius: 12,
      padding: "14px 16px",
      background: savedFlash ? "rgba(26,122,74,0.06)" : "var(--card-bg, #fff)",
      transition: "background 0.25s",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
        <div>
          <button
            type="button"
            onClick={() => hasPhone && onOpenChat?.(guest)}
            disabled={!hasPhone || !onOpenChat}
            title={hasPhone ? "פתיחת שיחת וואטסאפ לתיאום שעה" : "אין טלפון"}
            style={{
              border: "none", background: "transparent", padding: 0, cursor: hasPhone && onOpenChat ? "pointer" : "default",
              fontWeight: 800, fontSize: 15,
              color: hasPhone && onOpenChat ? "#1D4ED8" : "var(--black, #1A1A1A)",
              textDecoration: hasPhone && onOpenChat ? "underline" : "none",
              textUnderlineOffset: 3, fontFamily: "Heebo, sans-serif", textAlign: "right",
            }}
          >
            {vip && <span title="VIP">⭐ </span>}
            {guest.name || "—"}
            {hasPhone && onOpenChat && <span style={{ marginRight: 6, fontSize: 12 }}>💬</span>}
          </button>
          <div style={{ fontSize: 12.5, color: "var(--text-muted, #666)", marginTop: 4 }}>
            {guest.room ? `🏨 ${guest.room}` : "ללא חדר"}
            {guest.status === "checked_in" ? " · בבריזורט" : guest.status === "expected" || guest.status === "pending" ? " · מגיע היום" : ""}
          </div>
        </div>
        <div style={{
          fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20,
          background: "rgba(180,83,9,0.12)", color: "#9A7209",
        }}>
          {mealPlanLabel(effectivePlan)}
        </div>
      </div>

      {planUnset && (
        <div style={{
          fontSize: 11.5, color: "#4338CA", background: "rgba(99,102,241,0.08)",
          padding: "7px 10px", borderRadius: 8, marginBottom: 10,
        }}>
          פנסיון לא מוגדר בפרופיל — מוצג כ{mealPlanLabel(effectivePlan)}. שמירה תעדכן את הפרופיל.
        </div>
      )}

      {dietary && (
        <div style={{
          fontSize: 12, color: "#9A7209", background: "rgba(180,83,9,0.08)",
          padding: "8px 10px", borderRadius: 8, marginBottom: 10, lineHeight: 1.5,
        }}>
          🥗 {dietary}
        </div>
      )}

      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
          שולחן / מיקום
        </label>
        <input
          type="text"
          value={mealLocation}
          onChange={(e) => setMealLocation(e.target.value)}
          disabled={busy}
          placeholder="מסעדת ערמונים"
          style={{
            width: "100%", boxSizing: "border-box", padding: "9px 10px",
            borderRadius: 8, border: "1px solid var(--border, #ddd)", fontSize: 14,
          }}
        />
      </div>

      {showLunch && (
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
            {MEAL_SLOT_LABELS.lunch}
          </label>
          <IsraeliTimeSelect
            value={lunchTime}
            onChange={setLunchTime}
            disabled={busy}
            emptyLabel="ללא שעה"
            startHour={12}
            endHour={15}
            stepMinutes={30}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {lunchQuickSlots.map((slot) => (
              <SlotChip
                key={`lunch-${slot}`}
                label={slot}
                selected={lunchTime === slot}
                disabled={busy}
                title="קבע שעת צהריים"
                onClick={() => setLunchTime(slot)}
              />
            ))}
          </div>
        </div>
      )}

      {showDinner && (
        <>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
              {MEAL_SLOT_LABELS.dinner}
            </label>
            <IsraeliTimeSelect
              value={dinnerTime}
              onChange={setDinnerTime}
              disabled={busy}
              emptyLabel="ללא שעה"
              startHour={18}
              endHour={22}
              stepMinutes={30}
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6 }}>
              בחירה מהירה — ערב
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {offerSlots.map((slot) => (
                <SlotChip
                  key={slot}
                  label={slot}
                  selected={dinnerTime === slot}
                  disabled={busy}
                  title="קבע שעת ערב"
                  onClick={() => setDinnerTime(slot)}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {!hasPhone && showDinner && (
        <div style={{
          fontSize: 12, color: "#9A7209", background: "rgba(180,83,9,0.08)",
          padding: "8px 10px", borderRadius: 8, marginBottom: 10,
        }}>
          ⚠️ אין טלפון — אפשר לעדכן שעה בפרופיל, בלי שליחת וואטסאפ
        </div>
      )}

      {hasPhone && showDinner && (
        <div style={{
          marginBottom: 10, padding: "10px 12px", borderRadius: 10,
          background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.2)",
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#4338CA", marginBottom: 8 }}>
            💬 וואטסאפ — בחרו מסלול וערכו את הטקסט לפני שליחה
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {WA_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setWaTab(tab.id)}
                style={{
                  padding: "6px 11px", borderRadius: 20, fontSize: 11.5, fontWeight: 700,
                  border: waTab === tab.id ? "2px solid #4338CA" : "1px solid var(--border)",
                  background: waTab === tab.id ? "rgba(99,102,241,0.12)" : "#fff",
                  color: waTab === tab.id ? "#4338CA" : "var(--text-muted)",
                  cursor: "pointer", fontFamily: "Heebo, sans-serif",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {waTab === "ask" && (
            <>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>שעות להציע באורח:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {offerSlots.map((slot) => (
                  <SlotChip
                    key={`offer-${slot}`}
                    label={slot}
                    selected={offerSlotsSelected.includes(slot)}
                    disabled={busy}
                    title="כלול בהודעה"
                    onClick={() => toggleOfferSlot(slot)}
                  />
                ))}
              </div>
              <MessageTextarea
                label="נוסח השאלה (ניתן לעריכה)"
                value={askText}
                onChange={(v) => { setAskText(v); setAskDirty(true); }}
                onReset={() => { setAskDirty(false); setAskText(regenAsk()); }}
                disabled={busy}
              />
              <button
                type="button"
                onClick={askGuest}
                disabled={busy}
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: 10,
                  border: "1.5px solid #4338CA", background: "#4338CA", color: "#fff",
                  fontWeight: 800, fontSize: 12, cursor: busy ? "not-allowed" : "pointer",
                  fontFamily: "Heebo, sans-serif",
                }}
              >
                {sendingWa ? "שולח…" : "📩 שלח שאלת תיאום"}
              </button>
            </>
          )}

          {waTab === "confirm" && (
            <>
              {!effectiveTime && (
                <div style={{ fontSize: 12, color: "#9A7209", marginBottom: 8 }}>
                  קבעו שעת ערב למעלה — הנוסח יתעדכן אוטומטית
                </div>
              )}
              <MessageTextarea
                label="נוסח אישור (ניתן לעריכה)"
                value={confirmText}
                onChange={(v) => { setConfirmText(v); setConfirmDirty(true); }}
                onReset={() => { setConfirmDirty(false); setConfirmText(regenConfirm()); }}
                disabled={busy}
              />
              <button
                type="button"
                onClick={confirmOnly}
                disabled={busy || !effectiveTime}
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: 10,
                  border: "1px solid var(--border)", background: "#fff",
                  fontWeight: 800, fontSize: 12,
                  cursor: busy || !effectiveTime ? "not-allowed" : "pointer",
                  fontFamily: "Heebo, sans-serif",
                }}
              >
                {sendingWa ? "שולח…" : "📩 שלח אישור (בלי שמירה)"}
              </button>
            </>
          )}

          {waTab === "custom" && (
            <>
              <MessageTextarea
                label="הודעה חופשית (ניתן לעריכה)"
                value={customText}
                onChange={(v) => { setCustomText(v); setCustomDirty(true); }}
                onReset={() => { setCustomDirty(false); setCustomText(regenCustom()); }}
                disabled={busy}
                rows={6}
              />
              <button
                type="button"
                onClick={sendCustom}
                disabled={busy}
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: 10,
                  border: "1px solid var(--border)", background: "#fff",
                  fontWeight: 800, fontSize: 12, cursor: busy ? "not-allowed" : "pointer",
                  fontFamily: "Heebo, sans-serif",
                }}
              >
                {sendingWa ? "שולח…" : "📩 שלח הודעה חופשית"}
              </button>
            </>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty}
          title={!dirty ? "אין שינוי לשמירה" : "שמירה לפרופיל אורח"}
          style={{
            flex: "1 1 120px", padding: "10px 14px", borderRadius: 10, border: "none",
            background: !dirty ? "var(--border, #ddd)" : `linear-gradient(135deg, ${GOLD}, ${GOLD_DARK})`,
            color: !dirty ? "#888" : "#0F0F0F",
            fontWeight: 800, fontSize: 13, cursor: !dirty || busy ? "not-allowed" : "pointer",
            fontFamily: "Heebo, sans-serif", opacity: saving ? 0.7 : 1,
          }}
        >
          {saving && !sendingWa ? "שומר…" : savedFlash ? "✓ נשמר" : "💾 שמור"}
        </button>
        {hasPhone && showDinner && (
          <button
            type="button"
            onClick={saveAndNotify}
            disabled={busy || !String(dinnerTime ?? "").trim()}
            title="שומר שעה בפרופיל + שולח אישור לאורח"
            style={{
              flex: "1 1 160px", padding: "10px 14px", borderRadius: 10, border: "none",
              background: !String(dinnerTime ?? "").trim()
                ? "var(--border, #ddd)"
                : "linear-gradient(135deg, #1A7A4A, #0d5c38)",
              color: !String(dinnerTime ?? "").trim() ? "#888" : "#fff",
              fontWeight: 800, fontSize: 13,
              cursor: busy || !String(dinnerTime ?? "").trim() ? "not-allowed" : "pointer",
              fontFamily: "Heebo, sans-serif",
            }}
          >
            {saving && sendingWa ? "שומר ושולח…" : "💾📩 שמור + הודע לאורח"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function RestaurantDinnerBoard({ user, kioskMode = false, onLogout, onOpenDreamBotChat }) {
  const [boardTab, setBoardTab] = useState("coordination");
  const [mealPeriod, setMealPeriod] = useState("dinner");
  const [dayYmd, setDayYmd] = useState(israelTodayStr());
  const [guests, setGuests] = useState([]);
  const [msgConfig, setMsgConfig] = useState(() => normalizeRestaurantDinnerMessages(null));
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedGuestId, setSelectedGuestId] = useState(null);
  const [toast, setToast] = useState(null);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(() => (
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  ));

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const loadMsgConfig = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const { data } = await supabase
      .from("bot_config")
      .select("config_value")
      .eq("config_key", BOT_CONFIG_RESTAURANT_DINNER_MESSAGES_KEY)
      .maybeSingle();
    let raw = data?.config_value;
    if (typeof raw === "string") {
      try { raw = JSON.parse(raw); } catch { raw = null; }
    }
    setMsgConfig(normalizeRestaurantDinnerMessages(raw));
  }, []);

  useEffect(() => { loadMsgConfig(); }, [loadMsgConfig]);

  const fetchGuests = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("guests")
      .select(
        "id, name, phone, room, room_type, status, arrival_date, departure_date, meal_plan, " +
        "breakfast_time, lunch_time, dinner_time, meal_time, meal_location, guest_profile",
      )
      .neq("status", "cancelled")
      .lte("arrival_date", dayYmd)
      .or(`departure_date.is.null,departure_date.gte.${dayYmd}`);

    if (error) {
      showToast("err", "שגיאה בטעינה: " + error.message);
      setGuests([]);
    } else {
      setGuests(sortRestaurantDinnerGuests(filterRestaurantDinnerGuests(data ?? [], dayYmd)));
    }
    setLoading(false);
  }, [dayYmd, showToast]);

  useEffect(() => { fetchGuests(); }, [fetchGuests]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const ch = supabase
      .channel("restaurant-dinner-guests")
      .on("postgres_changes", { event: "*", schema: "public", table: "guests" }, () => {
        fetchGuests();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchGuests]);

  const openGuestChat = useCallback((guest) => {
    const phone = String(guest?.phone ?? "").trim();
    if (!phone) return;
    if (onOpenDreamBotChat) {
      onOpenDreamBotChat({ phone, guestName: guest.name });
      return;
    }
    setSelectedGuestId(guest.id);
  }, [onOpenDreamBotChat]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return guests.filter((g) => {
      if (filter === "suites" && !isSuiteGuestProfile(g)) return false;
      if (filter === "needs_time" && !guestNeedsMealCoordination(g)) return false;
      if (filter === "has_time" && guestNeedsMealCoordination(g)) return false;
      if (!q) return true;
      const hay = `${g.name ?? ""} ${g.room ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [guests, search, filter]);

  const selectedGuest = useMemo(
    () => filtered.find((g) => g.id === selectedGuestId) ?? filtered[0] ?? null,
    [filtered, selectedGuestId],
  );

  useEffect(() => {
    if (!filtered.length) {
      setSelectedGuestId(null);
      return;
    }
    if (!selectedGuestId || !filtered.some((g) => g.id === selectedGuestId)) {
      setSelectedGuestId(filtered[0].id);
    }
  }, [filtered, selectedGuestId]);

  const suiteCount = guests.filter((g) => isSuiteGuestProfile(g)).length;

  const withTime = guests.filter((g) => !guestNeedsMealCoordination(g)).length;
  const withoutTime = guests.length - withTime;

  const shellStyle = kioskMode
    ? { minHeight: "100vh", background: "var(--ivory, #F5F0E8)", padding: "16px 14px 32px" }
    : { padding: "0 4px 24px" };

  const showMenuAdmin = canManageRestaurantMenu(user);

  const BOARD_TABS = [
    { id: "coordination", label: "🕐 תיאום שעות" },
    { id: "order", label: "🍽️ הזמנה" },
    { id: "active", label: "📋 הזמנות פעילות" },
  ];

  return (
    <div style={shellStyle}>
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 9999, padding: "12px 24px", borderRadius: 10, fontWeight: 700, fontSize: 13,
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color: toast.type === "ok" ? "#1A7A4A" : "#C0392B",
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
        }}>
          {toast.msg}
        </div>
      )}

      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        gap: 12, flexWrap: "wrap", marginBottom: 16,
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: kioskMode ? 22 : 20, fontWeight: 800, color: "#9A7209" }}>
            🍽️ לוח מסעדה
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-muted, #666)", lineHeight: 1.5 }}>
            תיאום צהריים וערב בפרופיל האורח — מסתנכרן לפורטל והבוט. אפשר גם לשאול בוואטסאפ.
          </p>
        </div>
        {kioskMode && onLogout && (
          <button
            type="button"
            onClick={onLogout}
            style={{
              border: "1px solid var(--border)", borderRadius: 8, padding: "8px 14px",
              background: "#fff", cursor: "pointer", fontFamily: "Heebo, sans-serif", fontWeight: 700,
            }}
          >
            יציאה
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {BOARD_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setBoardTab(tab.id)}
            style={{
              padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 800,
              border: boardTab === tab.id ? `2px solid ${GOLD_DARK}` : "1px solid var(--border)",
              background: boardTab === tab.id ? "rgba(201,169,110,0.2)" : "#fff",
              cursor: "pointer", fontFamily: "Heebo, sans-serif",
            }}
          >
            {tab.label}
          </button>
        ))}
        {(boardTab === "order" || boardTab === "coordination") && (
          <div style={{ display: "flex", gap: 6, marginRight: "auto" }}>
            {[
              ["lunch", "🌞 צהריים"],
              ["dinner", "🌙 ערב"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMealPeriod(id)}
                style={{
                  padding: "8px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                  border: mealPeriod === id ? `2px solid ${GOLD_DARK}` : "1px solid var(--border)",
                  background: mealPeriod === id ? "rgba(201,169,110,0.18)" : "#fff",
                  cursor: "pointer", fontFamily: "Heebo, sans-serif",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {showMenuAdmin && boardTab !== "active" && (
        <RestaurantMenuAdminPanel user={user} onToast={showToast} />
      )}

      {boardTab === "order" && (
        <RestaurantOrderPanel
          guests={guests}
          mealPeriod={mealPeriod}
          onToast={showToast}
        />
      )}

      {boardTab === "active" && (
        <RestaurantActiveOrdersPanel dayYmd={dayYmd} onToast={showToast} />
      )}

      {boardTab === "coordination" && (
      <>
      <RestaurantDinnerTemplatesPanel
        config={msgConfig}
        onChange={setMsgConfig}
        onSaved={(msg) => showToast("ok", msg)}
        onError={(msg) => showToast("err", msg)}
      />

      <div style={{
        display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14,
      }}>
        <input
          type="date"
          value={dayYmd}
          onChange={(e) => setDayYmd(e.target.value)}
          style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border, #ddd)" }}
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש שם / חדר…"
          style={{
            flex: "1 1 160px", minWidth: 140, padding: "8px 12px", borderRadius: 8,
            border: "1px solid var(--border, #ddd)",
          }}
        />
        {[
          ["all", `הכל (${guests.length})`],
          ["suites", `סוויטות (${suiteCount})`],
          ["needs_time", `חסרה שעה (${withoutTime})`],
          ["has_time", `עם שעה (${withTime})`],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            style={{
              padding: "7px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700,
              border: filter === id ? `2px solid ${GOLD_DARK}` : "1px solid var(--border, #ddd)",
              background: filter === id ? "rgba(201,169,110,0.18)" : "#fff",
              cursor: "pointer", fontFamily: "Heebo, sans-serif",
            }}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setWalkInOpen(true)}
          style={{
            padding: "7px 12px", borderRadius: 8, border: "none",
            background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DARK})`,
            color: "#0F0F0F", cursor: "pointer", fontFamily: "Heebo, sans-serif", fontWeight: 800,
          }}
        >
          + אורח ידני
        </button>
        <button
          type="button"
          onClick={fetchGuests}
          style={{
            padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)",
            background: "#fff", cursor: "pointer", fontFamily: "Heebo, sans-serif", fontWeight: 700,
          }}
        >
          🔄 רענון
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>טוען אורחים…</div>
      ) : filtered.length === 0 ? (
        <div style={{
          textAlign: "center", padding: 36, border: "1px dashed var(--border)",
          borderRadius: 12, color: "var(--text-muted)", fontSize: 14,
        }}>
          {guests.length === 0
            ? "אין אורחי סוויטות/פנסיון לתיאום ליום זה. הוסיפו אורח ידני או בדקו תאריך אחר."
            : "אין תוצאות לפילטר / חיפוש."}
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: isNarrow ? "1fr" : "minmax(240px, 320px) 1fr",
          gap: 14,
          alignItems: "start",
        }}>
          <div style={{
            position: isNarrow ? "static" : "sticky",
            top: 8,
            maxHeight: isNarrow ? "none" : "calc(100vh - 200px)",
            overflowY: isNarrow ? "visible" : "auto",
            paddingLeft: 2,
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", marginBottom: 8 }}>
              {filtered.length} אורחים · לחיצה על שם = צ׳אט לתיאום
            </div>
            {filtered.map((g) => (
              <GuestListRow
                key={g.id}
                guest={g}
                selected={selectedGuest?.id === g.id}
                onSelect={(row) => setSelectedGuestId(row.id)}
                onOpenChat={openGuestChat}
              />
            ))}
          </div>
          <div style={{ minWidth: 0 }}>
            {selectedGuest ? (
              <GuestDinnerRow
                key={selectedGuest.id}
                guest={selectedGuest}
                user={user}
                msgConfig={msgConfig}
                onOpenChat={openGuestChat}
                onSaved={(updated) => {
                  setGuests((prev) => prev.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)));
                }}
                onError={(msg) => showToast("err", msg)}
                onNotify={(msg) => showToast("ok", msg)}
              />
            ) : null}
          </div>
        </div>
      )}

      </>
      )}

      {walkInOpen && (
        <RestaurantWalkInModal
          dayYmd={dayYmd}
          onClose={() => setWalkInOpen(false)}
          onSaved={(row) => {
            setGuests((prev) => sortRestaurantDinnerGuests([...prev, row]));
            showToast("ok", `${row.name} נוסף ללוח`);
          }}
          onError={(msg) => showToast("err", msg)}
        />
      )}
    </div>
  );
}
