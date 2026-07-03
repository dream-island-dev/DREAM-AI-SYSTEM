// src/components/WhatsAppInbox.js
// Dream Island — WhatsApp Conversation Inbox
// Two-panel UI: contact list (right) + message thread (left, RTL)
// Real-time updates via Supabase Realtime

import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import AddGuestModal from "./AddGuestModal";
import GuestContextDrawer from "./GuestContextDrawer";
import AILearningButton from "./AILearningButton";
import HoldToConfirmButton from "./HoldToConfirmButton";
import QuietHoursGate from "./QuietHoursGate";
import { getSuiteSection } from "../data/suiteRegistry";
import { classifyInboundMessageAlert } from "../utils/guestTiming";
import { resolveEffectiveGuestStatus } from "../utils/guestCheckinMatrix";
import {
  unlockInboxAlertAudio,
  playSuiteGuestAlert,
  playOffResortGuestAlert,
} from "../utils/inboxAlertSounds";
import { useQuietHoursSend } from "../hooks/useQuietHoursSend";

// In-resort roster chrome — only guests with guests.status = checked_in (strict).
const IN_RESORT_ROSTER = {
  rowBg: "var(--status-purple-bg, #F3F0FF)",
  rowBgActive: "var(--status-purple-bg, #F3F0FF)",
  name: "var(--status-purple, #5B21B6)",
  avatar: "var(--status-purple, #5B21B6)",
  border: "var(--status-purple, #5B21B6)",
};
const HIT_STAFF = "var(--hit-target-staff, 44px)";
const HIT_COMFORT = "var(--hit-target-comfort, 48px)";

const POLL_MS = 5000; // fallback polling interval (realtime is primary) — 5s safe minimum

// ── Performance tuning (Sprint: Inbox render/fetch speed) ────────────────────
// INITIAL_FETCH_LIMIT bounds the first paint to a recent-activity window
// instead of the whole table — see fetchAll() below for why the previous
// ascending+limit(2000) query was actually fetching the OLDEST 2000 rows,
// not the newest, once total row count passed 2000.
const INITIAL_FETCH_LIMIT  = 400;  // recent-window rows for fast first paint
const OLDER_BATCH_LIMIT    = 400;  // additional rows per "load older" click
const THREAD_HISTORY_LIMIT = 1500; // full-history cap for a single opened contact

// Columns actually consumed downstream (normalise()/groupByPhone()) — guest_notes
// used to be selected on every message row but was never read past normalise(),
// pure dead payload multiplied across every row in every fetch.
const CONVERSATION_SELECT =
  "id, phone, direction, message, wa_message_id, created_at, intent, human_requested, human_request_type, push_name, " +
  "guests(id, name, spa_time, room, room_type, status, arrival_date, departure_date, portal_token, meal_time, meal_location, claimed_by, claimed_at)";

// Module-level (outside the component) — survives WhatsAppInbox unmount/remount
// within the same tab session. App.js has no router (see CLAUDE.md §4): switching
// pages unmounts this component entirely, so without this every tab-away/back
// re-ran fetchAll() from scratch. Intentionally memory-only (no localStorage) —
// cleared on a hard refresh so stale guest data never survives a reload.
const inboxMemoryCache = {
  messages: null,        // flat allMsgsRef equivalent
  lastSeenAt: null,
  oldestSeenAt: null,
  hasMoreOlder: false,
  hydratedPhones: null,  // array (Set serialized) of phones with full history loaded
};

function substituteTemplateVars(bodyText, varValues) {
  if (!bodyText) return "";
  let text = bodyText;
  (varValues ?? []).forEach((v, i) => {
    text = text.replace(new RegExp(`\\{\\{\\s*${i + 1}\\s*\\}\\}`, "g"), v || `{{${i + 1}}}`);
  });
  return text;
}

/** Mirror whatsapp-send resolveDayTimings — weekday vs Shabbat entry/check-in display. */
function resolveDayTimings(arrivalDateStr) {
  if (!arrivalDateStr) return { entryTime: "12:00", checkInTime: "15:00" };
  const d = new Date(`${arrivalDateStr}T00:00:00Z`);
  return d.getUTCDay() === 6
    ? { entryTime: "15:00", checkInTime: "18:00" }
    : { entryTime: "12:00", checkInTime: "15:00" };
}

function buildGuestResolveContext(contact) {
  if (!contact) return {};
  const guestName = contact.guestName || contact.pushName || "אורח";
  const room = contact.room || "-";
  const origin = typeof window !== "undefined" ? window.location.origin : "https://dream-ai-system.vercel.app";
  const portalUrl = contact.portalToken ? `${origin}/portal/${contact.portalToken}` : "";
  const { entryTime, checkInTime } = resolveDayTimings(contact.arrivalDate || "");
  return { guestName, room, portalUrl, entryTime, checkInTime, spaTime: contact.spaTime || "" };
}

function expandScriptForDisplay(body, ctx = {}) {
  if (!body) return "";
  const name = ctx.guestName || "אורח";
  const room = ctx.room || "-";
  let text = body
    .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, name)
    .replace(/\{\{\s*guest_name\s*\}\}/gi, name)
    .replace(/\{\{\s*entry_time\s*\}\}/gi, ctx.entryTime ?? "")
    .replace(/\{\{\s*check_in_time\s*\}\}/gi, ctx.checkInTime ?? "")
    .replace(/\{\{\s*portal_url\s*\}\}/gi, ctx.portalUrl ?? "")
    .replace(/\{\{\s*ROOM_NAME\s*\}\}/gi, room)
    .replace(/\{\{\s*SUITE_NAME\s*\}\}/gi, room)
    .replace(/\{\{\s*room\s*\}\}/gi, room);
  if (ctx.spaTime) {
    text = text
      .replace(/\{\{\s*SPA_LINE\s*\}\}/gi, `🕐 הטיפול שלך בספא: ${ctx.spaTime}`)
      .replace(/\{\{\s*OPTIONAL_SPA_TEXT\s*\}\}/gi, ` הטיפול שלך בספא מוזמן לשעה ${ctx.spaTime}.`)
      .replace(/\{\{\s*SPA_TIME\s*\}\}/gi, ctx.spaTime);
  } else {
    text = text
      .replace(/\{\{\s*SPA_LINE\s*\}\}/gi, "")
      .replace(/\{\{\s*OPTIONAL_SPA_TEXT\s*\}\}/gi, "")
      .replace(/\{\{\s*SPA_TIME\s*\}\}/gi, "");
  }
  return text.replace(/\{\{[^}]+\}\}/g, "").trim();
}

const LEGACY_SCRIPT_TAG_RE = /^\[סקריפט:\s*(.+?)\]$/;
const LEGACY_TEMPLATE_TAG_RE = /^\[תבנית:\s*(.+?)\]$/;
const DISPATCH_META_PREFIX = /^\[META\]\n?/;
const DISPATCH_SESSION_PREFIX = /^\[SESSION\]\n?/;
const INTERACTIVE_BUTTONS_SUFFIX = /\n?\[\+\s*Interactive Buttons(?::\s*([^\]]+))?\]\s*$/;

const LEGACY_BRACKET_SCRIPT_KEYS = {
  "בוקר הגעה: חופשי": "stage_3_morning",
  "בוקר יום-כיף: חופשי": "morning_daypass",
  "חדר מוכן: חופשי": "room_ready_reminder",
};

/** Strip whatsapp-send dispatch tags — [META]/[SESSION] + interactive-button footer. */
function parseOutboundDispatch(raw) {
  if (!raw || typeof raw !== "string") {
    return { channel: null, body: raw ?? "", hasInteractiveButtons: false, buttonLabels: null };
  }
  let body = raw;
  let channel = null;
  if (DISPATCH_META_PREFIX.test(body)) {
    channel = "meta";
    body = body.replace(DISPATCH_META_PREFIX, "");
  } else if (DISPATCH_SESSION_PREFIX.test(body)) {
    channel = "session";
    body = body.replace(DISPATCH_SESSION_PREFIX, "");
  }
  let buttonLabels = null;
  let hasInteractiveButtons = false;
  const btnMatch = body.match(INTERACTIVE_BUTTONS_SUFFIX);
  if (btnMatch) {
    hasInteractiveButtons = true;
    buttonLabels = btnMatch[1]?.trim() || null;
    body = body.replace(INTERACTIVE_BUTTONS_SUFFIX, "").trimEnd();
  }
  return { channel, body, hasInteractiveButtons, buttonLabels };
}

/** Resolve legacy `[סקריפט:…]` / `[תבנית:…]` inbox rows to human-readable text. */
function resolveInboxMessageText(raw, resolveCtx) {
  if (!raw) return "";
  const { body: strippedBody } = parseOutboundDispatch(raw);
  const text = strippedBody ?? raw;
  const ctx = resolveCtx || {};
  const scriptTag = text.match(LEGACY_SCRIPT_TAG_RE);
  if (scriptTag) {
    const body = resolveCtx?.scriptsByKey?.get(scriptTag[1]);
    if (body) return expandScriptForDisplay(body, ctx);
    return text;
  }
  const tmplTag = text.match(LEGACY_TEMPLATE_TAG_RE);
  if (tmplTag) {
    const body = resolveCtx?.templatesByWaName?.get(tmplTag[1]);
    if (body) {
      const vars = [ctx.guestName || "אורח יקר", ctx.room || "-"].filter(Boolean);
      return substituteTemplateVars(body, vars);
    }
    return text;
  }
  const bracket = text.match(/^\[(.+)\]$/);
  if (bracket) {
    const sk = LEGACY_BRACKET_SCRIPT_KEYS[bracket[1]];
    if (sk) {
      const body = resolveCtx?.scriptsByKey?.get(sk);
      if (body) return expandScriptForDisplay(body, ctx);
    }
  }
  return expandScriptForDisplay(text, ctx);
}

// ── Responsive hook — same convention as UserManagement.js's useIsMobile:
// JS-based breakpoint detection (resize listener), not injected CSS media
// queries, so layout-mode branching can live directly in render logic. ──────
function useIsMobile(breakpoint = 768) {
  const [mobile, setMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false
  );
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < breakpoint);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, [breakpoint]);
  return mobile;
}

// ── i18n — UI chrome only (toolbar, labels, badges, placeholders). Message
// content itself is never translated — guests write in Hebrew regardless of
// which language the operator is viewing the inbox in. NewChatModal keeps its
// existing Hebrew-only UI for now — localizing its template/bulk-send flows
// is a separate, larger pass. ────────────────────────────────────────────────
const T = {
  he: {
    dir: "rtl",
    brand: "💬 DREAM BOT — תיבת שיחות",
    live: "LIVE", connecting: "מתחבר...",
    newChat: "✉️ חדש", botOn: "🤖 בוט פעיל", botOff: "😴 בוט כבוי",
    newMsgs: (n) => `${n} חדשות`,
    listCount: (n) => `${n} הודעות`,
    syncing: "⏳ מסנכרן...",
    emptyIcon: "📭", emptyBody: "אין שיחות עדיין",
    pickChat: "בחר שיחה כדי לצפות בה",
    back: "חזרה לרשימה",
    aiLog: "🧠 יומן AI",
    aiLogEmpty: "אין רישומי סיווג בשיחה הזו",
    aiLogHint: "פנימי — לא מוצג לאורח",
    quickBolt: "⚡",
    quickRepliesTitle: "תגובות מהירות",
    routeTitle: "ניתוב משימה לתפעול",
    routeMaint: "🔧 תחזוקה", routeHouse: "🛏️ משק בית",
    inputPh: "כתוב הודעה ידנית... (Enter לשליחה)",
    archive: "ארכיון", resolve: "טופל",
    identityDb: "תואם מהמערכת", identityWa: "פרופיל WhatsApp", identityPhone: "מספר בלבד",
    spa: "ספא",
    msgsCount: (n) => `${n} הודעות`,
    langSwap: "EN",
    editGuest: "✏️ ערוך פרטי אורח",
    contextualMacrosTitle: "✨ הצעות לפי פרטי האורח",
    claimChat: "🙋 קח שיחה (השתק בוט)",
    claimedByMe: "✓ בטיפולך · בוט מושתק",
    takeOver: "🔁 העבר אליי (השתק בוט)",
    release: "שחרר שיחה (הפעל בוט)",
    claimedBadge: (name) => `🔒 בטיפול: ${name}`,
    aiSuggestTitle: "✨ הצעות AI חכמות",
    aiSuggestButton: "✨ הצעות AI חכמות",
    aiSuggestLoading: "⏳ חושב/ת...",
    aiSuggestRetry: "🔄 הצעות נוספות",
    aiSuggestErrorPrefix: "⚠️",
    routeSubtitle: "בחר/י קטגוריה ו/או תאר/י את הבקשה",
    routeNotePlaceholder: "פרטים נוספים (אופציונלי)...",
    routeDispatch: "🚀 שלח משימה",
    routeCancel: "ביטול",
    routeBack: "← חזרה",
    dismissAllAlerts: "ניקוי כל ההתראות",
    dismissAllConfirm: "האם אתה בטוח שברצונך לאפס את כל התראות הקבלה?",
    dismissAllDone: (n) => `✓ אופסו ${n} התראות`,
    dismissAllNone: "אין התראות פעילות ברשימה",
    loadOlder: "טען שיחות ישנות יותר ⬇",
    loadOlderBusy: "⏳ טוען שיחות ישנות…",
  },
  en: {
    dir: "ltr",
    brand: "💬 DREAM BOT — Inbox",
    live: "LIVE", connecting: "Connecting...",
    newChat: "✉️ New", botOn: "🤖 Bot on", botOff: "😴 Bot off",
    newMsgs: (n) => `${n} new`,
    listCount: (n) => `${n} chats`,
    syncing: "⏳ Syncing...",
    emptyIcon: "📭", emptyBody: "No conversations yet",
    pickChat: "Select a conversation to view it",
    back: "Back to list",
    aiLog: "🧠 AI log",
    aiLogEmpty: "No classification events in this thread",
    aiLogHint: "Internal — never shown to the guest",
    quickBolt: "⚡",
    quickRepliesTitle: "Quick replies",
    routeTitle: "Route task to operations",
    routeMaint: "🔧 Maintenance", routeHouse: "🛏️ Housekeeping",
    inputPh: "Type a manual message... (Enter to send)",
    archive: "Archive", resolve: "Resolved",
    identityDb: "Matched in system", identityWa: "WhatsApp profile", identityPhone: "Phone only",
    spa: "Spa",
    msgsCount: (n) => `${n} messages`,
    langSwap: "HE",
    editGuest: "✏️ Edit guest",
    contextualMacrosTitle: "✨ Suggested for this guest",
    claimChat: "🙋 Claim chat (mute bot)",
    claimedByMe: "✓ Yours · bot muted",
    takeOver: "🔁 Take over (mute bot)",
    release: "Release chat (unmute bot)",
    claimedBadge: (name) => `🔒 Handling: ${name}`,
    aiSuggestTitle: "✨ Smart AI Suggestions",
    aiSuggestButton: "✨ Smart AI Suggestions",
    aiSuggestLoading: "⏳ Thinking...",
    aiSuggestRetry: "🔄 More suggestions",
    aiSuggestErrorPrefix: "⚠️",
    routeSubtitle: "Pick a category and/or describe the request",
    routeNotePlaceholder: "Additional details (optional)...",
    routeDispatch: "🚀 Dispatch task",
    routeCancel: "Cancel",
    routeBack: "← Back",
    dismissAllAlerts: "Clear all alerts",
    dismissAllConfirm: "Clear all reception alerts in the current list?",
    dismissAllDone: (n) => `✓ Cleared ${n} alert(s)`,
    dismissAllNone: "No active alerts in list",
    loadOlder: "Load older conversations ⬇",
    loadOlderBusy: "⏳ Loading older…",
  },
};

// ── Task-routing sub-categories (Sprint 2 — Smart Task Routing) ──────────────
// Replaces the old single-click "blast whatever the guest's last message
// was" behavior — staff now picks a real category (and/or free text for edge
// cases) before a task is dispatched, so OperationsBoard tickets are properly
// defined instead of a raw guest message guess.
const TASK_SUBCATEGORIES = {
  maintenance: [
    { id: "ac",       label: "❄️ מזגן" },
    { id: "lights",   label: "💡 תאורה" },
    { id: "plumbing", label: "🚰 אינסטלציה" },
  ],
  housekeeping: [
    { id: "towels",      label: "🧺 מגבות" },
    { id: "room_makeup", label: "🛏️ סידור חדר" },
    { id: "amenities",   label: "🧴 שירותי נוחות" },
  ],
};

// Per-message `intent` (already written by whatsapp-webhook on every inbound
// row) is the real, already-stored signal behind the AI log drawer — no new
// logging table, no fabricated data.
const INTENT_LABELS = {
  he: {
    faq: "שאלה כללית (FAQ)", fallback: "לא סווג / fallback",
    button_reply: "לחיצת כפתור", confirmation: "אישור הגעה (טקסט)",
    date_change_request: "בקשת שינוי תאריך", human_handoff: "הועבר לטיפול אנושי",
  },
  en: {
    faq: "General question (FAQ)", fallback: "Unclassified / fallback",
    button_reply: "Button tap", confirmation: "Arrival confirmation (typed)",
    date_change_request: "Date-change request", human_handoff: "Handed off to staff",
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
}

// Canonicalize any phone format (+972506842439, 972506842439, local
// 0506842439) to the bare 972XXXXXXXXX form Meta's webhook already sends
// natively — without this, the same guest can split into two threads
// depending on which write path produced the row (webhook vs guests.phone
// vs a locally-formatted number). This is the DIALABLE form — used as the
// contact key, the wa.me link, and the `phone` sent to whatsapp-send — so it
// must stay a full country-code-prefixed number, never just a comparison key.
function canonicalizePhone(raw) {
  if (!raw) return raw;
  let p = String(raw).replace(/\D/g, ""); // digits only — strips +, spaces, dashes
  if (p.startsWith("0")) p = "972" + p.slice(1); // local 05XXXXXXXX → 9725XXXXXXXX
  return p;
}

// Comparison-only helper — NOT a replacement for canonicalizePhone() above and
// never used to build a dialable number. Strips every non-digit and keeps
// only the last 9 — the invariant core of an Israeli mobile number regardless
// of country/dialing-prefix noise (+972, 972, 0, 00972) or manual-entry
// separators (spaces, dashes). Used to match a guests.phone value (stored in
// whatever format it was typed/imported in) against a WhatsApp-derived phone.
function normalizePhone(phoneStr) {
  if (!phoneStr) return "";
  return String(phoneStr).replace(/\D/g, "").slice(-9);
}

// Every variant a guests.phone/whatsapp_conversations.phone value might be
// stored in (E.164 "+972...", bare "972...", local "0...") — shared by every
// write path below (claim/release/dismiss/editor fetch) since neither table
// guarantees one canonical format (session 15 root cause, see CLAUDE.md §6).
function phoneVariants(bare) {
  return [bare, `+${bare}`, `0${bare.slice(3)}`];
}

function groupByPhone(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.phone)) {
      map.set(row.phone, {
        phone: row.phone,
        guestId: row.guest_id ?? null,
        guestName: row.guest_name,
        spaTime: row.spa_time ?? null,
        room: row.guest_room ?? null,
        roomType: row.guest_room_type ?? null,
        status: row.guest_status ?? null,
        departureDate: row.guest_departure_date ?? null,
        arrivalDate: row.guest_arrival_date ?? null,
        portalToken: row.guest_portal_token ?? null,
        mealTime: row.guest_meal_time ?? null,
        mealLocation: row.guest_meal_location ?? null,
        claimedBy: row.guest_claimed_by ?? null,
        claimedAt: row.guest_claimed_at ?? null,
        pushName: row.push_name ?? null,
        messages: [],
        humanRequested: false,
        humanRequestType: null,
      });
    }
    const contact = map.get(row.phone);
    contact.messages.push(row);
    if (row.guest_id != null) contact.guestId = row.guest_id;
    if (row.spa_time) contact.spaTime = row.spa_time;
    if (row.guest_room) contact.room = row.guest_room;
    if (row.guest_room_type) contact.roomType = row.guest_room_type;
    if (row.guest_status) contact.status = row.guest_status;
    if (row.guest_departure_date) contact.departureDate = row.guest_departure_date;
    if (row.guest_arrival_date) contact.arrivalDate = row.guest_arrival_date;
    if (row.guest_portal_token) contact.portalToken = row.guest_portal_token;
    if (row.guest_meal_time) contact.mealTime = row.guest_meal_time;
    if (row.guest_meal_location) contact.mealLocation = row.guest_meal_location;
    // claimed_by lives on guests — only overwrite when the join carried a value.
    // New inbound rows sometimes arrive before guest_id is patched on the
    // conversation row, which would null the join and falsely "release" claim.
    if (row.guest_claimed_by != null) {
      contact.claimedBy = row.guest_claimed_by;
      contact.claimedAt = row.guest_claimed_at ?? null;
    }
    if (row.push_name) contact.pushName = row.push_name;
    // Flag contact if any inbound message is a human request
    if (row.human_requested && row.direction === "inbound") {
      contact.humanRequested = true;
      if (row.human_request_type && !contact.humanRequestType) {
        contact.humanRequestType = row.human_request_type;
      }
    }
  }
  // Human-requested contacts first, then by latest message desc
  return [...map.values()].sort((a, b) => {
    if (a.humanRequested !== b.humanRequested) return a.humanRequested ? -1 : 1;
    const aLast = a.messages[a.messages.length - 1]?.created_at ?? "";
    const bLast = b.messages[b.messages.length - 1]?.created_at ?? "";
    return bLast.localeCompare(aLast);
  });
}

// ── Identity resolution (Smart Guest Identity) ───────────────────────────────
// Precedence: DB-matched guest name > WhatsApp profile push name > raw phone.
function displayName(contact) {
  return contact.guestName ?? contact.pushName ?? contact.phone;
}
function identityMeta(contact, t) {
  if (contact.guestName) return { kind: "db",    label: t.identityDb,    bg: "var(--status-success-bg)", fg: "var(--status-success)" };
  if (contact.pushName)  return { kind: "wa",    label: t.identityWa,    bg: "var(--status-warning-bg)", fg: "var(--status-warning)" };
  return                         { kind: "phone", label: t.identityPhone, bg: "var(--ivory)", fg: "var(--black-soft)" };
}
// "Recently active" is a presence proxy derived from the last inbound message
// timestamp — WhatsApp's webhook never reports true online/offline presence.
function recentlyActive(contact) {
  const last = contact.messages[contact.messages.length - 1];
  if (!last?.created_at) return false;
  return Date.now() - new Date(last.created_at).getTime() < 15 * 60 * 1000;
}

// ── Roster room/suite chip — reuses suiteRegistry's SUITE_SECTIONS (the same
// registry AddGuestModal's room dropdown and RoomBoard already key off of) so
// the inbox roster never invents its own room→icon/color mapping. "Premium
// Day 1/2" aren't in SUITE_REGISTRY (they're the two day-guest packages, not
// physical suites — see suiteRegistry.js's header comment), so they're
// special-cased before falling through to getSuiteSection(); room_type is
// the last fallback for a day-guest with no room value set at all.
function roomChipMeta(contact) {
  if (contact.room === "Premium Day 1") return { icon: "☀️", label: "בילוי יומי 1", color: "var(--status-warning)" };
  if (contact.room === "Premium Day 2") return { icon: "☀️", label: "בילוי יומי 2", color: "var(--status-warning)" };
  if (contact.room) {
    const sec = getSuiteSection(contact.room);
    if (sec) return { icon: sec.icon, label: contact.room, color: sec.color };
  }
  if (contact.roomType === "day_guest") return { icon: "☀️", label: "בילוי יומי", color: "var(--status-warning)" };
  if (contact.roomType === "premium_day_guest") return { icon: "⭐", label: "פרימיום יומי", color: "var(--status-warning)" };
  return null;
}

// ── Contact list item ────────────────────────────────────────────────────────
// Swipe-to-reveal (mobile only): pointer-drag past a 48px threshold reveals
// Archive / Resolved actions behind the row, mirroring the approved mockup.
// Works with touch AND mouse (pointer events), so no gesture library needed.
// Custom equality for React.memo below — groupByPhone() rebuilds a fresh
// `contact` object (and a fresh `messages` array) on every regroup regardless
// of whether THIS contact's data actually changed, so a plain reference
// comparison would never let memo bail out. This compares the fields the row
// actually renders instead, so a new message for guest A doesn't force a
// re-render of every other row in the roster.
function contactItemPropsEqual(prev, next) {
  if (prev.isActive !== next.isActive) return false;
  if (prev.isMobile !== next.isMobile) return false;
  if (prev.t !== next.t) return false;
  if (prev.dir !== next.dir) return false;
  if (prev.scriptsByKey !== next.scriptsByKey) return false;
  if (prev.templatesByWaName !== next.templatesByWaName) return false;
  if (prev.onClick !== next.onClick) return false;
  if (prev.onDismiss !== next.onDismiss) return false;
  if (prev.onArchive !== next.onArchive) return false;
  if (prev.onProfileClick !== next.onProfileClick) return false;
  const a = prev.contact, b = next.contact;
  if (a === b) return true;
  if (a.phone !== b.phone) return false;
  if (a.guestName !== b.guestName) return false;
  if (a.pushName !== b.pushName) return false;
  if (a.status !== b.status) return false;
  if (a.room !== b.room) return false;
  if (a.roomType !== b.roomType) return false;
  if (a.arrivalDate !== b.arrivalDate) return false;
  if (a.departureDate !== b.departureDate) return false;
  if (a.claimedBy !== b.claimedBy) return false;
  if (a.claimedByName !== b.claimedByName) return false;
  if (a.humanRequested !== b.humanRequested) return false;
  if (a.humanRequestType !== b.humanRequestType) return false;
  if (a.messages.length !== b.messages.length) return false;
  const aLast = a.messages[a.messages.length - 1];
  const bLast = b.messages[b.messages.length - 1];
  if (aLast?.id !== bLast?.id) return false;
  // Unread count can change (openContact marks earlier inbound rows read)
  // without touching array length or the last message id — check directly.
  let aUnread = 0, bUnread = 0;
  for (const m of a.messages) if (m.direction === "inbound" && !m._read) aUnread++;
  for (const m of b.messages) if (m.direction === "inbound" && !m._read) bUnread++;
  return aUnread === bUnread;
}

const ContactItem = React.memo(function ContactItem({ contact, isActive, isMobile, t, dir, onClick, onProfileClick, onDismiss, onArchive, scriptsByKey, templatesByWaName }) {
  const last  = contact.messages[contact.messages.length - 1];
  const unread = contact.messages.filter(
    (m) => m.direction === "inbound" && !m._read
  ).length;

  const waPhone = contact.phone.replace(/^\+/, "");
  const humanLabel = contact.humanRequestType === "call"
    ? "🔴 מבקש שיחת טלפון"
    : "🔴 מבקש מענה אנושי";
  const identity = identityMeta(contact, t);
  const roomChip = roomChipMeta(contact);
  const active   = recentlyActive(contact);
  const inResort =
    resolveEffectiveGuestStatus({
      status: contact.status,
      arrival_date: contact.arrivalDate,
      departure_date: contact.departureDate,
    }) === "checked_in";
  const resolveCtx = { ...buildGuestResolveContext(contact), scriptsByKey, templatesByWaName };

  const [swiped, setSwiped] = useState(false);
  const dragRef = useRef({ startX: 0, dragging: false });
  const ACTIONS_W = 144;
  const rtl = dir === "rtl";

  function onPointerDown(e) {
    if (!isMobile) return;
    dragRef.current = { startX: e.clientX, dragging: true };
    const onMove = (ev) => {
      if (!dragRef.current.dragging) return;
      const dx = ev.clientX - dragRef.current.startX;
      if (Math.abs(dx) > 48) {
        setSwiped(rtl ? dx < 0 : dx > 0);
        cleanup();
      }
    };
    const cleanup = () => {
      dragRef.current.dragging = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", cleanup);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", cleanup);
  }

  return (
    <div style={{ position: "relative", overflow: "hidden" }}>
      {isMobile && (
        <div style={{
          position: "absolute", [rtl ? "left" : "right"]: 0, top: 0, bottom: 0,
          width: ACTIONS_W, display: "flex",
        }}>
          <button
            onClick={(e) => { e.stopPropagation(); setSwiped(false); onArchive?.(contact.phone); }}
            className="u-touch-comfort"
            style={{ flex: 1, border: "none", background: "var(--text-muted)", color: "white", fontSize: 12, fontWeight: 700 }}
          >{t.archive}</button>
          <button
            onClick={(e) => { e.stopPropagation(); setSwiped(false); onDismiss?.(contact); }}
            className="u-touch-comfort"
            style={{ flex: 1, border: "none", background: "var(--status-success)", color: "white", fontSize: 12, fontWeight: 700 }}
          >{t.resolve}</button>
        </div>
      )}
      <div
        onClick={() => { if (swiped) { setSwiped(false); return; } onClick(contact.phone); }}
        onPointerDown={onPointerDown}
        style={{
          padding: "var(--space-sm) var(--space-md)",
          minHeight: isMobile ? HIT_COMFORT : "auto",
          cursor: "pointer",
          borderBottom: "1px solid var(--border)",
          background: contact.humanRequested
            ? (isActive ? "var(--status-danger-bg)" : "var(--status-danger-bg)")
            : inResort
              ? (isActive ? IN_RESORT_ROSTER.rowBgActive : IN_RESORT_ROSTER.rowBg)
              : (isActive ? "var(--status-info-bg)" : "var(--card-bg)"),
          borderRight: !rtl ? undefined : contact.humanRequested
            ? "4px solid var(--status-danger)"
            : isActive
              ? `4px solid ${inResort ? IN_RESORT_ROSTER.border : "var(--whatsapp-green)"}`
              : "4px solid transparent",
          borderLeft: rtl ? undefined : contact.humanRequested
            ? "4px solid var(--status-danger)"
            : isActive
              ? `4px solid ${inResort ? IN_RESORT_ROSTER.border : "var(--whatsapp-green)"}`
              : "4px solid transparent",
          transform: swiped ? `translateX(${rtl ? -ACTIONS_W : ACTIONS_W}px)` : "translateX(0)",
          transition: "transform 0.2s ease, background 0.15s",
          touchAction: isMobile ? "pan-y" : "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Avatar + name — click opens GuestContextDrawer (row click still opens thread) */}
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onProfileClick?.(contact); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onProfileClick?.(contact); } }}
              title="פתח פרופיל אורח 360°"
              style={{
                display: "flex", alignItems: "center", gap: 8,
                cursor: "pointer", flexShrink: 0, minWidth: 0,
              }}
            >
              <div style={{ position: "relative", flexShrink: 0 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: "50%",
                  background: contact.humanRequested
                    ? "var(--status-danger)"
                    : inResort
                      ? IN_RESORT_ROSTER.avatar
                      : "var(--whatsapp-green)",
                  color: "white",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 700, fontSize: 16,
                }}>
                  {displayName(contact)?.[0]?.toUpperCase() ?? "?"}
                </div>
                <span style={{
                  position: "absolute", bottom: -1, [rtl ? "left" : "right"]: -1,
                  width: 10, height: 10, borderRadius: "50%",
                  border: "2px solid white",
                  background: contact.humanRequested ? "var(--status-danger)" : (active ? "var(--status-success)" : "var(--text-muted)"),
                  animation: contact.humanRequested ? "wa-pulse 1.4s ease-in-out infinite" : "none",
                }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  className="u-guest-name-link"
                  style={{
                    fontWeight: 600, fontSize: 14,
                    color: inResort && !contact.humanRequested ? IN_RESORT_ROSTER.name : "var(--text-main)",
                  }}
                >
                  {displayName(contact)}
                </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, direction: "ltr", textAlign: rtl ? "right" : "left" }}>
                {contact.guestName || contact.pushName ? contact.phone : ""}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)", marginTop: "var(--space-xs)" }}>
                <span className="u-badge-nowrap" style={{
                  display: "inline-block",
                  background: identity.bg, color: identity.fg,
                  fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: "var(--radius-sm)",
                }}>{identity.label}</span>
                {roomChip && (
                  <span className="u-badge-nowrap" style={{
                    display: "inline-block",
                    background: "var(--ivory)", color: roomChip.color,
                    border: `1px solid ${roomChip.color}40`,
                    fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: "var(--radius-sm)",
                  }}>{roomChip.icon} {roomChip.label}</span>
                )}
                {contact.claimedBy && (
                  <span className="u-badge-nowrap" style={{
                    display: "inline-block",
                    background: "var(--status-purple-bg)", color: "var(--status-purple)",
                    fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: "var(--radius-sm)",
                  }}>{t.claimedBadge(contact.claimedByName ?? "—")}</span>
                )}
              </div>
            </div>
            </div>
          </div>
          {/* Right side: WA button + time + unread */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <a
                href={`https://wa.me/${waPhone}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title="פתח שיחת וואטסאפ"
                className={isMobile ? "u-touch-staff" : undefined}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: isMobile ? HIT_STAFF : 26, height: isMobile ? HIT_STAFF : 26, borderRadius: "50%",
                  background: "var(--whatsapp-green)", color: "white",
                  fontSize: 13, textDecoration: "none", flexShrink: 0,
                }}
              >
                💬
              </a>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatTime(last?.created_at)}</div>
            </div>
            {unread > 0 && (
              <div className="u-badge-nowrap" style={{
                background: "var(--whatsapp-green)", color: "white",
                borderRadius: "var(--radius-md)", fontSize: 11, fontWeight: 700,
                padding: "1px 7px", display: "inline-block",
              }}>
                {unread}
              </div>
            )}
          </div>
        </div>
        {last && (
          <div className="u-truncate" style={{
            fontSize: 12, color: "var(--text-muted)", marginTop: "var(--space-sm)",
            paddingRight: rtl ? 48 : 0, paddingLeft: rtl ? 0 : 48,
          }}>
            {last.direction === "outbound" ? "✓ " : ""}
            {resolveInboxMessageText(last.message, resolveCtx)}
          </div>
        )}
        {contact.humanRequested && (
          <div className="u-badge-nowrap" style={{
            marginTop: "var(--space-sm)", display: "inline-flex", alignItems: "center", gap: 6,
            background: "var(--status-danger-bg)", color: "var(--status-danger)",
            fontSize: 11, fontWeight: 700,
            padding: "2px 4px 2px 8px", borderRadius: "var(--radius-md)",
            border: "1px solid var(--status-danger-bg)",
          }}>
            {humanLabel}
            <button
              onClick={(e) => { e.stopPropagation(); onDismiss?.(contact); }}
              title="סמן כטופל — בטל בקשת מענה אנושי"
              className={isMobile ? "u-touch-staff" : undefined}
              style={{
                width: isMobile ? HIT_STAFF : 18, height: isMobile ? HIT_STAFF : 18,
                borderRadius: "50%", border: "none",
                background: "var(--status-danger)", color: "#fff", cursor: "pointer",
                fontSize: 11, fontWeight: 900, lineHeight: 1,
                display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
              }}
            >✓</button>
          </div>
        )}
      </div>
    </div>
  );
}, contactItemPropsEqual);

// ── Message bubble ────────────────────────────────────────────────────────────
// Luxury-tone visual hierarchy: inbound guest messages stay crisp/light for
// readability; outbound bot/staff replies use the resort's deep-slate/gold
// palette (--black-soft, --gold-light) instead of WhatsApp stock green, so the
// thread visually matches the rest of the app rather than looking like a
// generic chat widget.
// React.memo (default shallow-compare) is effective here because `msg` row
// objects keep referential identity across regroups (groupByPhone pushes the
// same row reference, not a clone) and `resolveCtx` is memoized on primitives
// below (see activeResolveCtx) — so a bubble only re-renders when its own
// message, direction, or resolved guest context actually changed.
const Bubble = React.memo(function Bubble({ msg, dir, resolveCtx }) {
  const isOut = msg.direction === "outbound";
  const rtl = dir === "rtl";
  const dispatchInfo = isOut ? parseOutboundDispatch(msg.message) : null;
  const displayText = resolveInboxMessageText(msg.message, resolveCtx);
  return (
    <div style={{
      display: "flex",
      justifyContent: isOut ? (rtl ? "flex-start" : "flex-end") : (rtl ? "flex-end" : "flex-start"),
      marginBottom: 4,
    }}>
      <div style={{
        maxWidth: "78%",
        background: isOut ? "var(--black-soft, #2C2C2C)" : "#ffffff",
        border: isOut ? "none" : "1.5px solid #c5d9f0",
        borderRadius: isOut ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
        boxShadow: isOut ? "0 1px 2px rgba(0,0,0,0.08)" : "0 1px 4px rgba(55,138,221,0.12)",
        padding: "10px 14px",
        fontSize: 15,
        color: isOut ? "var(--ivory, #F5F0E8)" : "#1a1a1a",
        lineHeight: 1.55,
        wordBreak: "break-word",
        whiteSpace: "pre-wrap",
      }}>
        {displayText}
        {isOut && dispatchInfo?.hasInteractiveButtons && (
          <div style={{
            fontSize: 11,
            color: "var(--gold-light, #E8C98A)",
            marginTop: 8,
            paddingTop: 6,
            borderTop: "1px solid rgba(232,201,138,0.25)",
            fontStyle: "italic",
          }}>
            [+ Interactive Buttons]{dispatchInfo.buttonLabels ? `: ${dispatchInfo.buttonLabels}` : ""}
          </div>
        )}
        <div style={{
          fontSize: 10, color: isOut ? "var(--gold-light, #E8C98A)" : "#aaa", marginTop: 4,
          textAlign: isOut ? "left" : "right",
          display: "flex",
          alignItems: "center",
          gap: 4,
          justifyContent: isOut ? "flex-start" : "flex-end",
        }}>
          {formatTime(msg.created_at)}
          {isOut && dispatchInfo?.channel === "meta" && (
            <span title="נשלח דרך תבנית Meta" aria-label="Meta template">🔵</span>
          )}
          {isOut && dispatchInfo?.channel === "session" && (
            <span title="נשלח כהודעת סשן (24ש')" aria-label="Session message">🟢</span>
          )}
          {isOut && <span>✓✓</span>}
        </div>
      </div>
    </div>
  );
});

// ── Skeleton loaders (perceived-performance during initial fetch) ───────────
// Shimmer bars use the resort's own cream/ivory palette (--border/--ivory)
// rather than generic grey, so the loading state still reads as "this app",
// not a stock placeholder. Keyframes live in the <style> block at render time
// (.wa-skel-bar / @keyframes wa-shimmer), shared by both skeletons below.
function RosterSkeleton() {
  return (
    <div aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "var(--space-sm) var(--space-md)", borderBottom: "1px solid var(--border)",
        }}>
          <div className="wa-skel-bar" style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="wa-skel-bar" style={{ width: "50%", height: 12 }} />
            <div className="wa-skel-bar" style={{ width: "75%", height: 10 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ThreadSkeleton({ dir }) {
  const rtl = dir === "rtl";
  const rows = [
    { out: false, w: "55%" }, { out: true, w: "38%" }, { out: false, w: "65%" },
    { out: false, w: "32%" }, { out: true, w: "48%" }, { out: false, w: "42%" },
  ];
  return (
    <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 0" }}>
      {rows.map((r, i) => (
        <div key={i} style={{
          display: "flex",
          justifyContent: r.out ? (rtl ? "flex-start" : "flex-end") : (rtl ? "flex-end" : "flex-start"),
        }}>
          <div className="wa-skel-bar" style={{ width: r.w, maxWidth: "78%", height: 34, borderRadius: 18 }} />
        </div>
      ))}
    </div>
  );
}

// ── Quick marketing phrases ───────────────────────────────────────────────────
const QUICK_PHRASES = [
  { label: "ברוכים הבאים 🌴", text: "שלום {{שם}}! ברוכים הבאים ל-Dream Island. אנחנו שמחים לארח אתכם — אם יש משהו שנוכל לעשות כדי שהחופשה תהיה מושלמת, אנחנו כאן! 🏖️" },
  { label: "חדר מוכן ✅", text: "שלום {{שם}}, חדרכם מוכן ומחכה לכם 🎉 ניתן להיכנס מ-15:00. צוות הקבלה שלנו ישמח לקבל אתכם!" },
  { label: "צ׳ק-אאוט מחר ⏰", text: "שלום {{שם}}, תזכורת ידידותית — הצ׳ק-אאוט שלכם מחר בשעה 11:00. אם תרצו לאחר יציאה, נשמח לנסות לסדר. 😊" },
  { label: "הצעת ספא 💆", text: "שלום {{שם}}, יש לנו מתנה קטנה בשבילכם — 20% הנחה על טיפולי הספא שלנו לאורח בית! מוזמנים לתאם: 📞" },
  { label: "שאלון שביעות רצון ⭐", text: "שלום {{שם}}, תודה שבחרתם ב-Dream Island! נשמח לשמוע כיצד הייתה שהייתכם — דירוג קטן של 1–5 יסייע לנו להשתפר 🙏" },
  { label: "הצעה מיוחדת 🎁", text: "שלום {{שם}}, כאורחים מיוחדים שלנו — יש לנו הצעה בלעדית רק בשבילכם! צרו קשר ונספר לכם 😍" },
];

// ── Contextual quick-reply macros (No-Token Quick Replies, Session 9 Sprint
// 9.4) — pure string templating off metadata the inbox already has loaded
// in memory (spaTime/mealTime/mealLocation/room), zero LLM calls. Used only
// by the in-thread quick-actions drawer, NOT NewChatModal (which has its own
// separately-managed selectedGuest and no "active conversation" concept).
// Returns [] when the guest has no usable metadata at all — the caller falls
// back to the generic QUICK_PHRASES list so the drawer never renders empty.
function buildContextualMacros(contact) {
  if (!contact) return [];
  const name = displayName(contact);
  const macros = [];
  if (contact.mealTime) {
    macros.push({
      label: "🍽️ תזכורת ארוחה",
      text: contact.mealLocation
        ? `היי ${name}, ארוחתך ממתינה לך בשעה ${contact.mealTime} ב${contact.mealLocation} — נשמח לראותך! 🍽️`
        : `היי ${name}, ארוחתך ממתינה לך בשעה ${contact.mealTime} — נשמח לראותך! 🍽️`,
    });
  }
  if (contact.spaTime) {
    macros.push({
      label: "💆 תזכורת ספא",
      text: `היי ${name}, תור הספא שלך נקבע לשעה ${contact.spaTime} — מחכים לך לפינוק! 💆`,
    });
  }
  if (contact.room) {
    macros.push({
      label: "🚪 פרטי שיוך",
      text: `היי ${name}, רק לוודא שהכל מושלם — אתם משוכנים ב${contact.room}. נשמח לדעת אם תצטרכו משהו 🚪`,
    });
  }
  return macros.slice(0, 3);
}

// ── New Conversation Modal ────────────────────────────────────────────────────
function NewChatModal({ onClose, onSent }) {
  const {
    quietActive,
    overrideChecked,
    setOverrideChecked,
    ensureCanSend,
    canSend,
  } = useQuietHoursSend();

  const [mode,          setMode]          = useState("free"); // "free" | "template"
  const [guestSearch,   setGuestSearch]   = useState("");
  const [guestResults,  setGuestResults]  = useState([]);
  const [selectedGuest, setSelectedGuest] = useState(null);

  // Template mode
  const [waTemplates,   setWaTemplates]   = useState([]);
  const [dbTemplates,   setDbTemplates]   = useState([]);
  const [loadingTmpls,  setLoadingTmpls]  = useState(false);
  const [tmplLoadError, setTmplLoadError] = useState(null);
  const [selectedTmpl,  setSelectedTmpl]  = useState(null);
  const [varValues,     setVarValues]     = useState([]);

  // Free-text mode
  const [freeText,      setFreeText]      = useState("");

  const [sending,       setSending]       = useState(false);
  const [err,           setErr]           = useState(null);
  const [hoveredPhrase, setHoveredPhrase] = useState(null);
  const [hoveredTmpl,   setHoveredTmpl]   = useState(null);

  // Bulk mode
  const [bulkFilter,    setBulkFilter]    = useState("checked_in"); // "all"|"checked_in"|"expected"|"suite"|"day_guest"|"checkout_today"
  const [bulkGuests,    setBulkGuests]    = useState([]);
  const [bulkText,      setBulkText]      = useState("");
  const [bulkSending,   setBulkSending]   = useState(false);
  const [bulkProgress,  setBulkProgress]  = useState(null); // { done, total }
  const [bulkDone,      setBulkDone]      = useState(false);
  const [bulkFailures,  setBulkFailures]  = useState([]); // [{ name, phone, reason }] — FAIL VISIBLE: bulk send used to swallow every per-recipient error silently
  const [showBulkList,  setShowBulkList]  = useState(false);

  // Template audience mode
  const [tmplMode,           setTmplMode]           = useState("single"); // "single"|"audience"
  const [tmplAudienceFilter, setTmplAudienceFilter] = useState("checked_in");
  const [tmplAudienceGuests, setTmplAudienceGuests] = useState([]);
  const [tmplBulkSending,    setTmplBulkSending]    = useState(false);
  const [tmplBulkProgress,   setTmplBulkProgress]   = useState(null);
  const [tmplBulkDone,       setTmplBulkDone]       = useState(false);
  const [tmplBulkFailures,   setTmplBulkFailures]   = useState([]); // [{ name, phone, reason }] — same FAIL VISIBLE convention as bulkFailures
  const [tmplSyncOk,        setTmplSyncOk]        = useState(false); // brief "✓ עודכן" flash after manual sync

  // Load guests for bulk mode whenever filter changes
  useEffect(() => {
    if (mode !== "bulk" || !supabase) return;
    const today = new Date().toISOString().slice(0, 10);
    let q = supabase.from("guests").select("id, name, phone, room, room_type, arrival_date, status").not("phone", "is", null);
    if (bulkFilter === "checked_in")      q = q.eq("status", "checked_in");
    else if (bulkFilter === "expected")   q = q.eq("status", "expected");
    else if (bulkFilter === "suite")      q = q.eq("room_type", "suite");
    else if (bulkFilter === "day_guest")  q = q.in("room_type", ["day_guest", "premium_day_guest"]);
    else if (bulkFilter === "checkout_today") q = q.eq("status", "checked_in").lte("departure_date", today);
    q.limit(200).then(({ data }) => setBulkGuests((data ?? []).filter((g) => g.phone)));
  }, [mode, bulkFilter]);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function handleSendBulk() {
    if (!bulkText.trim())        return setErr("נא לכתוב הודעה");
    if (bulkGuests.length === 0) return setErr("אין נמענים בסינון הנוכחי");
    if (!ensureCanSend())        return setErr("שליחה חסומה בשעות שקט — סמן את האישור למטה");

    setBulkSending(true); setErr(null); setBulkDone(false); setBulkFailures([]);
    let done = 0;
    const failures = [];
    for (const g of bulkGuests) {
      setBulkProgress({ done, total: bulkGuests.length });
      const personalised = bulkText.replace(/{{שם}}/g, g.name ?? "").replace(/\{\{שם\}\}/g, g.name ?? "");
      try {
        const { data, error } = await supabase.functions.invoke("whatsapp-send", {
          body: { trigger: "inbox_reply", phone: g.phone, message: personalised },
        });
        if (!error && data?.ok) {
          await supabase.from("whatsapp_conversations").insert({
            phone: g.phone, direction: "outbound", message: personalised, wa_message_id: null,
          });
        } else {
          failures.push({
            name: g.name, phone: g.phone,
            reason: data?.status === "window_closed" ? "חלון 24ש׳ סגור" : (data?.error ?? error?.message ?? "שגיאה"),
          });
        }
      } catch (e) {
        failures.push({ name: g.name, phone: g.phone, reason: e?.message ?? "שגיאה" });
      }
      done++;
      await sleep(650); // rate-limit: ~90 msgs/min
    }
    setBulkFailures(failures);
    setBulkProgress({ done, total: bulkGuests.length });
    setBulkSending(false);
    setBulkDone(true);
  }

  // Fetch WA templates + DB templates — callable on mount and on manual sync
  const fetchTemplates = useCallback(() => {
    if (!isSupabaseConfigured || !supabase) return;
    setLoadingTmpls(true);
    setTmplLoadError(null);
    Promise.all([
      supabase.functions.invoke("get-wa-templates").then(({ data, error }) => {
        if (error) throw new Error(`תבניות Meta: ${error.message ?? "שגיאה"}`);
        return data?.templates ?? [];
      }),
      supabase.from("message_templates").select("*").order("sort_order").then(({ data, error }) => {
        if (error) throw new Error(`תבניות שמורות: ${error.message}`);
        return data ?? [];
      }),
    ]).then(([wa, db]) => {
      // ── DIAGNOSTIC: open browser console to see what the Edge Function actually returned
      console.log("[WA-Inbox] RAW FROM EDGE:", wa.length, wa.map(t => `${t.name}(${t.status})`));
      console.log("[WA-Inbox] FROM DB message_templates:", db.length, db.map(t => t.wa_template_name));
      // ── Merge: start with EVERY template the Edge Function returned.
      // Only exclude hello_world (Meta test-number placeholder — never a real send target).
      // NO status re-filter — the Edge Function is the authority on which are APPROVED.
      // Templates with no row in `message_templates` DB are shown with their raw Meta name
      // (displayName fallback below) — no template is hidden due to a missing DB seed.
      const approvedWa = wa.filter((w) => w.name !== "hello_world");
      console.log("[WA-Inbox] After hello_world filter:", approvedWa.length, approvedWa.map(t => t.name));
      setWaTemplates(approvedWa);
      setDbTemplates(db);
      setTmplSyncOk(true);
      setTimeout(() => setTmplSyncOk(false), 2500);
    }).catch((e) => {
      setTmplLoadError(e?.message || "טעינת התבניות נכשלה");
      setWaTemplates([]);
      setDbTemplates([]);
    }).finally(() => setLoadingTmpls(false));
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  // Search guests by name or phone
  useEffect(() => {
    if (!guestSearch.trim() || !supabase) { setGuestResults([]); return; }
    const q = guestSearch.trim();
    supabase
      .from("guests")
      .select("id, name, phone, room, room_type, arrival_date, status")
      .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(8)
      .then(({ data }) => setGuestResults(data ?? []));
  }, [guestSearch]);

  function pickTemplate(tmpl) {
    setSelectedTmpl(tmpl);
    setVarValues(tmpl ? Array(tmpl.varCount ?? 0).fill("") : []);
  }

  function insertPhrase(text) {
    const personalised = selectedGuest
      ? text.replace("{{שם}}", selectedGuest.name ?? "")
      : text;
    setFreeText(personalised);
  }

  // ── Free-text send (inbox_reply — works within 24h service window) ──────────
  async function handleSendFree() {
    if (!selectedGuest)       return setErr("נא לבחור אורח");
    if (!selectedGuest.phone) return setErr("לאורח זה אין מספר טלפון");
    if (!freeText.trim())     return setErr("נא לכתוב הודעה");
    if (!ensureCanSend())     return setErr("שליחה חסומה בשעות שקט — סמן את האישור למטה");

    setSending(true); setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: { trigger: "inbox_reply", phone: selectedGuest.phone, message: freeText.trim() },
      });
      if (error) throw new Error(data?.error ?? error.message ?? "שגיאה בשליחה");
      if (data && !data.ok) throw new Error(data.error ?? "שגיאה בשליחה");

      await supabase.from("whatsapp_conversations").insert({
        phone: selectedGuest.phone, direction: "outbound",
        message: freeText.trim(), wa_message_id: null,
      });
      onSent(selectedGuest.phone, data?.simulation);
    } catch (e) {
      setErr(e?.message ?? "שגיאה");
    } finally {
      setSending(false);
    }
  }

  // ── Template send ───────────────────────────────────────────────────────────
  async function handleSendTemplate() {
    if (!selectedGuest)       return setErr("נא לבחור אורח");
    if (!selectedGuest.phone) return setErr("לאורח זה אין מספר טלפון");
    if (!selectedTmpl)        return setErr("נא לבחור תבנית");
    if (!ensureCanSend())     return setErr("שליחה חסומה בשעות שקט — סמן את האישור למטה");
    if ((selectedTmpl.varCount ?? 0) > 0 && varValues.some((v) => !v.trim()))
      return setErr("נא למלא את כל שדות המשתנים");

    setSending(true); setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: {
          trigger:           "broadcast",
          guestId:           selectedGuest.id,
          waTemplateName:    selectedTmpl.name,
          templateVariables: varValues,
        },
      });
      if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? "שגיאה בשליחה");

      const tmplPreview = substituteTemplateVars(selectedTmpl.bodyText, varValues);
      await supabase.from("whatsapp_conversations").insert({
        phone: selectedGuest.phone, direction: "outbound",
        message: tmplPreview || `[תבנית: ${selectedTmpl.name}]`, wa_message_id: null,
      });
      onSent(selectedGuest.phone, data.simulation);
    } catch (e) {
      setErr(e?.message ?? "שגיאה");
    } finally {
      setSending(false);
    }
  }

  // Load guests for template audience mode
  useEffect(() => {
    if (mode !== "template" || tmplMode !== "audience" || !supabase) return;
    const today = new Date().toISOString().slice(0, 10);
    let q = supabase.from("guests").select("id, name, phone, room, room_type, arrival_date, status").not("phone", "is", null);
    if (tmplAudienceFilter === "checked_in")      q = q.eq("status", "checked_in");
    else if (tmplAudienceFilter === "expected")   q = q.eq("status", "expected");
    else if (tmplAudienceFilter === "arriving_today") q = q.eq("arrival_date", today);
    else if (tmplAudienceFilter === "suite")      q = q.eq("room_type", "suite");
    else if (tmplAudienceFilter === "day_guest")  q = q.in("room_type", ["day_guest", "premium_day_guest"]);
    else if (tmplAudienceFilter === "past")       q = q.eq("status", "checked_out");
    q.limit(200).then(({ data }) => setTmplAudienceGuests((data ?? []).filter((g) => g.phone)));
  }, [mode, tmplMode, tmplAudienceFilter]);

  // ── Template audience bulk send ─────────────────────────────────────────────
  async function handleSendTemplateAudience() {
    if (!selectedTmpl)              return setErr("נא לבחור תבנית");
    if (tmplAudienceGuests.length === 0) return setErr("אין נמענים בסינון הנוכחי");
    if (!ensureCanSend())           return setErr("שליחה חסומה בשעות שקט — סמן את האישור למטה");

    setTmplBulkSending(true); setErr(null); setTmplBulkDone(false);
    const failures = [];
    let done = 0;
    for (const g of tmplAudienceGuests) {
      setTmplBulkProgress({ done, total: tmplAudienceGuests.length });
      try {
        const autoVars = varValues.map((v, idx) => {
          if (v.trim()) return v;
          if (idx === 0) return g.name ?? "";
          if (idx === 1) return g.room ?? "";
          if (idx === 2) return g.arrival_date ?? "";
          return "";
        });
        const { data, error } = await supabase.functions.invoke("whatsapp-send", {
          body: { trigger: "broadcast", guestId: g.id, waTemplateName: selectedTmpl.name, templateVariables: autoVars },
        });
        if (!error && data?.ok) {
          const tmplPreview = substituteTemplateVars(selectedTmpl.bodyText, autoVars);
          await supabase.from("whatsapp_conversations").insert({
            phone: g.phone, direction: "outbound",
            message: tmplPreview || `[תבנית: ${selectedTmpl.name}]`, wa_message_id: null,
          });
        } else {
          failures.push({ name: g.name, phone: g.phone, reason: data?.error || error?.message || "שגיאה" });
        }
      } catch (e) {
        failures.push({ name: g.name, phone: g.phone, reason: e?.message ?? "שגיאה" });
      }
      done++;
      await sleep(650);
    }
    setTmplBulkFailures(failures);
    setTmplBulkProgress({ done, total: tmplAudienceGuests.length });
    setTmplBulkSending(false);
    setTmplBulkDone(true);
  }

  // Build live preview text (template with vars substituted)
  function buildPreview() {
    if (!selectedTmpl?.bodyText) return null;
    return substituteTemplateVars(selectedTmpl.bodyText, varValues);
  }

  const VAR_LABELS = ["שם אורח", "מספר חדר", "תאריך הגעה", "סוג חדר", "שעת הגעה"];

  // Canonical send order — dream_arrival_confirmation must be index 0
  const TEMPLATE_ORDER = [
    "dream_arrival_confirmation",
    "suite_welcome_morning",
    "dream_payment_and_workshops",
    "dream_mid_stay_check",
    "dream_checkout_feedback",
    "dream_checkin_reminder_v2",
    "dream_handover_agent_v2",
  ];

  // Source of truth: Meta-approved templates only.
  // DB templates are used solely to enrich with Hebrew display labels (via wa_template_name match).
  // This ensures waTemplateName sent to the edge function is always the real Meta name.
  const allTmpls = waTemplates
    .map((w) => {
      const dbMatch = dbTemplates.find((d) => d.wa_template_name === w.name);
      return {
        ...w,
        source:      "wa",
        emoji:       "✅",
        displayName: dbMatch?.label ?? w.name,
      };
    })
    .sort((a, b) => {
      const ia = TEMPLATE_ORDER.indexOf(a.name);
      const ib = TEMPLATE_ORDER.indexOf(b.name);
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: "white", borderRadius: 18, width: 680, maxWidth: "96vw",
        maxHeight: "95vh", overflowY: "auto",
        boxShadow: "0 32px 80px rgba(0,0,0,0.35)",
        direction: "rtl",
      }} onClick={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div style={{
          background: "linear-gradient(135deg, #075E54 0%, #128C7E 100%)",
          color: "white", padding: "18px 22px", borderRadius: "18px 18px 0 0",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>✉️ הודעה חדשה</div>
            <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>שיווק ושימור לקוחות</div>
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)",
            color: "white", fontSize: 16, cursor: "pointer", borderRadius: 8,
            width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
          }}>✕</button>
        </div>

        <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16 }}>

          <QuietHoursGate
            active={quietActive}
            checked={overrideChecked}
            onChange={setOverrideChecked}
          />

          {/* ── Guest search (hidden when template audience mode) ── */}
          <div style={{ display: mode === "template" && tmplMode === "audience" ? "none" : "block" }}>
            <label style={{ display: "block", fontWeight: 700, fontSize: 12, marginBottom: 6, color: "#555", textTransform: "uppercase", letterSpacing: 0.5 }}>
              👤 נמען
            </label>
            {selectedGuest ? (
              <div style={{
                padding: "12px 16px", borderRadius: 12,
                background: "linear-gradient(135deg, #E8F5EF, #F0FAF5)",
                border: "1.5px solid #25D366",
                display: "flex", justifyContent: "space-between", alignItems: "flex-start",
              }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: "50%", background: "#25D366",
                    color: "white", display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 800, fontSize: 16, flexShrink: 0,
                  }}>
                    {selectedGuest.name?.[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "#1a1a1a" }}>{selectedGuest.name}</div>
                    <div style={{ fontSize: 12, color: "#555", direction: "ltr", marginTop: 1 }}>{selectedGuest.phone}</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                      {selectedGuest.room && (
                        <span style={{ background: "#E0F2FE", color: "#0369A1", fontSize: 11, padding: "2px 7px", borderRadius: 6, fontWeight: 600 }}>
                          🏨 חדר {selectedGuest.room}
                        </span>
                      )}
                      {selectedGuest.arrival_date && (
                        <span style={{ background: "#FEF3C7", color: "#92400E", fontSize: 11, padding: "2px 7px", borderRadius: 6, fontWeight: 600 }}>
                          📅 {selectedGuest.arrival_date}
                        </span>
                      )}
                      {selectedGuest.status && (
                        <span style={{
                          background: selectedGuest.status === "checked_in" ? "#D1FAE5" : "#F3F4F6",
                          color: selectedGuest.status === "checked_in" ? "#065F46" : "#6B7280",
                          fontSize: 11, padding: "2px 7px", borderRadius: 6, fontWeight: 600,
                        }}>
                          {selectedGuest.status === "checked_in" ? "✅ שוהה" : "🕐 מתוכנן"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button onClick={() => { setSelectedGuest(null); setGuestSearch(""); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#999", fontSize: 18, lineHeight: 1, paddingTop: 2 }}>
                  ✕
                </button>
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                <input
                  type="text" value={guestSearch}
                  onChange={(e) => setGuestSearch(e.target.value)}
                  placeholder="חפש לפי שם או מספר טלפון..."
                  autoFocus
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "11px 16px", borderRadius: 12, fontSize: 14,
                    border: "1.5px solid #ddd", outline: "none", direction: "rtl",
                    fontFamily: "inherit", transition: "border 0.2s",
                  }}
                  onFocus={(e) => e.target.style.borderColor = "#25D366"}
                  onBlur={(e) => e.target.style.borderColor = "#ddd"}
                />
                {guestResults.length > 0 && (
                  <div style={{
                    position: "absolute", top: "100%", right: 0, left: 0, zIndex: 20,
                    background: "white", border: "1.5px solid #ddd", borderRadius: "0 0 12px 12px",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.12)", maxHeight: 220, overflowY: "auto",
                  }}>
                    {guestResults.map((g) => (
                      <div key={g.id}
                        onClick={() => { setSelectedGuest(g); setGuestSearch(""); setGuestResults([]); }}
                        style={{ padding: "10px 16px", cursor: "pointer", borderBottom: "1px solid #f5f5f5", fontSize: 13 }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "#f0faf5"}
                        onMouseLeave={(e) => e.currentTarget.style.background = "white"}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: 700 }}>{g.name}</span>
                          <span style={{ color: "#888", direction: "ltr", fontSize: 12 }}>{g.phone ?? "ללא טלפון"}</span>
                        </div>
                        {(g.room || g.arrival_date) && (
                          <div style={{ marginTop: 3, display: "flex", gap: 6 }}>
                            {g.room && <span style={{ background: "#E0F2FE", color: "#0369A1", fontSize: 10, padding: "1px 5px", borderRadius: 4 }}>חדר {g.room}</span>}
                            {g.arrival_date && <span style={{ background: "#FEF3C7", color: "#92400E", fontSize: 10, padding: "1px 5px", borderRadius: 4 }}>{g.arrival_date}</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Mode tabs ── */}
          <div style={{
            display: "flex", background: "#F3F4F6", borderRadius: 12, padding: 4, gap: 2,
          }}>
            {[
              { id: "free",     label: "✍️ יחיד" },
              { id: "template", label: "📋 תבנית" },
              { id: "bulk",     label: "📢 קבוצתי" },
            ].map((tab) => (
              <button key={tab.id} onClick={() => { setMode(tab.id); setErr(null); }}
                style={{
                  flex: 1, padding: "9px 0", border: "none", borderRadius: 9,
                  fontFamily: "inherit", fontWeight: 700, fontSize: 13, cursor: "pointer",
                  transition: "all 0.2s",
                  background: mode === tab.id ? "white" : "transparent",
                  color: mode === tab.id ? "#075E54" : "#6B7280",
                  boxShadow: mode === tab.id ? "0 1px 6px rgba(0,0,0,0.1)" : "none",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── FREE TEXT TAB ── */}
          {mode === "free" && (
            <>
              {/* Quick phrases */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  ⚡ ביטויים מהירים
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {QUICK_PHRASES.map((ph, i) => (
                    <button key={i}
                      onClick={() => insertPhrase(ph.text)}
                      onMouseEnter={() => setHoveredPhrase(i)}
                      onMouseLeave={() => setHoveredPhrase(null)}
                      style={{
                        padding: "6px 12px", borderRadius: 20, border: "1.5px solid",
                        borderColor: hoveredPhrase === i ? "#075E54" : "#E0D5C5",
                        background: hoveredPhrase === i ? "#E8F5EF" : "#FAFAFA",
                        color: hoveredPhrase === i ? "#075E54" : "#444",
                        fontSize: 12, fontWeight: 600, cursor: "pointer",
                        fontFamily: "inherit", transition: "all 0.15s",
                      }}
                    >
                      {ph.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Textarea */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  💬 תוכן ההודעה
                </div>
                <div style={{ position: "relative" }}>
                  <textarea
                    value={freeText}
                    onChange={(e) => setFreeText(e.target.value.slice(0, 1000))}
                    placeholder="כתוב הודעה... או לחץ על ביטוי מהיר למעלה"
                    rows={5}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      padding: "12px 16px", paddingBottom: 30,
                      borderRadius: 12, fontSize: 14, lineHeight: 1.6,
                      border: "1.5px solid #ddd", outline: "none",
                      fontFamily: "inherit", direction: "rtl", resize: "vertical",
                      background: "#FAFAFA", transition: "border 0.2s",
                    }}
                    onFocus={(e) => e.target.style.borderColor = "#25D366"}
                    onBlur={(e) => e.target.style.borderColor = "#ddd"}
                  />
                  <div style={{
                    position: "absolute", bottom: 10, left: 12,
                    fontSize: 11, color: freeText.length > 900 ? "#DC2626" : "#aaa",
                  }}>
                    {freeText.length}/1000
                  </div>
                </div>
                <div style={{
                  marginTop: 6, fontSize: 11, color: "#888",
                  display: "flex", alignItems: "center", gap: 4,
                }}>
                  <span>⚠️</span>
                  <span>שליחה חופשית אפשרית בתוך חלון 24 שעות לאחר הודעת הלקוח</span>
                </div>
              </div>

              {/* Live preview */}
              {freeText.trim() && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    👁️ תצוגה מקדימה
                  </div>
                  <div style={{
                    background: "#DCF8C6", borderRadius: "18px 18px 4px 18px",
                    padding: "10px 14px", fontSize: 13, lineHeight: 1.6,
                    color: "#1a1a1a", maxWidth: "85%", wordBreak: "break-word",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.08)", direction: "rtl",
                  }}>
                    {freeText}
                    <div style={{ fontSize: 10, color: "#666", marginTop: 4, textAlign: "left" }}>✓✓ עכשיו</div>
                  </div>
                </div>
              )}

              {err && (
                <div style={{ background: "#FFF0EE", border: "1px solid #C0392B", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#C0392B" }}>
                  {err}
                </div>
              )}

              <button onClick={handleSendFree} disabled={sending || !selectedGuest || !freeText.trim() || !canSend}
                style={{
                  width: "100%", padding: "14px", borderRadius: 12, border: "none",
                  background: sending || !selectedGuest || !freeText.trim() || !canSend
                    ? "#E5E7EB"
                    : "linear-gradient(135deg, #25D366 0%, #128C7E 100%)",
                  color: sending || !selectedGuest || !freeText.trim() || !canSend ? "#9CA3AF" : "white",
                  fontFamily: "inherit", fontSize: 15, fontWeight: 800,
                  cursor: sending || !selectedGuest || !freeText.trim() || !canSend ? "not-allowed" : "pointer",
                  transition: "all 0.2s", letterSpacing: 0.3,
                }}
              >
                {sending ? "⏳ שולח..." : "📤 שלח הודעה"}
              </button>
            </>
          )}

          {/* ── TEMPLATE TAB ── */}
          {mode === "template" && (
            <>
              {/* Recipient mode toggle */}
              <div style={{ display: "flex", background: "#F3F4F6", borderRadius: 10, padding: 3, gap: 2 }}>
                {[{ id: "single", label: "👤 אורח בודד" }, { id: "audience", label: "👥 קהל נבחר" }].map((m) => (
                  <button key={m.id}
                    onClick={() => { setTmplMode(m.id); setErr(null); setTmplBulkDone(false); setTmplBulkProgress(null); }}
                    style={{
                      flex: 1, padding: "8px 0", border: "none", borderRadius: 8,
                      fontFamily: "inherit", fontWeight: 700, fontSize: 13, cursor: "pointer",
                      background: tmplMode === m.id ? "white" : "transparent",
                      color: tmplMode === m.id ? "#075E54" : "#6B7280",
                      boxShadow: tmplMode === m.id ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
                      transition: "all 0.2s",
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Audience filter chips (audience mode) */}
              {tmplMode === "audience" && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>🎯 קהל יעד</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {[
                      { id: "checked_in",     label: "שוהים עכשיו 🏨" },
                      { id: "expected",       label: "מגיעים בקרוב 📅" },
                      { id: "arriving_today", label: "מגיעים היום 🌅" },
                      { id: "suite",          label: "אורחי סוויטות 👑" },
                      { id: "past",           label: "לקוחות עבר 📋" },
                    ].map((f) => (
                      <button key={f.id}
                        onClick={() => { setTmplAudienceFilter(f.id); setTmplBulkDone(false); setTmplBulkProgress(null); }}
                        style={{
                          padding: "7px 13px", borderRadius: 20, border: "2px solid",
                          borderColor: tmplAudienceFilter === f.id ? "#075E54" : "#E5E7EB",
                          background: tmplAudienceFilter === f.id ? "#E8F5EF" : "white",
                          color: tmplAudienceFilter === f.id ? "#075E54" : "#555",
                          fontSize: 12, fontWeight: 700, cursor: "pointer",
                          fontFamily: "inherit", transition: "all 0.15s",
                        }}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <div style={{
                    marginTop: 8, padding: "8px 12px", borderRadius: 8,
                    background: tmplAudienceGuests.length > 0 ? "#E8F5EF" : "#F9FAFB",
                    border: `1px solid ${tmplAudienceGuests.length > 0 ? "#25D366" : "#E5E7EB"}`,
                    fontSize: 13, fontWeight: 700,
                    color: tmplAudienceGuests.length > 0 ? "#075E54" : "#9CA3AF",
                  }}>
                    {tmplAudienceGuests.length > 0 ? `👥 ${tmplAudienceGuests.length} נמענים` : "⏳ טוען..."}
                    {tmplAudienceGuests.length > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 400, marginRight: 8, color: "#555" }}>
                        {tmplAudienceGuests.slice(0, 3).map(g => g.name).join(", ") + (tmplAudienceGuests.length > 3 ? ` ועוד ${tmplAudienceGuests.length - 3}` : "")}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    📋 בחר תבנית
                  </div>
                  <button
                    onClick={fetchTemplates}
                    disabled={loadingTmpls}
                    title="סנכרן תבניות מ-Meta"
                    style={{
                      background: "none", border: `1px solid ${loadingTmpls ? "#E5E7EB" : "#D1D5DB"}`,
                      borderRadius: 6, padding: "3px 9px", fontSize: 11, fontWeight: 700,
                      cursor: loadingTmpls ? "not-allowed" : "pointer",
                      color: loadingTmpls ? "#9CA3AF" : tmplSyncOk ? "#1A7A4A" : "#075E54",
                      fontFamily: "inherit", transition: "color 0.2s",
                    }}
                  >
                    {loadingTmpls ? "⏳ מסנכרן..." : tmplSyncOk ? "✓ עודכן" : "🔄 סנכרן תבניות"}
                  </button>
                </div>
                {loadingTmpls ? (
                  <div style={{ fontSize: 13, color: "#888", padding: "12px 0", textAlign: "center" }}>⏳ טוען תבניות...</div>
                ) : tmplLoadError ? (
                  <div style={{
                    background: "#FCEBEB", border: "1px solid #E24B4A", color: "#8A2C2C",
                    borderRadius: 8, padding: "10px 14px", fontSize: 13, textAlign: "center",
                  }}>
                    ⚠ {tmplLoadError}
                  </div>
                ) : allTmpls.length === 0 ? (
                  <div style={{ fontSize: 13, color: "#aaa", padding: "12px 0", textAlign: "center" }}>
                    לא נמצאו תבניות מאושרות.<br />
                    <span style={{ fontSize: 11 }}>הגדר תבניות ב-Meta Business Manager</span>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {allTmpls.map((t) => (
                      <div key={t.name}
                        onClick={() => pickTemplate(t)}
                        onMouseEnter={() => setHoveredTmpl(t.name)}
                        onMouseLeave={() => setHoveredTmpl(null)}
                        style={{
                          padding: "12px 16px", borderRadius: 12, cursor: "pointer",
                          border: "2px solid",
                          borderColor: selectedTmpl?.name === t.name ? "#25D366" : (hoveredTmpl === t.name ? "#c3e6cb" : "#E5E7EB"),
                          background: selectedTmpl?.name === t.name ? "#E8F5EF" : (hoveredTmpl === t.name ? "#F9FFFE" : "white"),
                          transition: "all 0.15s",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            <span style={{ fontSize: 20 }}>{t.emoji}</span>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 13, color: "#1a1a1a" }}>{t.displayName ?? t.name}</div>
                              {t.source === "wa" && (
                                <span style={{ fontSize: 10, background: "#D1FAE5", color: "#065F46", padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>
                                  מאושר Meta
                                </span>
                              )}
                            </div>
                          </div>
                          {selectedTmpl?.name === t.name && (
                            <span style={{ color: "#25D366", fontSize: 18, fontWeight: 800 }}>✓</span>
                          )}
                        </div>
                        {t.bodyText && (
                          <div style={{
                            marginTop: 8, fontSize: 12, color: "#666", lineHeight: 1.5,
                            maxHeight: 48, overflow: "hidden",
                            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                          }}>
                            {t.bodyText}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Variable inputs */}
              {selectedTmpl && (selectedTmpl.varCount ?? 0) > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    🔧 ערכי משתנים
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {varValues.map((val, idx) => (
                      <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{
                          background: "#075E54", color: "white", borderRadius: 6,
                          padding: "3px 8px", fontSize: 11, fontWeight: 700,
                          fontFamily: "monospace", flexShrink: 0,
                        }}>
                          {`{{${idx + 1}}}`}
                        </span>
                        <input type="text" value={val}
                          onChange={(e) => {
                            const next = [...varValues]; next[idx] = e.target.value; setVarValues(next);
                          }}
                          placeholder={
                            idx === 0 && selectedGuest ? selectedGuest.name :
                            idx === 1 && selectedGuest?.room ? `חדר ${selectedGuest.room}` :
                            idx === 2 && selectedGuest?.arrival_date ? selectedGuest.arrival_date :
                            VAR_LABELS[idx] ?? `משתנה ${idx + 1}`
                          }
                          style={{
                            flex: 1, padding: "9px 12px", borderRadius: 10, fontSize: 13,
                            border: "1.5px solid #ddd", outline: "none", fontFamily: "inherit",
                          }}
                          onFocus={(e) => e.target.style.borderColor = "#25D366"}
                          onBlur={(e) => e.target.style.borderColor = "#ddd"}
                        />
                      </div>
                    ))}
                    {selectedGuest && varValues.length > 0 && (
                      <button
                        onClick={() => {
                          const next = [...varValues];
                          if (next[0] === "" && selectedGuest.name)           next[0] = selectedGuest.name;
                          if (next[1] === "" && selectedGuest.room)            next[1] = `${selectedGuest.room}`;
                          if (next[2] === "" && selectedGuest.arrival_date)    next[2] = selectedGuest.arrival_date;
                          setVarValues(next);
                        }}
                        style={{
                          alignSelf: "flex-start", padding: "6px 12px",
                          border: "1.5px solid #25D366", borderRadius: 8, background: "white",
                          color: "#075E54", fontSize: 12, fontWeight: 700,
                          cursor: "pointer", fontFamily: "inherit",
                        }}
                      >
                        ⚡ מלא אוטומטית מפרטי האורח
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Preview */}
              {buildPreview() && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    👁️ תצוגה מקדימה
                  </div>
                  <div style={{
                    background: "#DCF8C6", borderRadius: "18px 18px 4px 18px",
                    padding: "10px 14px", fontSize: 12, lineHeight: 1.6,
                    color: "#1a1a1a", direction: "ltr", textAlign: "left",
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.08)", maxHeight: 120, overflowY: "auto",
                  }}>
                    {buildPreview()}
                    <div style={{ fontSize: 10, color: "#666", marginTop: 4 }}>✓✓ עכשיו</div>
                  </div>
                </div>
              )}

              {err && (
                <div style={{ background: "#FFF0EE", border: "1px solid #C0392B", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#C0392B" }}>
                  {err}
                </div>
              )}

              {/* Progress bar (audience mode) */}
              {tmplBulkProgress && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#555", marginBottom: 4 }}>
                    <span>{tmplBulkDone ? "✅ שליחה הושלמה!" : `שולח... ${tmplBulkProgress.done}/${tmplBulkProgress.total}`}</span>
                    <span>{Math.round((tmplBulkProgress.done / tmplBulkProgress.total) * 100)}%</span>
                  </div>
                  <div style={{ height: 6, background: "#E5E7EB", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 3, transition: "width 0.4s",
                      width: `${(tmplBulkProgress.done / tmplBulkProgress.total) * 100}%`,
                      background: tmplBulkDone ? "#25D366" : "linear-gradient(90deg, #25D366, #128C7E)",
                    }} />
                  </div>
                </div>
              )}

              {tmplBulkDone && tmplBulkFailures.length > 0 && (
                <div style={{ background: "#FFF5E8", border: "1px solid #B5600A", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#B5600A" }}>
                  ⚠️ {tmplBulkFailures.length} מתוך {tmplAudienceGuests.length} לא נשלחו:
                  <ul style={{ margin: "6px 0 0", paddingRight: 18 }}>
                    {tmplBulkFailures.slice(0, 8).map((f, i) => (
                      <li key={i}>{f.name ?? f.phone} — {f.reason}</li>
                    ))}
                    {tmplBulkFailures.length > 8 && <li>ועוד {tmplBulkFailures.length - 8}...</li>}
                  </ul>
                </div>
              )}

              {tmplBulkDone ? (
                <button onClick={onClose} style={{
                  width: "100%", padding: "14px", borderRadius: 12, border: "none",
                  background: "#25D366", color: "white",
                  fontFamily: "inherit", fontSize: 15, fontWeight: 800, cursor: "pointer",
                }}>✅ סגור</button>
              ) : tmplMode === "audience" ? (
                <button onClick={handleSendTemplateAudience}
                  disabled={tmplBulkSending || !selectedTmpl || tmplAudienceGuests.length === 0 || !canSend}
                  style={{
                    width: "100%", padding: "14px", borderRadius: 12, border: "none",
                    background: tmplBulkSending || !selectedTmpl || tmplAudienceGuests.length === 0 || !canSend
                      ? "#E5E7EB"
                      : "linear-gradient(135deg, #128C7E 0%, #075E54 100%)",
                    color: tmplBulkSending || !selectedTmpl || tmplAudienceGuests.length === 0 || !canSend ? "#9CA3AF" : "white",
                    fontFamily: "inherit", fontSize: 15, fontWeight: 800,
                    cursor: tmplBulkSending || !selectedTmpl || tmplAudienceGuests.length === 0 || !canSend ? "not-allowed" : "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  {tmplBulkSending
                    ? `⏳ שולח... ${tmplBulkProgress?.done ?? 0}/${tmplAudienceGuests.length}`
                    : `📢 שלח ל-${tmplAudienceGuests.length} נמענים`}
                </button>
              ) : (
                <button onClick={handleSendTemplate}
                  disabled={sending || !selectedGuest || !selectedTmpl || !canSend}
                  style={{
                    width: "100%", padding: "14px", borderRadius: 12, border: "none",
                    background: sending || !selectedGuest || !selectedTmpl || !canSend
                      ? "#E5E7EB"
                      : "linear-gradient(135deg, #25D366 0%, #128C7E 100%)",
                    color: sending || !selectedGuest || !selectedTmpl || !canSend ? "#9CA3AF" : "white",
                    fontFamily: "inherit", fontSize: 15, fontWeight: 800,
                    cursor: sending || !selectedGuest || !selectedTmpl || !canSend ? "not-allowed" : "pointer",
                    transition: "all 0.2s", letterSpacing: 0.3,
                  }}
                >
                  {sending ? "⏳ שולח..." : "📤 שלח תבנית"}
                </button>
              )}
            </>
          )}

          {/* ── BULK TAB ── */}
          {mode === "bulk" && (
            <>
              {/* Filter chips */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  🎯 קהל יעד
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {[
                    { id: "checked_in",     label: "שוהים עכשיו 🏨" },
                    { id: "expected",       label: "מגיעים בקרוב 📅" },
                    { id: "suite",          label: "אורחי סוויטות 👑" },
                    { id: "day_guest",      label: "אורחי יום ☀️" },
                    { id: "checkout_today", label: "יוצאים היום 🧳" },
                    { id: "all",            label: "כולם 📋" },
                  ].map((f) => (
                    <button key={f.id} onClick={() => { setBulkFilter(f.id); setBulkDone(false); setBulkProgress(null); }}
                      style={{
                        padding: "7px 13px", borderRadius: 20, border: "2px solid",
                        borderColor: bulkFilter === f.id ? "#075E54" : "#E5E7EB",
                        background: bulkFilter === f.id ? "#E8F5EF" : "white",
                        color: bulkFilter === f.id ? "#075E54" : "#555",
                        fontSize: 12, fontWeight: 700, cursor: "pointer",
                        fontFamily: "inherit", transition: "all 0.15s",
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Recipient count + preview toggle */}
              <div style={{
                padding: "10px 14px", borderRadius: 10,
                background: bulkGuests.length > 0 ? "#E8F5EF" : "#F9FAFB",
                border: `1px solid ${bulkGuests.length > 0 ? "#25D366" : "#E5E7EB"}`,
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: bulkGuests.length > 0 ? "#075E54" : "#9CA3AF" }}>
                  {bulkGuests.length > 0 ? `👥 ${bulkGuests.length} נמענים` : "⏳ טוען..."}
                </span>
                {bulkGuests.length > 0 && (
                  <button onClick={() => setShowBulkList((p) => !p)}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#075E54", fontFamily: "inherit", fontWeight: 600 }}>
                    {showBulkList ? "▲ הסתר" : "▼ הצג רשימה"}
                  </button>
                )}
              </div>

              {/* Collapsible names list */}
              {showBulkList && bulkGuests.length > 0 && (
                <div style={{
                  maxHeight: 130, overflowY: "auto",
                  border: "1px solid #E5E7EB", borderRadius: 10,
                  background: "#FAFAFA",
                }}>
                  {bulkGuests.map((g) => (
                    <div key={g.id} style={{
                      padding: "7px 14px", fontSize: 12, borderBottom: "1px solid #F3F4F6",
                      display: "flex", justifyContent: "space-between",
                    }}>
                      <span style={{ fontWeight: 600 }}>{g.name}</span>
                      <span style={{ color: "#888", direction: "ltr" }}>{g.room ? `חדר ${g.room}` : ""}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Quick phrases (personalised with {{שם}}) */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  ⚡ ביטויים מהירים
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {QUICK_PHRASES.map((ph, i) => (
                    <button key={i} onClick={() => setBulkText(ph.text)}
                      style={{
                        padding: "6px 12px", borderRadius: 20, border: "1.5px solid #E0D5C5",
                        background: "#FAFAFA", color: "#444",
                        fontSize: 12, fontWeight: 600, cursor: "pointer",
                        fontFamily: "inherit", transition: "all 0.15s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#075E54"; e.currentTarget.style.background = "#E8F5EF"; e.currentTarget.style.color = "#075E54"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#E0D5C5"; e.currentTarget.style.background = "#FAFAFA"; e.currentTarget.style.color = "#444"; }}
                    >
                      {ph.label}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: "#888" }}>
                  💡 השתמש ב-<code style={{ background: "#F3F4F6", padding: "1px 4px", borderRadius: 3 }}>{"{{שם}}"}</code> לשם אישי של כל אורח
                </div>
              </div>

              {/* Bulk textarea */}
              <div style={{ position: "relative" }}>
                <textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value.slice(0, 1000))}
                  placeholder={`כתוב הודעה... השתמש ב-{{שם}} לשם אישי`}
                  rows={4}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "12px 16px", paddingBottom: 28,
                    borderRadius: 12, fontSize: 14, lineHeight: 1.6,
                    border: "1.5px solid #ddd", outline: "none",
                    fontFamily: "inherit", direction: "rtl", resize: "vertical",
                    background: "#FAFAFA",
                  }}
                  onFocus={(e) => e.target.style.borderColor = "#25D366"}
                  onBlur={(e) => e.target.style.borderColor = "#ddd"}
                />
                <div style={{ position: "absolute", bottom: 8, left: 12, fontSize: 11, color: bulkText.length > 900 ? "#DC2626" : "#aaa" }}>
                  {bulkText.length}/1000
                </div>
              </div>

              {/* Progress bar */}
              {bulkProgress && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#555", marginBottom: 4 }}>
                    <span>{bulkDone ? "✅ שליחה הושלמה!" : `שולח... ${bulkProgress.done}/${bulkProgress.total}`}</span>
                    <span>{Math.round((bulkProgress.done / bulkProgress.total) * 100)}%</span>
                  </div>
                  <div style={{ height: 6, background: "#E5E7EB", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 3, transition: "width 0.4s",
                      width: `${(bulkProgress.done / bulkProgress.total) * 100}%`,
                      background: bulkDone ? "#25D366" : "linear-gradient(90deg, #25D366, #128C7E)",
                    }} />
                  </div>
                </div>
              )}

              {err && (
                <div style={{ background: "#FFF0EE", border: "1px solid #C0392B", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#C0392B" }}>
                  {err}
                </div>
              )}

              {bulkDone && bulkFailures.length > 0 && (
                <div style={{ background: "#FFF5E8", border: "1px solid #B5600A", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#B5600A" }}>
                  ⚠️ {bulkFailures.length} מתוך {bulkGuests.length} לא נשלחו:
                  <ul style={{ margin: "6px 0 0", paddingRight: 18 }}>
                    {bulkFailures.slice(0, 8).map((f, i) => (
                      <li key={i}>{f.name ?? f.phone} — {f.reason}</li>
                    ))}
                    {bulkFailures.length > 8 && <li>ועוד {bulkFailures.length - 8}...</li>}
                  </ul>
                </div>
              )}

              {bulkDone ? (
                <button onClick={onClose} style={{
                  width: "100%", padding: "14px", borderRadius: 12, border: "none",
                  background: "#25D366", color: "white",
                  fontFamily: "inherit", fontSize: 15, fontWeight: 800, cursor: "pointer",
                }}>
                  ✅ סגור
                </button>
              ) : (
                <button onClick={handleSendBulk}
                  disabled={bulkSending || !bulkText.trim() || bulkGuests.length === 0 || !canSend}
                  style={{
                    width: "100%", padding: "14px", borderRadius: 12, border: "none",
                    background: bulkSending || !bulkText.trim() || bulkGuests.length === 0 || !canSend
                      ? "#E5E7EB"
                      : "linear-gradient(135deg, #128C7E 0%, #075E54 100%)",
                    color: bulkSending || !bulkText.trim() || bulkGuests.length === 0 || !canSend ? "#9CA3AF" : "white",
                    fontFamily: "inherit", fontSize: 15, fontWeight: 800,
                    cursor: bulkSending || !bulkText.trim() || bulkGuests.length === 0 || !canSend ? "not-allowed" : "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  {bulkSending ? `⏳ שולח... ${bulkProgress?.done ?? 0}/${bulkGuests.length}` : `📢 שלח ל-${bulkGuests.length} נמענים`}
                </button>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function WhatsAppInbox({ user, focusPhone, focusGuestName, onFocusConsumed }) {
  const {
    quietActive,
    overrideChecked,
    setOverrideChecked,
    ensureCanSend,
    canSend,
  } = useQuietHoursSend();

  const [contacts, setContacts]   = useState([]); // grouped by phone
  const [active, setActive]       = useState(null); // selected phone
  const [loading, setLoading]     = useState(true);
  const [sending, setSending]     = useState(false);
  const [reply, setReply]         = useState("");
  const [error, setError]         = useState(null);
  const [showNewChat, setShowNewChat] = useState(false);
  // ── Bot active / human-handover toggle ───────────────────────────────────
  const [botActive, setBotActive]     = useState(true);
  const [togglingBot, setTogglingBot] = useState(false);
  // ── Realtime connection status ────────────────────────────────────────────
  const [realtimeOk, setRealtimeOk]   = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  // ── Mobile-first layout + i18n + AI log/quick-actions UI state ───────────
  const isMobile = useIsMobile(768);
  const [mobileScreen, setMobileScreen] = useState("list"); // "list" | "thread"
  const [lang, setLang]           = useState("he");
  const t                         = T[lang];
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [quickOpen, setQuickOpen]   = useState(false);
  const [archivedPhones, setArchivedPhones] = useState(() => new Set());
  const [routeToast, setRouteToast] = useState(null);
  // ── WordPress-style guest editor drawer + claim/assignment state ─────────
  const [editGuestTarget, setEditGuestTarget] = useState(null); // full guests row, or {phone} skeleton for "create new"
  const [editGuestLoading, setEditGuestLoading] = useState(false);
  const [selectedGuestProfile, setSelectedGuestProfile] = useState(null); // contact slice → GuestContextDrawer
  const [claimBusy, setClaimBusy] = useState(false);
  const [dismissAllBusy, setDismissAllBusy] = useState(false);
  // ── Smart Inbox AI Copilot state (Sprint 1: on-demand AI suggestions;
  // Sprint 2: task-routing sub-category picker) ─────────────────────────────
  const [aiSuggestions, setAiSuggestions] = useState(null); // string[] | null — null = not generated yet
  const [aiSuggesting, setAiSuggesting]   = useState(false);
  const [aiSuggestError, setAiSuggestError] = useState(null);
  const [routeDraft, setRouteDraft] = useState(null); // { category, subCategory, note } | null
  const [scriptsByKey, setScriptsByKey] = useState(() => new Map());
  const [templatesByWaName, setTemplatesByWaName] = useState(() => new Map());
  const bottomRef  = useRef(null);
  const pollRef    = useRef(null);
  const allMsgsRef = useRef([]);   // raw flat messages — source of truth for merging
  const lastSeenAt = useRef(null); // ISO timestamp of last fetch — used by fetchSince
  const guestPhoneMapRef = useRef(new Map()); // normalizePhone(guests.phone) → guest profile slice
  const profilesMapRef   = useRef(new Map()); // profiles.id → profiles.name, for claimedBy display
  const alertsReadyRef   = useRef(false); // skip sounds until initial fetchAll completes
  const pendingFocusRef  = useRef(null);   // { phone, guestName? } — Requests Board deep-link
  const [navGuestName, setNavGuestName]   = useState(null); // header hint until contact hydrates

  // ── Pagination / on-demand history state (perf sprint) ───────────────────
  const oldestSeenAtRef  = useRef(null);        // ISO of the oldest row currently in allMsgsRef — "load older" watermark
  const hydratedPhonesRef = useRef(new Set());  // phones whose full history has already been fetched via fetchThreadHistory
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder,  setLoadingOlder]  = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);

  // ── Shared row normaliser ─────────────────────────────────────────────────
  const normalise = (r) => ({
    ...r,
    phone:                  canonicalizePhone(r.phone),
    guest_id:               r.guests?.id ?? null,
    guest_name:             r.guests?.name ?? null,
    spa_time:               r.guests?.spa_time ?? null,
    guest_room:             r.guests?.room ?? null,
    guest_room_type:        r.guests?.room_type ?? null,
    guest_status:           r.guests?.status ?? null,
    guest_departure_date:   r.guests?.departure_date ?? null,
    guest_arrival_date:     r.guests?.arrival_date ?? null,
    guest_portal_token:     r.guests?.portal_token ?? null,
    guest_meal_time:        r.guests?.meal_time ?? null,
    guest_meal_location:    r.guests?.meal_location ?? null,
    guest_claimed_by:       r.guests?.claimed_by ?? null,
    guest_claimed_at:       r.guests?.claimed_at ?? null,
    push_name:              r.push_name ?? null,
    human_requested:        r.human_requested    ?? false,
    human_request_type:    r.human_request_type ?? null,
  });

  // ── Client-side identity-resolution fallback ──────────────────────────────
  // The webhook's guest_id join is the primary path for showing a real name
  // (see whatsapp-webhook's GUEST_LOOKUP_FIELDS fallback). This is a second,
  // independent safety net on the frontend: if a contact still has no
  // guestName (guest_id never resolved — e.g. a historical row from before
  // a guest was added, or a guests.phone format neither lookup anticipated),
  // re-check it here against every guest's phone using the same last-9-digit
  // comparison, so the UI self-heals without needing a backfill migration.
  const resolveIdentityFallback = useCallback((contacts) => {
    if (guestPhoneMapRef.current.size === 0) return contacts;
    return contacts.map((c) => {
      const matched = guestPhoneMapRef.current.get(normalizePhone(c.phone));
      if (!matched) return c;
      return {
        ...c,
        guestName: c.guestName || matched.name,
        status: matched.status ?? c.status ?? null,
        arrivalDate: matched.arrival_date ?? c.arrivalDate ?? null,
        departureDate: matched.departure_date ?? c.departureDate ?? null,
        ...(matched.claimed_by != null
          ? { claimedBy: matched.claimed_by, claimedAt: matched.claimed_at ?? null }
          : {}),
      };
    });
  }, []);

  // ── Resolve claimed_by (a profiles.id UUID) to a display name, the same
  // "join client-side from a once-fetched map" approach as the identity
  // fallback above — avoids a second nested FK alias in the main query.
  const resolveClaimNames = useCallback((contacts) => {
    if (profilesMapRef.current.size === 0) return contacts;
    return contacts.map((c) => {
      if (!c.claimedBy) return c;
      const name = profilesMapRef.current.get(c.claimedBy);
      return name ? { ...c, claimedByName: name } : c;
    });
  }, []);

  const applyGrouping = useCallback(
    (rows) => resolveClaimNames(resolveIdentityFallback(groupByPhone(rows))),
    [resolveIdentityFallback, resolveClaimNames]
  );

  // Merge new conversation rows instantly (Realtime INSERT or incremental poll).
  const mergeIncomingRows = useCallback((rows) => {
    if (!rows?.length) return false;
    const incoming = rows.map((r) => {
      const n = normalise(r);
      if (!n.guest_claimed_by) {
        for (let i = allMsgsRef.current.length - 1; i >= 0; i--) {
          const prev = allMsgsRef.current[i];
          if (prev.phone === n.phone && prev.guest_claimed_by) {
            n.guest_claimed_by = prev.guest_claimed_by;
            n.guest_claimed_at = prev.guest_claimed_at ?? null;
            break;
          }
        }
      }
      return n;
    });
    const existingIds = new Set(allMsgsRef.current.map((m) => m.id));
    const toAdd = incoming.filter((m) => m.id && !existingIds.has(m.id));
    if (!toAdd.length) return false;
    if (alertsReadyRef.current) {
      let alertKind = null;
      for (const m of toAdd) {
        const k = classifyInboundMessageAlert(m);
        if (k === "suite") { alertKind = "suite"; break; }
        if (k === "off_resort") alertKind = "off_resort";
      }
      if (alertKind === "suite") playSuiteGuestAlert();
      else if (alertKind === "off_resort") playOffResortGuestAlert();
    }
    const merged = [...allMsgsRef.current, ...toAdd];
    allMsgsRef.current = merged;
    for (const m of toAdd) {
      if (m.created_at && (!lastSeenAt.current || m.created_at > lastSeenAt.current)) {
        lastSeenAt.current = m.created_at;
      }
    }
    setContacts(applyGrouping(merged));
    setLastUpdated(new Date());
    return true;
  }, [applyGrouping]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Full fetch (initial load only) ────────────────────────────────────────
  // Recency-windowed, NOT the whole table: previously this ordered ascending
  // + limit(2000), which fetches the OLDEST 2000 rows — once the table passed
  // 2000 total messages, brand-new guest activity would never appear on first
  // paint at all (fetchSince would eventually crawl forward to it, ~100
  // rows/poll-tick, but that could take minutes). Ordering by created_at DESC
  // and reversing in memory fixes correctness AND shrinks the payload —
  // recommend an index on (created_at DESC) alone (see migration 122) since
  // the existing indexes are all phone/guest_id-prefixed composites that
  // don't help a table-wide recency scan.
  const fetchAll = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("whatsapp_conversations")
      .select(CONVERSATION_SELECT)
      .order("created_at", { ascending: false })
      .limit(INITIAL_FETCH_LIMIT);

    if (err) { setError(err.message); return; }

    const rows = data ?? [];
    const flat = rows.map(normalise).reverse(); // back to ascending — every downstream consumer expects oldest→newest
    allMsgsRef.current = flat;
    // Watermark = latest row timestamp (not wall-clock) so rows inserted during
    // fetchAll are not skipped by the next incremental poll.
    const maxTs = flat.reduce((max, m) => (m.created_at > max ? m.created_at : max), "");
    lastSeenAt.current = maxTs || new Date().toISOString();
    oldestSeenAtRef.current = flat.length ? flat[0].created_at : null;
    // Got a full page → there's likely older history beyond the window (heuristic,
    // not exact — worst case the "load older" button does one extra empty fetch).
    setHasMoreOlder(rows.length === INITIAL_FETCH_LIMIT);
    setContacts(applyGrouping(flat));
    setLastUpdated(new Date());
    setLoading(false);
    alertsReadyRef.current = true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Incremental fetch — only rows newer than lastSeenAt ──────────────────
  // Used by: polling interval + Realtime callback.
  // Fetches at most 100 new rows, merges by ID (no duplicates), regroups.
  const fetchSince = useCallback(async () => {
    if (!lastSeenAt.current) return; // wait for first fetchAll
    const since = lastSeenAt.current;

    const { data, error: fetchErr } = await supabase
      .from("whatsapp_conversations")
      .select(CONVERSATION_SELECT)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(100);

    if (fetchErr) {
      console.warn("[WA-inbox] fetchSince error:", fetchErr.message);
      return;
    }
    mergeIncomingRows(data ?? []);
  }, [mergeIncomingRows]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load older conversations — pagination for the recency-windowed initial
  // fetch above. Pulls the next OLDER_BATCH_LIMIT rows before oldestSeenAtRef
  // and prepends them (ascending order preserved). Nothing is ever silently
  // hidden: staff who need to reach further back than the fast-load window
  // have an explicit, visible affordance — "New Chat" guest search is also
  // unaffected since it queries `guests` directly, not this windowed pool.
  const fetchOlder = useCallback(async () => {
    if (!oldestSeenAtRef.current || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const { data, error: err } = await supabase
        .from("whatsapp_conversations")
        .select(CONVERSATION_SELECT)
        .lt("created_at", oldestSeenAtRef.current)
        .order("created_at", { ascending: false })
        .limit(OLDER_BATCH_LIMIT);

      if (err) { setError(err.message); return; }

      const rows = data ?? [];
      const older = rows.map(normalise).reverse();
      setHasMoreOlder(rows.length === OLDER_BATCH_LIMIT);
      if (older.length) {
        oldestSeenAtRef.current = older[0].created_at;
        const merged = [...older, ...allMsgsRef.current];
        allMsgsRef.current = merged;
        setContacts(applyGrouping(merged));
      }
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, applyGrouping]);

  // ── Full history for a single opened contact ──────────────────────────────
  // The recency-windowed fetchAll/fetchOlder pool may not contain a guest's
  // entire conversation history. When staff actually open a thread, hydrate it
  // fully (bounded, single-phone query — cheap regardless of table size) so
  // the visible thread is never silently truncated. Runs once per phone per
  // session (hydratedPhonesRef) — cheap to skip on repeat clicks.
  const fetchThreadHistory = useCallback(async (phone) => {
    if (!phone || hydratedPhonesRef.current.has(phone)) return;
    hydratedPhonesRef.current.add(phone); // mark eagerly — avoid duplicate concurrent fetches on rapid re-click
    setLoadingThread(true);
    try {
      const { data, error: err } = await supabase
        .from("whatsapp_conversations")
        .select(CONVERSATION_SELECT)
        .in("phone", phoneVariants(phone))
        .order("created_at", { ascending: true })
        .limit(THREAD_HISTORY_LIMIT);

      if (err) {
        console.warn("[WA-inbox] fetchThreadHistory error:", err.message);
        return;
      }
      const rows = (data ?? []).map(normalise);
      const existingIds = new Set(allMsgsRef.current.map((m) => m.id));
      const toAdd = rows.filter((m) => m.id && !existingIds.has(m.id));
      if (!toAdd.length) return;
      const merged = [...allMsgsRef.current, ...toAdd].sort((a, b) =>
        a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
      );
      allMsgsRef.current = merged;
      setContacts(applyGrouping(merged));
    } finally {
      setLoadingThread(false);
    }
  }, [applyGrouping]);

  // ── Archive a contact locally ─────────────────────────────────────────────
  // Stable useCallback reference (not an inline arrow per roster row) so
  // ContactItem's React.memo comparator above can actually treat this prop as
  // unchanged across renders — see contactItemPropsEqual.
  const archiveContact = useCallback((phone) => {
    setArchivedPhones((prev) => new Set(prev).add(phone));
  }, []);

  // ── Dismiss human-intervention request ────────────────────────────────────
  // Clears both layers in one click: the per-message `human_requested` flag
  // that drives the red badge here, AND `guests.needs_callback` — the staff
  // alert flag on the guest profile (UI-only; bot keeps replying). Tries all
  // phone-format variants (+972/972/0-prefixed) since `whatsapp_conversations.phone` and
  // `guests.phone` aren't guaranteed to share one format (session 15 root cause).
  const dismissHumanRequest = useCallback(async (contact) => {
    const bare = contact.phone; // canonicalizePhone() already applied — "972XXXXXXXXX"
    const variants = phoneVariants(bare);
    try {
      const [{ error: convErr }, { error: guestErr }] = await Promise.all([
        supabase.from("whatsapp_conversations")
          .update({ human_requested: false })
          .in("phone", variants)
          .eq("human_requested", true),
        supabase.from("guests")
          .update({ needs_callback: false })
          .in("phone", variants),
      ]);
      if (convErr) throw convErr;
      if (guestErr) throw guestErr;

      // Optimistic local clear — don't wait on the realtime round-trip
      // (fetchSince() only re-fetches rows newer than the last poll, so an
      // UPDATE to an old row's flag wouldn't otherwise be picked up here).
      allMsgsRef.current = allMsgsRef.current.map((m) =>
        m.phone === bare ? { ...m, human_requested: false } : m
      );
      setContacts(applyGrouping(allMsgsRef.current));
    } catch (e) {
      setError("שגיאה בסימון כטופל: " + (e?.message ?? e));
    }
  }, [applyGrouping]);

  // ── Bulk dismiss — all human-request alerts in the visible roster ─────────
  const dismissAllAlerts = useCallback(async (alertContacts) => {
    if (!alertContacts.length) return;
    if (!window.confirm(t.dismissAllConfirm)) return;

    const alertPhones = new Set(alertContacts.map((c) => c.phone));
    const allVariants = [...new Set(alertContacts.flatMap((c) => phoneVariants(c.phone)))];

    setDismissAllBusy(true);
    try {
      const [{ error: convErr }, { error: guestErr }] = await Promise.all([
        supabase.from("whatsapp_conversations")
          .update({ human_requested: false })
          .in("phone", allVariants)
          .eq("human_requested", true),
        supabase.from("guests")
          .update({ needs_callback: false })
          .in("phone", allVariants),
      ]);
      if (convErr) throw convErr;
      if (guestErr) throw guestErr;

      allMsgsRef.current = allMsgsRef.current.map((m) =>
        alertPhones.has(m.phone) ? { ...m, human_requested: false } : m
      );
      setContacts(applyGrouping(allMsgsRef.current));
      setRouteToast(t.dismissAllDone(alertContacts.length));
      setTimeout(() => setRouteToast(null), 3500);
    } catch (e) {
      setError("שגיאה בניקוי התראות: " + (e?.message ?? e));
    } finally {
      setDismissAllBusy(false);
    }
  }, [applyGrouping, t]);

  // ── Claim / take-over / release a guest's conversation ───────────────────
  // Persists to guests.claimed_by/claimed_at (migration 081) so the
  // assignment survives a page refresh — unlike the in-memory "recently
  // active" proxy above, this is a real, queryable assignment. Any staff
  // member can claim OR take over an existing claim (no permission gate —
  // small-team cooperative tool, same trust model as OperationsBoard's
  // claim button); the visible claimedByName badge is the social signal
  // that prevents stepping on each other's replies, not a hard lock.
  const setClaim = useCallback(async (contact, claim) => {
    if (!contact || !user?.id) return;
    const variants = phoneVariants(contact.phone);
    setClaimBusy(true);
    try {
      const patch = claim
        ? { claimed_by: user.id, claimed_at: new Date().toISOString() }
        : { claimed_by: null, claimed_at: null };
      const { data: updatedRows, error: err } = await supabase
        .from("guests")
        .update(patch)
        .in("phone", variants)
        .select("id");
      if (err) throw err;
      if (!updatedRows?.length) {
        if (!claim) {
          // Releasing a claim on a phone with no guests row at all is a true
          // no-op — nothing to release. Only "קח שיחה" (claim=true) must
          // never fail silently/loudly for a not-yet-a-guest number.
          throw new Error("לא נמצא פרופיל אורח לטלפון הזה — אין שיוך לשחרר.");
        }
        // Auto-create-stub bugfix (Mike directive): a staff member clicking
        // "קח שיחה" on a phone with no guests row must have the claim saved
        // immediately, not fail — insert a minimal stub row (name/phone +
        // the claim itself) rather than throwing. The guest editor (✏️)
        // already treats any row as fully editable afterward, so nothing
        // here is final — staff can fill in the rest right away.
        const stubName = contact.guestName || contact.pushName || `אורח ${contact.phone}`;
        const { data: created, error: insErr } = await supabase
          .from("guests")
          .insert({
            name: stubName,
            phone: `+${contact.phone}`,
            claimed_by: patch.claimed_by,
            claimed_at: patch.claimed_at,
          })
          .select("id");
        if (insErr) throw insErr;
        if (!created?.length) throw new Error("יצירת פרופיל אורח נכשלה — לא ניתן להשתיק את הבוט.");
      }

      allMsgsRef.current = allMsgsRef.current.map((m) =>
        m.phone === contact.phone
          ? { ...m, guest_claimed_by: patch.claimed_by, guest_claimed_at: patch.claimed_at }
          : m
      );
      setContacts(applyGrouping(allMsgsRef.current));
      if (claim) {
        setRouteToast("🔇 הבוט מושתק לאורח זה — לחץ שוב לשחרור");
        setTimeout(() => setRouteToast(null), 3500);
      }
    } catch (e) {
      setError("שגיאה בעדכון שיוך השיחה: " + (e?.message ?? e));
    } finally {
      setClaimBusy(false);
    }
  }, [applyGrouping, user]);

  // ── Apply a full guests row (from the editor's onSaved, or a Realtime
  // postgres_changes payload — both shapes match: id/name/phone/.../
  // claimed_by/claimed_at) onto every matching local message row. Single
  // shared patch function so the editor save path and the cross-tab
  // Realtime listener below can't drift out of sync with each other.
  const applyGuestRowUpdate = useCallback((g) => {
    if (!g?.phone) return;
    const key = normalizePhone(g.phone);
    if (key) {
      guestPhoneMapRef.current.set(key, {
        name: g.name,
        status: g.status ?? null,
        arrival_date: g.arrival_date ?? null,
        departure_date: g.departure_date ?? null,
      });
    }
    const targetPhone = canonicalizePhone(g.phone);
    let touched = false;
    allMsgsRef.current = allMsgsRef.current.map((m) => {
      if (m.phone !== targetPhone) return m;
      touched = true;
      return {
        ...m,
        guest_id:             g.id ?? m.guest_id,
        guest_name:           g.name ?? m.guest_name,
        guest_notes:          g.guest_notes ?? null,
        spa_time:             g.spa_time ?? null,
        guest_room:           g.room ?? null,
        guest_room_type:      g.room_type ?? null,
        guest_status:         g.status ?? m.guest_status,
        guest_departure_date: g.departure_date ?? null,
        guest_arrival_date:   g.arrival_date ?? null,
        guest_portal_token:   g.portal_token ?? null,
        guest_meal_time:      g.meal_time ?? null,
        guest_meal_location:  g.meal_location ?? null,
        guest_claimed_by:     g.claimed_by ?? null,
        guest_claimed_at:     g.claimed_at ?? null,
      };
    });
    if (touched) setContacts(applyGrouping(allMsgsRef.current));
  }, [applyGrouping]);

  // ── Guest 360° context drawer — roster name/avatar click ─────────────────
  const openGuestContextDrawer = useCallback((contact) => {
    if (!contact) return;
    setSelectedGuestProfile(contact);
  }, []);

  // ── WordPress-style guest editor — open ───────────────────────────────────
  // Fetches the FULL guests row by phone (not just the handful of fields the
  // inbox query already carries) so AddGuestModal gets the same complete
  // record GuestsPage/GuestDashboard pass it. No guest row found for this
  // phone → fall back to a {phone} skeleton, which AddGuestModal's existing
  // isEdit=!!guest.id contract already treats as "create new" — so a
  // not-yet-a-guest number can be turned into one from right here.
  const openGuestEditor = useCallback(async (contact) => {
    if (!contact) return;
    setEditGuestLoading(true);
    try {
      const variants = phoneVariants(contact.phone);
      const { data, error: err } = await supabase
        .from("guests").select("*").in("phone", variants).limit(1).maybeSingle();
      if (err) throw err;
      setEditGuestTarget(data ?? { phone: contact.phone });
    } catch (e) {
      setError("שגיאה בטעינת פרטי אורח: " + (e?.message ?? e));
    } finally {
      setEditGuestLoading(false);
    }
  }, []);

  // ── WordPress-style guest editor — save ───────────────────────────────────
  // Optimistic local patch (same pattern as dismissHumanRequest/setClaim)
  // instead of waiting for a realtime round-trip — whatsapp_conversations
  // realtime only fires on conversation INSERT/UPDATE, never on a guests-only
  // edit, so without this the drawer's own changes wouldn't appear until the
  // next unrelated message refreshed the thread.
  const handleGuestSaved = useCallback((saved) => {
    if (saved) applyGuestRowUpdate(saved);
    setEditGuestTarget(null);
  }, [applyGuestRowUpdate]);

  // ── Open a contact — selects it, switches to thread screen on mobile, and
  // marks its inbound messages read locally so the unread badge actually
  // clears (previously `_read` was referenced by the badge logic but never
  // set anywhere, so unread counts only ever grew). ─────────────────────────
  const openContact = useCallback((phone) => {
    setActive(phone);
    if (isMobile) setMobileScreen("thread");
    setDrawerOpen(false);
    setQuickOpen(false);
    // AI suggestions + route draft are per-conversation — stale suggestions
    // from whichever chat was open before must never leak into a new one.
    setAiSuggestions(null);
    setAiSuggestError(null);
    setRouteDraft(null);
    allMsgsRef.current = allMsgsRef.current.map((m) =>
      m.phone === phone && m.direction === "inbound" ? { ...m, _read: true } : m
    );
    setContacts(applyGrouping(allMsgsRef.current));
    fetchThreadHistory(phone); // background hydrate — full history may exceed the fast-load window
  }, [isMobile, applyGrouping, fetchThreadHistory]);

  // ── Deep-link focus (Requests Board → "פתח שיחה ב-DREAM BOT") ───────────
  useEffect(() => {
    if (!focusPhone) return;
    pendingFocusRef.current = {
      phone: canonicalizePhone(focusPhone),
      guestName: focusGuestName ?? null,
    };
    onFocusConsumed?.();
  }, [focusPhone, focusGuestName, onFocusConsumed]);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending || loading) return;

    const normTarget = normalizePhone(pending.phone);
    const match = contacts.find(
      (c) => c.phone === pending.phone || normalizePhone(c.phone) === normTarget,
    );

    if (match) {
      openContact(match.phone);
      pendingFocusRef.current = null;
      if (pending.guestName && !match.guestName) setNavGuestName(pending.guestName);
      return;
    }

    if (!loading) {
      openContact(pending.phone);
      if (pending.guestName) setNavGuestName(pending.guestName);
      pendingFocusRef.current = null;
    }
  }, [contacts, loading, openContact]);

  // ── Route a guest conversation to Operations (Maintenance/Housekeeping) ──
  // Inserts a real `tasks` row — same shape as whapi-webhook/staff-ops — so it
  // shows up immediately on the Operations & Maintenance board under the same
  // SLA tracking (sla-escalation-cron scans by sla_category/sla_deadline
  // regardless of source). source='inbox_routed' keeps provenance honest:
  // this is an operator action on the guest channel, not a parsed staff
  // WhatsApp-group report.
  //
  // Sprint 2 — `subCategoryLabel`/`note` replace the old behavior of blasting
  // the guest's raw last-inbound message as the task description with zero
  // staff judgment in between (e.g. a guest typing "Could you maybe bring a
  // couple of towels when you get a chance?" became the literal ticket text).
  // Staff now picks a real category and/or types the actual ask before this
  // fires — `description` falls back to the raw message only if the picker
  // produced neither (shouldn't happen since dispatch is disabled until one
  // of the two is filled, but keeps this function safe to call directly).
  async function routeTask(category, contact, subCategoryLabel, note) {
    if (!contact) return;
    const isMaint     = category === "maintenance";
    const slaCategory = isMaint ? "maintenance" : "guest_amenities";
    const slaMinutes  = isMaint ? 30 : 15;
    const lastInbound = [...contact.messages].reverse().find((m) => m.direction === "inbound");
    const guestLabel   = displayName(contact);
    const definedText = [subCategoryLabel, note?.trim()].filter(Boolean).join(" — ");
    const context      = definedText || lastInbound?.message?.slice(0, 280) || "";
    try {
      const { data: taskRow, error: insErr } = await supabase.from("tasks").insert({
        room_number:         contact.room ?? null,
        department:           isMaint ? "תפעול" : "משק",
        description:          `[מתיבת וואטסאפ — ${guestLabel}] ${context}`.trim(),
        priority:             "normal",
        status:               "open",
        sla_category:         slaCategory,
        sla_deadline:          new Date(Date.now() + slaMinutes * 60000).toISOString(),
        source:               "inbox_routed",
        reporter_profile_id:  user?.id ?? null,
        reporter_raw_text:    lastInbound?.message ?? null,
      }).select("id").single();
      if (insErr) throw insErr;
      setRouteToast(isMaint ? "✅ נפתחה משימת תחזוקה בלוח התפעול + נשלחה לקבוצה" : "✅ נפתחה משימת משק בית בלוח התפעול + נשלחה לקבוצה");
      if (taskRow?.id) {
        supabase.functions.invoke("notify-manual-task", { body: { taskId: taskRow.id } })
          .then(({ data: notifyData, error: notifyErr }) => {
            if (notifyErr || notifyData?.ok === false) {
              console.warn("[WhatsAppInbox] notify-manual-task failed (non-blocking):", notifyErr?.message ?? notifyData?.error);
            }
          });
      }
    } catch (e) {
      setRouteToast("⚠️ שגיאה ביצירת משימה: " + (e?.message ?? e));
    }
    setRouteDraft(null);
    setQuickOpen(false);
    setTimeout(() => setRouteToast(null), 3500);
  }

  // ── On-demand AI reply suggestions (Sprint 1) ─────────────────────────────
  // Only ever called from the "✨ הצעות AI חכמות" button's onClick — never
  // automatically on chat selection (token-saving by design, per the brief).
  // Sends only the last 3 messages of the ACTIVE thread, already loaded
  // client-side — no extra DB read on the edge-function side.
  async function generateAiSuggestions() {
    if (!activeContact) return;
    setAiSuggesting(true);
    setAiSuggestError(null);
    try {
      const last3 = activeContact.messages.slice(-3).map((m) => ({
        direction: m.direction,
        text: m.message,
      }));
      const { data, error: fnErr } = await supabase.functions.invoke("suggest-replies", {
        body: {
          messages:  last3,
          guestName: activeContact.guestName ?? activeContact.pushName ?? null,
          room:      activeContact.room ?? null,
        },
      });
      if (fnErr || !data?.ok) throw new Error(data?.error ?? fnErr?.message ?? "שגיאה ביצירת הצעות");
      setAiSuggestions(Array.isArray(data.suggestions) ? data.suggestions.slice(0, 3) : []);
    } catch (e) {
      setAiSuggestError(e?.message ?? "שגיאה");
      setAiSuggestions(null);
    } finally {
      setAiSuggesting(false);
    }
  }

  // ── Populate the guest phone→name map once on mount, for the identity-
  // resolution fallback above. Re-applies to already-loaded contacts in case
  // this resolves after the first fetchAll already rendered them. ──────────
  useEffect(() => {
    supabase
      .from("guests")
      .select("name, phone, status, arrival_date, departure_date, claimed_by, claimed_at")
      .not("phone", "is", null)
      .then(({ data }) => {
        const map = new Map();
        for (const g of data ?? []) {
          const key = normalizePhone(g.phone);
          if (key) {
            map.set(key, {
              name: g.name,
              status: g.status ?? null,
              arrival_date: g.arrival_date ?? null,
              departure_date: g.departure_date ?? null,
              claimed_by: g.claimed_by ?? null,
              claimed_at: g.claimed_at ?? null,
            });
          }
        }
        guestPhoneMapRef.current = map;
        setContacts((prev) => resolveIdentityFallback(prev));
      });
  }, [resolveIdentityFallback]);

  // ── Populate the profiles id→name map once on mount, for resolving
  // guests.claimed_by (a UUID) to a readable name on the claim badge. ──────
  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, name")
      .then(({ data }) => {
        const map = new Map();
        for (const p of data ?? []) map.set(p.id, p.name);
        profilesMapRef.current = map;
        setContacts((prev) => resolveClaimNames(prev));
      });
  }, [resolveClaimNames]);

  // ── Load script/template bodies for legacy tag resolution in thread bubbles ─
  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("bot_scripts")
      .select("script_key, message_text")
      .then(({ data }) => {
        const map = new Map();
        for (const r of data ?? []) {
          if (r.script_key && r.message_text) map.set(r.script_key, r.message_text);
        }
        setScriptsByKey(map);
      });
    supabase
      .from("message_templates")
      .select("wa_template_name, content")
      .not("wa_template_name", "is", null)
      .then(({ data }) => {
        const map = new Map();
        for (const r of data ?? []) {
          if (r.wa_template_name && r.content) map.set(r.wa_template_name, r.content);
        }
        setTemplatesByWaName(map);
      });
  }, []);

  // Browser autoplay policy — unlock Web Audio on first staff interaction in this tab.
  useEffect(() => {
    const unlock = () => unlockInboxAlertAudio();
    window.addEventListener("click", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("click", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // ── Initial load + incremental polling fallback ───────────────────────────
  // fetchAll fires once; after that only fetchSince runs every POLL_MS (fallback).
  // Polling is ONLY a fallback when Realtime is unavailable — Realtime is primary.
  // This keeps the payload tiny (≤100 rows) on every tick.
  //
  // Cache-restore fast path: if a previous mount already populated
  // inboxMemoryCache (staff switched tabs and came back), paint instantly from
  // memory instead of blanking to a loading state, then silently revalidate
  // via fetchSince() — same "instant from memory, quietly re-validate" contract
  // fetchSince already has for the polling/Realtime path, just triggered once
  // more on remount to catch anything that arrived while unmounted.
  useEffect(() => {
    function startPolling() {
      pollRef.current = setInterval(() => {
        console.log("[WA-inbox] 📋 Polling tick (fallback)");
        fetchSince();
      }, POLL_MS);
    }

    if (inboxMemoryCache.messages) {
      console.log(`[WA-inbox] Restoring ${inboxMemoryCache.messages.length} cached rows — instant paint, revalidating in background`);
      allMsgsRef.current = inboxMemoryCache.messages;
      lastSeenAt.current = inboxMemoryCache.lastSeenAt;
      oldestSeenAtRef.current = inboxMemoryCache.oldestSeenAt;
      hydratedPhonesRef.current = new Set(inboxMemoryCache.hydratedPhones ?? []);
      setHasMoreOlder(inboxMemoryCache.hasMoreOlder);
      setContacts(applyGrouping(allMsgsRef.current));
      setLastUpdated(new Date());
      setLoading(false);
      alertsReadyRef.current = true;
      fetchSince().then(startPolling);
    } else {
      console.log("[WA-inbox] Initial load: calling fetchAll()...");
      fetchAll().then(() => {
        console.log(`[WA-inbox] ✓ fetchAll complete — starting fallback polling every ${POLL_MS}ms`);
        startPolling();
      });
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        console.log("[WA-inbox] Cleared fallback polling on unmount");
      }
    };
  }, [fetchAll, fetchSince, applyGrouping]);

  // ── Write-through to the module-level cross-mount cache ──────────────────
  // Runs after every contacts update regardless of which mutation caused it
  // (fetch/merge/claim/dismiss/guest-edit all funnel through setContacts) —
  // centralizing here avoids touching every individual mutation call site.
  useEffect(() => {
    inboxMemoryCache.messages = allMsgsRef.current;
    inboxMemoryCache.lastSeenAt = lastSeenAt.current;
    inboxMemoryCache.oldestSeenAt = oldestSeenAtRef.current;
    inboxMemoryCache.hasMoreOlder = hasMoreOlder;
    inboxMemoryCache.hydratedPhones = [...hydratedPhonesRef.current];
  }, [contacts, hasMoreOlder]);

  // ── Fetch bot active status from bot_config ───────────────────────────────
  useEffect(() => {
    supabase
      .from("bot_config")
      .select("config_value")
      .eq("config_key", "bot_active")
      .maybeSingle()
      .then(({ data }) => {
        if (data) setBotActive(data.config_value !== "false");
      });
  }, []);

  // ── Toggle bot active flag ────────────────────────────────────────────────
  async function toggleBot() {
    setTogglingBot(true);
    const newVal = !botActive;
    await supabase
      .from("bot_config")
      .upsert({ config_key: "bot_active", config_value: String(newVal) }, { onConflict: "config_key" });
    setBotActive(newVal);
    setTogglingBot(false);
  }

  // ── Realtime subscription ─────────────────────────────────────────────────
  // Listens to INSERT + UPDATE on whatsapp_conversations.
  // On any event → fetchSince() (incremental, not full refetch).
  // subscribe() callback tracks connection status for the LIVE indicator.
  // NOTE: requires `whatsapp_conversations` in supabase_realtime publication
  // (migration 107) — otherwise this subscribes successfully but silently
  // never receives an event (same failure mode as guests migration 082).
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let reconnectTimer = null;
    let intentionalCleanup = false;

    function buildChannel() {
      console.log("[WA-inbox] Building Realtime channel for whatsapp_conversations...");
      const ch = supabase
        .channel("wa-inbox-rt-v2", { config: { broadcast: { self: true } } })
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "whatsapp_conversations",
          },
          (payload) => {
            console.log("[WA-inbox] ✅ Realtime INSERT received:", payload.new?.id, payload.new?.phone);
            const merged = mergeIncomingRows([payload.new]);
            if (!merged) fetchSince();
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "whatsapp_conversations",
          },
          (payload) => {
            console.log("[WA-inbox] ✅ Realtime UPDATE received:", payload.new?.id, payload.new?.phone);
            if (!payload.new?.id) return;
            allMsgsRef.current = allMsgsRef.current.map((m) =>
              m.id === payload.new.id ? { ...m, ...normalise(payload.new) } : m
            );
            setContacts(applyGrouping(allMsgsRef.current));
            setLastUpdated(new Date());
          }
        )
        .subscribe((status, err) => {
          const timestamp = new Date().toISOString().slice(11, 19);
          console.log(`[${timestamp}] [WA-inbox] Realtime channel status: ${status}${err ? " — " + err.message : ""}`);
          setRealtimeOk(status === "SUBSCRIBED");

          if (status === "SUBSCRIBED") {
            console.log("[WA-inbox] ✅ Realtime SUBSCRIBED — now listening for live updates");
          } else if (status === "CHANNEL_ERROR") {
            console.error("[WA-inbox] ❌ CHANNEL_ERROR:", err?.message ?? "unknown");
            if (!intentionalCleanup) {
              console.warn("[WA-inbox] Attempting reconnect in 2s...");
              supabase.removeChannel(ch);
              reconnectTimer = setTimeout(() => buildChannel(), 2000);
            }
          } else if (status === "TIMED_OUT") {
            console.warn("[WA-inbox] ⚠️ TIMED_OUT — will reconnect...");
            if (!intentionalCleanup) {
              supabase.removeChannel(ch);
              reconnectTimer = setTimeout(() => buildChannel(), 2000);
            }
          }
        });
      return ch;
    }

    const channel = buildChannel();
    return () => {
      intentionalCleanup = true;
      clearTimeout(reconnectTimer);
      supabase.removeChannel(channel);
    };
  }, [fetchSince, mergeIncomingRows, applyGrouping]);

  // ── Realtime subscription on `guests` — cross-tab claim/assignment sync ──
  // Deliberately a SEPARATE channel from wa-inbox-rt-v2 above (not folded
  // into the same .on() chain) so its reconnect logic stays untouched. A
  // guests-only UPDATE (e.g. another manager's claim/release, or a save from
  // the WordPress-style editor in a different tab) never inserts/updates a
  // whatsapp_conversations row, so the existing channel would never see it —
  // without this, claim state only ever synced on next refresh or unrelated
  // new-message poll. payload.new carries the full updated row regardless of
  // REPLICA IDENTITY (only `old`'s completeness depends on that), so
  // applyGuestRowUpdate can treat it as authoritative.
  // NOTE: requires `guests` to be added to the supabase_realtime publication
  // (migration 082) — otherwise this subscribes successfully but silently
  // never receives an event, the same failure mode migration 059 documented
  // for guest_alerts.
  useEffect(() => {
    const ch = supabase
      .channel("wa-inbox-guests-rt")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "guests" },
        (payload) => applyGuestRowUpdate(payload.new)
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [applyGuestRowUpdate]);

  // ── Re-fetch immediately when the browser tab becomes visible again ──────
  // Handles the common case where staff switch away and miss incoming messages.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") fetchSince();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchSince]);

  // ── Alert + one-shot sync when Realtime is down for 3s ─────────────────────
  // If realtime subscription is not SUBSCRIBED for >3s, trigger immediate sync
  // but DO NOT start an aggressive polling loop — rely on the 5s fallback polling.
  useEffect(() => {
    if (realtimeOk) {
      console.log("[WA-inbox] ✅ Realtime is healthy — no need for emergency sync");
      return;
    }
    const timer = setTimeout(() => {
      console.warn("[WA-inbox] ⚠️ Realtime not connected for 3s — triggering emergency sync...");
      fetchSince();
    }, 3000);
    return () => clearTimeout(timer);
  }, [realtimeOk, fetchSince]);

  // ── Auto-scroll to bottom of thread ─────────────────────────────────────
  // Moved below derived `thread` — scroll when active chat grows (realtime/poll).
  const activeContact   = contacts.find((c) => c.phone === active) ?? null;
  const thread          = activeContact?.messages ?? [];

  useEffect(() => {
    if (activeContact?.guestName) setNavGuestName(null);
  }, [activeContact?.guestName]);

  // Memoized on the specific primitive fields buildGuestResolveContext() reads
  // (not on `activeContact` itself, which groupByPhone rebuilds as a fresh
  // object on every regroup — including regroups triggered by an unrelated
  // guest's new message). This keeps resolveCtx's identity stable across
  // those unrelated updates, which is what lets React.memo(Bubble) above
  // actually skip re-rendering the whole open thread on every merge.
  const activeResolveCtx = useMemo(() => ({
    ...buildGuestResolveContext(activeContact),
    scriptsByKey,
    templatesByWaName,
  }), [activeContact?.guestName, activeContact?.pushName, activeContact?.room, activeContact?.portalToken, activeContact?.arrivalDate, activeContact?.spaTime, scriptsByKey, templatesByWaName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!active) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active, thread.length, lastUpdated]);

  // ── Manual Portal Link Dispatch ───────────────────────────────────────────
  // One-click, staff-initiated send of the standalone `manual_portal_link`
  // bot_scripts row (migration 124) — independent of automation_stages/cron.
  // {{GUEST_NAME}}/{{portal_url}} are resolved server-side (whatsapp-send
  // BRANCH F: manual_script), exactly like the automated stage_2_arrival flow
  // — never built client-side, so there's a single source of truth for the
  // portal URL (PORTAL_BASE_URL lives only in the Edge Function).
  async function sendManualPortalLink() {
    if (!active) return;
    if (!activeContact?.guestId) {
      setError("לא ניתן לשלוח קישור פורטל — השיחה הזו אינה משויכת לרשומת אורח (guests)");
      return;
    }
    if (!ensureCanSend()) {
      setError("שליחה חסומה בשעות שקט — סמן את האישור למטה");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("whatsapp-send", {
        body: { trigger: "manual_script", guestId: activeContact.guestId, scriptKey: "manual_portal_link" },
      });
      if (fnErr || !data?.ok) throw new Error(fnErr?.message ?? data?.error ?? "שגיאה בשליחת קישור הפורטל");
      setQuickOpen(false);
      await fetchSince();
    } catch (err) {
      setError(err?.message ?? "שגיאה בשליחת קישור הפורטל");
    } finally {
      setSending(false);
    }
  }

  // ── Manual reply send ─────────────────────────────────────────────────────
  async function sendManualReply() {
    if (!reply.trim() || !active) return;
    if (!ensureCanSend()) {
      setError("שליחה חסומה בשעות שקט — סמן את האישור למטה");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("whatsapp-send", {
        body: {
          trigger: "inbox_reply",
          phone: active,
          message: reply.trim(),
        },
      });
      if (fnErr || !data?.ok) throw new Error(fnErr?.message ?? data?.error ?? "שגיאה בשליחה");
      setReply("");
      await fetchSince();
    } catch (err) {
      setError(err?.message ?? "שגיאה בשליחה");
    } finally {
      setSending(false);
    }
  }

  // ── Derived state ──────────────────────────────────────────────────────────
  const visibleContacts = contacts.filter((c) => !archivedPhones.has(c.phone));
  const alertContacts = visibleContacts.filter((c) => c.humanRequested);
  // Contextual macros take over the quick-actions drawer when this guest has
  // usable metadata; otherwise fall back to the generic list so the drawer
  // never renders empty (Sprint 9.4, point 4).
  const contextualMacros = buildContextualMacros(activeContact);
  const isContextualQuickList = contextualMacros.length > 0;
  const unreadTotal     = contacts.reduce((sum, c) => {
    return sum + c.messages.filter((m) => m.direction === "inbound" && !m._read).length;
  }, 0);
  const aiLogEvents = thread.filter(
    (m) => m.direction === "inbound" && m.intent && INTENT_LABELS[lang][m.intent]
  );

  // ── Contact list pane — shared between the desktop two-pane layout and the
  // mobile "list" screen. ───────────────────────────────────────────────────
  const listPane = (
    <div style={{ height: "100%", overflowY: "auto", background: "var(--card-bg)" }}>
      <div style={{
        padding: "var(--space-sm) var(--space-md)", borderBottom: "1px solid var(--border)",
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-sm)",
        background: "var(--ivory)", position: "sticky", top: 0, zIndex: 1, flexWrap: "wrap",
      }}>
        <span style={{ fontWeight: 700, fontSize: 12, color: "var(--text-muted)" }}>
          {t.listCount(visibleContacts.length)}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginInlineStart: "auto" }}>
          {loading && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t.syncing}</span>}
          <button
            type="button"
            onClick={() => dismissAllAlerts(alertContacts)}
            disabled={dismissAllBusy || alertContacts.length === 0}
            title={alertContacts.length === 0 ? t.dismissAllNone : t.dismissAllAlerts}
            className={isMobile ? "u-touch-staff" : "u-badge-nowrap"}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "5px 10px", borderRadius: "var(--radius-pill)", fontSize: 11, fontWeight: 700,
              fontFamily: "Heebo, sans-serif",
              background: alertContacts.length === 0 ? "var(--ivory)" : "var(--ivory)",
              color: alertContacts.length === 0 ? "var(--text-muted)" : "var(--gold-dark)",
              border: `1px solid ${alertContacts.length === 0 ? "var(--border)" : "var(--border)"}`,
              cursor: dismissAllBusy || alertContacts.length === 0 ? "not-allowed" : "pointer",
              opacity: dismissAllBusy ? 0.7 : 1,
              whiteSpace: "nowrap",
              minHeight: isMobile ? HIT_STAFF : "auto",
            }}
          >
            {dismissAllBusy ? "⏳" : "✓"}
            {t.dismissAllAlerts}
            {alertContacts.length > 0 && !dismissAllBusy && (
              <span style={{
                background: "var(--gold, #C9A96E)", color: "#1A1A1A",
                borderRadius: 10, padding: "0 6px", fontSize: 10, fontWeight: 800,
              }}>
                {alertContacts.length}
              </span>
            )}
          </button>
        </div>
      </div>
      {loading && visibleContacts.length === 0 ? (
        <RosterSkeleton />
      ) : (
        <>
          {visibleContacts.length === 0 && (
            <div style={{ padding: "var(--space-lg)", textAlign: "center", color: "var(--text-muted)" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>{t.emptyIcon}</div>
              <div style={{ fontSize: 13 }}>{t.emptyBody}</div>
            </div>
          )}
          {visibleContacts.map((c) => (
            <ContactItem
              key={c.phone}
              contact={c}
              isActive={active === c.phone}
              isMobile={isMobile}
              t={t}
              dir={t.dir}
              scriptsByKey={scriptsByKey}
              templatesByWaName={templatesByWaName}
              onClick={openContact}
              onProfileClick={openGuestContextDrawer}
              onDismiss={dismissHumanRequest}
              onArchive={archiveContact}
            />
          ))}
          {hasMoreOlder && (
            <button
              type="button"
              onClick={fetchOlder}
              disabled={loadingOlder}
              style={{
                display: "block", width: "100%", padding: "var(--space-sm)",
                background: "var(--ivory)", border: "none", borderTop: "1px solid var(--border)",
                color: "var(--gold-dark, #A8843A)", fontSize: 12, fontWeight: 700,
                cursor: loadingOlder ? "not-allowed" : "pointer", opacity: loadingOlder ? 0.7 : 1,
              }}
            >
              {loadingOlder ? t.loadOlderBusy : t.loadOlder}
            </button>
          )}
        </>
      )}
    </div>
  );

  // ── Chat thread pane — shared between desktop and the mobile "thread"
  // screen. Back button only renders on mobile (desktop never hides the list).
  // ───────────────────────────────────────────────────────────────────────────
  const threadPane = !active ? (
    <div style={{
      height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--ivory)", color: "var(--text-muted)", flexDirection: "column", gap: "var(--space-sm)",
    }}>
      <div style={{ fontSize: 52 }}>{"💬"}</div>
      <div style={{ fontSize: 15 }}>{t.pickChat}</div>
    </div>
  ) : (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Thread header */}
      <div style={{
        padding: "var(--space-sm) var(--space-md)", borderBottom: "1px solid var(--border)",
        background: "var(--whatsapp-green)", color: "white",
        display: "flex", alignItems: "center", gap: "var(--space-sm)",
        flexShrink: 0,
      }}>
        {isMobile && (
          <button
            onClick={() => setMobileScreen("list")}
            aria-label={t.back}
            className="u-touch-comfort"
            style={{
              background: "none", border: "none", color: "white", fontSize: 20,
              cursor: "pointer", padding: 0,
            }}
          >
            {t.dir === "rtl" ? "→" : "←"}
          </button>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {displayName(activeContact ?? (active ? { phone: active, guestName: navGuestName } : null))}
          </div>
          {(activeContact?.guestName || activeContact?.pushName || navGuestName) && (
            <div style={{ fontSize: 11, opacity: 0.75, direction: "ltr", marginTop: 1 }}>
              {active}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {activeContact?.spaTime && (
            <div className="u-badge-nowrap" style={{
              fontSize: 11, fontWeight: 700, background: "rgba(255,255,255,0.2)",
              padding: "3px 8px", borderRadius: "var(--radius-md)",
            }}>
              💆 {t.spa} {activeContact.spaTime}
            </div>
          )}
          {/* Claim / take-over — icon-only with a title tooltip to stay compact
              on mobile (same header row already holds back-button+name+spa
              chip+AI-log button). Never hidden/disabled per §0.2 — relabels
              instead: 🙋 unclaimed → 🔁 take-over from someone else → ✓ yours. */}
          {activeContact && (
            <button
              onClick={() => setClaim(activeContact, activeContact.claimedBy !== user?.id)}
              disabled={claimBusy}
              title={
                activeContact.claimedBy === user?.id ? t.claimedByMe
                : activeContact.claimedBy ? t.claimedBadge(activeContact.claimedByName ?? "—")
                : t.claimChat
              }
              style={{
                background: activeContact.claimedBy === user?.id ? "rgba(37,211,102,0.3)" : "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.35)", color: "white",
                borderRadius: "var(--radius-sm)", fontSize: 13, cursor: claimBusy ? "not-allowed" : "pointer",
                padding: "6px 10px", minHeight: isMobile ? HIT_STAFF : "auto", minWidth: isMobile ? HIT_STAFF : "auto",
                opacity: claimBusy ? 0.6 : 1,
              }}
            >
              {claimBusy ? "⏳" : activeContact.claimedBy === user?.id ? "✓" : activeContact.claimedBy ? "🔁" : "🙋"}
            </button>
          )}
          <button
            onClick={() => activeContact && openGuestEditor(activeContact)}
            disabled={editGuestLoading}
            title={t.editGuest}
            style={{
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.35)", color: "white",
              borderRadius: "var(--radius-sm)", fontSize: 13, cursor: editGuestLoading ? "not-allowed" : "pointer",
              padding: "6px 10px", minHeight: isMobile ? HIT_STAFF : "auto", minWidth: isMobile ? HIT_STAFF : "auto",
              opacity: editGuestLoading ? 0.6 : 1,
            }}
          >
            {editGuestLoading ? "⏳" : "✏️"}
          </button>
          <button
            onClick={() => setDrawerOpen((o) => !o)}
            title={t.aiLogHint}
            style={{
              background: drawerOpen ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.35)", color: "white",
              borderRadius: "var(--radius-sm)", fontSize: 11, fontWeight: 700, cursor: "pointer",
              padding: "6px 10px", minHeight: isMobile ? HIT_STAFF : "auto", whiteSpace: "nowrap",
            }}
          >
            {t.aiLog}
          </button>
        </div>
      </div>

      {/* AI log drawer — internal classification metadata, fully isolated from
          the guest-visible message stream below. Sourced entirely from the
          `intent` field whatsapp-webhook already writes per inbound message;
          no fabricated data, no new logging table. */}
      {drawerOpen && (
        <div style={{
          background: "var(--black-soft, #2C2C2C)", color: "#C8C8C8",
          padding: "10px 16px", borderBottom: "1px solid #444",
          flexShrink: 0, maxHeight: 130, overflowY: "auto",
        }}>
          <div style={{ fontSize: 10, opacity: 0.65, marginBottom: 6 }}>{t.aiLogHint}</div>
          {aiLogEvents.length === 0 ? (
            <div style={{ fontSize: 12, fontFamily: "monospace" }}>{t.aiLogEmpty}</div>
          ) : aiLogEvents.map((m) => (
            <div key={m.id} style={{ fontSize: 12, fontFamily: "monospace", lineHeight: 1.7 }}>
              {formatTime(m.created_at)} · {INTENT_LABELS[lang][m.intent]}
            </div>
          ))}
        </div>
      )}

      {activeContact?.claimedBy && (
        <div style={{
          flexShrink: 0,
          padding: "8px 16px",
          background: activeContact.claimedBy === user?.id ? "rgba(37,211,102,0.15)" : "rgba(255,193,7,0.15)",
          borderBottom: "1px solid rgba(0,0,0,0.08)",
          fontSize: 13,
          fontWeight: 700,
          color: "var(--black)",
        }}>
          {activeContact.claimedBy === user?.id
            ? "🔇 הבוט מושתק — את/ה מנהל/ת את השיחה. לחץ ✓ לשחרור והפעלת הבוט."
            : `🔇 הבוט מושתק — ${activeContact.claimedByName ?? "צוות"} מטפל/ת בשיחה.`}
        </div>
      )}

      {/* Messages */}
      <div style={{
        flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 20px",
        background: "#E5DDD5", display: "flex", flexDirection: "column", gap: 6,
      }}>
        {loadingThread && thread.length === 0 ? (
          <ThreadSkeleton dir={t.dir} />
        ) : (
          <>
            {thread.map((msg) => (
              <Bubble
                key={msg.id}
                msg={msg}
                dir={t.dir}
                resolveCtx={activeResolveCtx}
              />
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {error && (
        <div style={{ padding: "6px 16px", background: "var(--status-danger-bg)", color: "var(--status-danger)", fontSize: 12, flexShrink: 0 }}>
          {"⚠️"} {error}
        </div>
      )}

      {/* Quick actions + reply input — sticky on mobile so bar stays above keyboard/safe area */}
      <div style={{
        position: "relative", flexShrink: 0,
        ...(isMobile ? {
          position: "sticky", bottom: 0, zIndex: 2,
          paddingBottom: "max(env(safe-area-inset-bottom, 0px), var(--space-xs))",
        } : {}),
      }}>
        {quickOpen && (
          <div style={{
            position: "absolute", bottom: "100%", insetInlineStart: 14, insetInlineEnd: 14,
            marginBottom: 6, background: "white", border: "1px solid #ddd", borderRadius: 14,
            padding: 12, boxShadow: "0 -4px 16px rgba(0,0,0,0.12)",
            maxHeight: "70vh", overflowY: "auto",
          }}>
            {/* Manual Portal Link Dispatch — always visible (Disable Don't Hide,
                CLAUDE.md §0.2), disabled with an explanatory title when this
                thread isn't linked to a guests row. One click, no textarea —
                server resolves {{GUEST_NAME}}/{{portal_url}} and sends immediately. */}
            <div style={{ marginBottom: 10 }}>
              <button
                onClick={sendManualPortalLink}
                disabled={sending || !activeContact?.guestId}
                title={!activeContact?.guestId ? "השיחה הזו אינה משויכת לרשומת אורח (guests)" : undefined}
                style={{
                  padding: "8px 14px", borderRadius: 20, border: "1.5px solid var(--gold,#C9A96E)",
                  background: !activeContact?.guestId ? "#F3F0EA" : "linear-gradient(135deg, #FFF8E8, #FDF2D8)",
                  color: "var(--gold-dark,#A8843A)", fontSize: 12, fontWeight: 700,
                  cursor: (sending || !activeContact?.guestId) ? "not-allowed" : "pointer",
                  minHeight: isMobile ? HIT_STAFF : "auto",
                }}
              >
                🔗 שלח קישור לפורטל האורחים
              </button>
            </div>

            {/* Contextual macros — zero-token, data-driven (spa_time/meal_time/
                room). Shown only when this guest actually has that metadata;
                no longer falls back to the old generic QUICK_PHRASES list with
                literal {{שם}} placeholders — that's what the AI button below replaces. */}
            {isContextualQuickList && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#555", marginBottom: 6, textTransform: "uppercase" }}>
                  {t.contextualMacrosTitle}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  {contextualMacros.map((ph, i) => (
                    <button
                      key={i}
                      onClick={() => { setReply(ph.text); setQuickOpen(false); }}
                      style={{
                        padding: "6px 12px", borderRadius: 20, border: "1.5px solid var(--gold,#C9A96E)",
                        background: "linear-gradient(135deg, #FFF8E8, #FDF2D8)", color: "var(--gold-dark,#A8843A)",
                        fontSize: 12, fontWeight: 700, cursor: "pointer", minHeight: isMobile ? HIT_STAFF : "auto",
                      }}
                    >
                      {ph.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* On-demand AI suggestions (Sprint 1) — never auto-generated on
                chat selection, only on explicit click (token-saving by design). */}
            <div style={{ fontSize: 11, fontWeight: 700, color: "#555", marginBottom: 6, textTransform: "uppercase" }}>
              {t.aiSuggestTitle}
            </div>
            <div style={{ marginBottom: 10 }}>
              {!aiSuggestions ? (
                <button
                  onClick={generateAiSuggestions}
                  disabled={aiSuggesting || !activeContact}
                  style={{
                    padding: "8px 14px", borderRadius: 20, border: "1.5px solid var(--gold,#C9A96E)",
                    background: aiSuggesting ? "#F3F0EA" : "linear-gradient(135deg, #FFF8E8, #FDF2D8)",
                    color: "var(--gold-dark,#A8843A)", fontSize: 12, fontWeight: 700,
                    cursor: aiSuggesting ? "not-allowed" : "pointer", minHeight: isMobile ? HIT_STAFF : "auto",
                  }}
                >
                  {aiSuggesting ? t.aiSuggestLoading : t.aiSuggestButton}
                </button>
              ) : (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {aiSuggestions.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => { setReply(s); setQuickOpen(false); }}
                        style={{
                          textAlign: "start", padding: "8px 12px", borderRadius: 12,
                          border: "1.5px solid var(--gold,#C9A96E)",
                          background: "linear-gradient(135deg, #FFF8E8, #FDF2D8)",
                          color: "#3a2e10", fontSize: 12, fontWeight: 600, lineHeight: 1.5,
                          cursor: "pointer", minHeight: isMobile ? HIT_STAFF : "auto",
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={generateAiSuggestions}
                    disabled={aiSuggesting}
                    style={{
                      marginTop: 6, padding: "5px 10px", borderRadius: 14, border: "1px solid #E0D5C5",
                      background: "transparent", color: "#777", fontSize: 11, fontWeight: 600,
                      cursor: aiSuggesting ? "not-allowed" : "pointer",
                    }}
                  >
                    {aiSuggesting ? t.aiSuggestLoading : t.aiSuggestRetry}
                  </button>
                </>
              )}
              {aiSuggestError && (
                <div style={{ marginTop: 6, fontSize: 11, color: "#C0392B" }}>
                  {t.aiSuggestErrorPrefix} {aiSuggestError}
                </div>
              )}
            </div>

            {/* Smart task routing (Sprint 2) — clicking a department no longer
                instantly dispatches the guest's raw last message as the ticket;
                it opens a sub-category + free-text picker first. */}
            {!routeDraft ? (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#555", marginBottom: 6, textTransform: "uppercase" }}>
                  {t.routeTitle}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => setRouteDraft({ category: "maintenance", subCategory: null, note: "" })}
                    style={{
                      flex: 1, padding: "8px 10px", borderRadius: 10, border: "1.5px solid #E0D5C5",
                      background: "#FAFAFA", color: "#444", fontSize: 12, fontWeight: 700,
                      cursor: "pointer", minHeight: isMobile ? HIT_STAFF : "auto",
                    }}
                  >{t.routeMaint}</button>
                  <button
                    onClick={() => setRouteDraft({ category: "housekeeping", subCategory: null, note: "" })}
                    style={{
                      flex: 1, padding: "8px 10px", borderRadius: 10, border: "1.5px solid #E0D5C5",
                      background: "#FAFAFA", color: "#444", fontSize: 12, fontWeight: 700,
                      cursor: "pointer", minHeight: isMobile ? HIT_STAFF : "auto",
                    }}
                  >{t.routeHouse}</button>
                </div>
              </>
            ) : (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#555", marginBottom: 4, textTransform: "uppercase" }}>
                  {routeDraft.category === "maintenance" ? t.routeMaint : t.routeHouse}
                </div>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>{t.routeSubtitle}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                  {TASK_SUBCATEGORIES[routeDraft.category].map((sc) => {
                    const selected = routeDraft.subCategory === sc.id;
                    return (
                      <button
                        key={sc.id}
                        onClick={() => setRouteDraft((d) => ({ ...d, subCategory: selected ? null : sc.id }))}
                        style={{
                          padding: "6px 12px", borderRadius: 20, border: "1.5px solid",
                          borderColor: selected ? "var(--gold,#C9A96E)" : "#E0D5C5",
                          background: selected ? "linear-gradient(135deg, #FFF8E8, #FDF2D8)" : "#FAFAFA",
                          color: selected ? "var(--gold-dark,#A8843A)" : "#444",
                          fontSize: 12, fontWeight: 700, cursor: "pointer", minHeight: isMobile ? HIT_STAFF : "auto",
                        }}
                      >
                        {sc.label}
                      </button>
                    );
                  })}
                </div>
                <input
                  type="text"
                  value={routeDraft.note}
                  onChange={(e) => setRouteDraft((d) => ({ ...d, note: e.target.value }))}
                  placeholder={t.routeNotePlaceholder}
                  style={{
                    width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 10,
                    border: "1px solid #ddd", fontSize: 13, fontFamily: "inherit", direction: "rtl",
                    marginBottom: 8,
                  }}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => setRouteDraft(null)}
                    style={{
                      flex: 1, padding: "8px 10px", borderRadius: 10, border: "1px solid #E0D5C5",
                      background: "transparent", color: "#777", fontSize: 12, fontWeight: 600,
                      cursor: "pointer", minHeight: isMobile ? HIT_STAFF : "auto",
                    }}
                  >{t.routeCancel}</button>
                  <button
                    onClick={() => routeTask(
                      routeDraft.category, activeContact,
                      routeDraft.subCategory ? TASK_SUBCATEGORIES[routeDraft.category].find((sc) => sc.id === routeDraft.subCategory)?.label : null,
                      routeDraft.note
                    )}
                    disabled={!routeDraft.subCategory && !routeDraft.note.trim()}
                    title={!routeDraft.subCategory && !routeDraft.note.trim() ? t.routeSubtitle : undefined}
                    style={{
                      flex: 2, padding: "8px 10px", borderRadius: 10, border: "none",
                      background: (!routeDraft.subCategory && !routeDraft.note.trim()) ? "#E5E7EB" : "var(--gold,#C9A96E)",
                      color: (!routeDraft.subCategory && !routeDraft.note.trim()) ? "#9CA3AF" : "#1A1A1A",
                      fontSize: 12, fontWeight: 800,
                      cursor: (!routeDraft.subCategory && !routeDraft.note.trim()) ? "not-allowed" : "pointer",
                      minHeight: isMobile ? HIT_STAFF : "auto",
                    }}
                  >{t.routeDispatch}</button>
                </div>
              </div>
            )}
          </div>
        )}

        {routeToast && (
          <div style={{
            position: "absolute", bottom: "100%", insetInlineStart: 14, insetInlineEnd: 14,
            marginBottom: 6, background: "#1F2937", color: "white",
            fontSize: 12, fontWeight: 600, borderRadius: 10, padding: "8px 14px",
          }}>
            {routeToast}
          </div>
        )}

        {quietActive && (
          <div style={{ padding: "8px 14px 0", background: "var(--ivory)" }}>
            <QuietHoursGate
              active={quietActive}
              checked={overrideChecked}
              onChange={setOverrideChecked}
              compact
            />
          </div>
        )}

        <div style={{
          padding: "var(--space-sm) var(--space-md)",
          borderTop: quietActive ? "none" : "1px solid var(--border)",
          background: "var(--ivory)", display: "flex", gap: "var(--space-sm)", alignItems: "flex-end",
        }}>
          <button
            onClick={() => setQuickOpen((o) => !o)}
            aria-label={t.quickRepliesTitle}
            className={isMobile ? "u-touch-comfort" : undefined}
            style={{
              background: quickOpen ? "var(--border)" : "var(--card-bg)",
              border: "1px solid var(--border)", borderRadius: "50%",
              width: isMobile ? HIT_COMFORT : 40, height: isMobile ? HIT_COMFORT : 40, fontSize: 17,
              cursor: "pointer", flexShrink: 0, display: "flex",
              alignItems: "center", justifyContent: "center",
            }}
          >
            {t.quickBolt}
          </button>
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendManualReply(); }
            }}
            placeholder={t.inputPh}
            rows={2}
            style={{
              flex: 1, resize: "none", borderRadius: "var(--radius-pill)",
              border: "1px solid var(--border)", padding: "10px 16px",
              fontSize: 14, fontFamily: "Heebo, sans-serif",
              outline: "none", lineHeight: 1.5, background: "var(--card-bg)",
              minHeight: isMobile ? HIT_COMFORT : "auto",
            }}
          />
          <button
            onClick={sendManualReply}
            disabled={sending || !reply.trim() || !canSend}
            title={!canSend ? "שליחה חסומה בשעות שקט" : undefined}
            className={isMobile ? "u-touch-comfort" : undefined}
            style={{
              background: (sending || !reply.trim() || !canSend) ? "var(--text-muted)" : "var(--whatsapp-green)",
              color: "white", border: "none", borderRadius: "50%",
              width: isMobile ? HIT_COMFORT : 44, height: isMobile ? HIT_COMFORT : 44, fontSize: 20,
              cursor: (sending || !reply.trim() || !canSend) ? "not-allowed" : "pointer",
              flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
              opacity: (sending || !reply.trim() || !canSend) ? 0.5 : 1,
            }}
          >
            {sending ? "⏳" : "➤"}
          </button>
        </div>
      </div>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  // Mobile slide track is forced dir="ltr" so child order (list, thread) is a
  // fixed physical layout regardless of UI language — only the translateX
  // sign flips by t.dir, so "forward" always feels native to the active
  // language (mirrors the approved mockup behaviour 1:1).
  const slideOpenTransform = t.dir === "rtl" ? "translateX(50%)" : "translateX(-50%)";

  return (
    <div dir={t.dir} style={{ display: "flex", flexDirection: "column", height: "calc(100vh - var(--safe-bottom-nav, 80px))", overflow: "hidden", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", boxShadow: "var(--shadow-md)" }}>
      <style>{`
        @keyframes wa-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(1.4); }
        }
        @keyframes wa-shimmer {
          0%   { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .wa-skel-bar {
          background: linear-gradient(90deg, var(--border) 25%, var(--ivory) 50%, var(--border) 75%);
          background-size: 400% 100%;
          animation: wa-shimmer 1.4s ease-in-out infinite;
          border-radius: 6px;
        }
        .u-guest-name-link:hover { text-decoration: underline; }
      `}</style>

      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "var(--space-sm) var(--space-md)", background: "var(--whatsapp-green-dark)", color: "white", flexShrink: 0,
        borderRadius: "var(--radius-md) var(--radius-md) 0 0", gap: "var(--space-sm)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 10, minWidth: 0, overflow: "hidden" }}>
          <span style={{ fontWeight: 800, fontSize: 15, whiteSpace: "nowrap" }}>
            {isMobile ? "💬 DREAM BOT" : t.brand}
          </span>
          {unreadTotal > 0 && (
            <span className="u-badge-nowrap" style={{
              background: "var(--whatsapp-green)", color: "white", borderRadius: "var(--radius-pill)",
              fontSize: 11, fontWeight: 800, padding: "2px 8px",
            }}>{isMobile ? unreadTotal : t.newMsgs(unreadTotal)}</span>
          )}
          {/* ── LIVE indicator ── */}
          <span style={{
            display: "flex", alignItems: "center", gap: 5,
            background: realtimeOk ? "rgba(37,211,102,0.18)" : "rgba(255,255,255,0.10)",
            border: `1px solid ${realtimeOk ? "rgba(37,211,102,0.5)" : "rgba(255,255,255,0.25)"}`,
            borderRadius: 20, padding: isMobile ? "3px 6px" : "3px 9px",
            fontSize: 10, fontWeight: 700, letterSpacing: 0.5, whiteSpace: "nowrap",
            color: realtimeOk ? "#7EFFA0" : "rgba(255,255,255,0.55)",
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: realtimeOk ? "var(--whatsapp-green)" : "var(--status-warning)",
              display: "inline-block",
              animation: realtimeOk ? "wa-pulse 2s ease-in-out infinite" : "none",
            }} />
            {!isMobile && (realtimeOk ? t.live : t.connecting)}
          </span>
          {lastUpdated && !isMobile && (
            <span style={{ fontSize: 10, opacity: 0.5, whiteSpace: "nowrap" }}>
              {lastUpdated.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: isMobile ? 4 : 8, alignItems: "center", flexShrink: 0 }}>
          <AILearningButton module="chat" />
          <button
            onClick={() => setLang((l) => (l === "he" ? "en" : "he"))}
            title="EN / HE"
            className={isMobile ? "u-touch-staff" : undefined}
            style={{
              padding: isMobile ? "0" : "5px 12px", borderRadius: "var(--radius-pill)", fontSize: 12, fontWeight: 700,
              border: "1.5px solid rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.12)",
              color: "white", cursor: "pointer",
              width: isMobile ? HIT_STAFF : "auto", height: isMobile ? HIT_STAFF : "auto",
            }}
          >
            {isMobile ? "🌐" : `🌐 ${t.langSwap}`}
          </button>
          <HoldToConfirmButton
            onConfirm={toggleBot}
            disabled={togglingBot}
            title={botActive ? t.botOn : t.botOff}
            progressColor={botActive ? "rgba(220,38,38,0.35)" : "rgba(37,211,102,0.35)"}
            style={{
              padding: isMobile ? "0" : "5px 14px", borderRadius: "var(--radius-pill)", fontSize: 12, fontWeight: 700,
              border: "1.5px solid rgba(255,255,255,0.4)",
              background: botActive ? "rgba(37,211,102,0.25)" : "rgba(255,255,255,0.12)",
              color: "white", cursor: togglingBot ? "not-allowed" : "pointer",
              width: isMobile ? HIT_STAFF : "auto", height: isMobile ? HIT_STAFF : "auto", whiteSpace: "nowrap",
              fontFamily: "Heebo, sans-serif",
            }}
          >
            {isMobile ? (togglingBot ? "⏳" : botActive ? "🤖" : "😴") : (togglingBot ? "⏳" : botActive ? t.botOn : t.botOff)}
          </HoldToConfirmButton>
          <button
            onClick={() => setShowNewChat(true)}
            title={t.newChat}
            className={isMobile ? "u-touch-staff" : undefined}
            style={{
              padding: isMobile ? "0" : "5px 14px", borderRadius: "var(--radius-pill)", fontSize: 12, fontWeight: 700,
              background: "white", color: "var(--whatsapp-green-dark)", border: "none", cursor: "pointer",
              width: isMobile ? HIT_STAFF : "auto", height: isMobile ? HIT_STAFF : "auto",
            }}
          >
            {isMobile ? "✉️" : t.newChat}
          </button>
        </div>
      </div>

      {routeToast && (
        <div style={{
          padding: "8px 16px", background: "var(--status-success-bg)", color: "var(--status-success)",
          fontSize: 12, fontWeight: 700, flexShrink: 0, borderBottom: "1px solid var(--status-success-bg)",
        }}>
          {routeToast}
        </div>
      )}

      {/* Body */}
      {isMobile ? (
        <div style={{ flex: 1, overflow: "hidden" }}>
          <div dir="ltr" style={{
            display: "flex", width: "200%", height: "100%",
            transform: mobileScreen === "thread" ? slideOpenTransform : "translateX(0%)",
            transition: "transform 0.28s ease",
          }}>
            <div style={{ width: "50%", flexShrink: 0, overflow: "hidden", borderInlineEnd: "1px solid #e0e0e0" }}>
              {listPane}
            </div>
            <div style={{ width: "50%", flexShrink: 0, overflow: "hidden" }}>
              {threadPane}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div style={{ width: 290, borderInlineEnd: "1px solid #e0e0e0", flexShrink: 0, overflow: "hidden" }}>
            {listPane}
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            {threadPane}
          </div>
        </div>
      )}

      {/* New Chat Modal */}
      {showNewChat && (
        <NewChatModal
          onClose={() => setShowNewChat(false)}
          onSent={() => { setShowNewChat(false); setTimeout(fetchAll, 600); }}
        />
      )}

      {/* WordPress-style guest editor — right-docked drawer so the thread
          stays visible behind it (§ Session 9 Sprint 9.1). Reuses
          AddGuestModal as the single source of truth for the guest form
          (§0.4/§0.5) instead of a second parallel edit UI. */}
      {editGuestTarget && (
        <AddGuestModal
          guest={editGuestTarget}
          dock="right"
          onClose={() => setEditGuestTarget(null)}
          onSaved={handleGuestSaved}
          showToast={(kind, msg) => {
            if (kind === "err") { setError(msg); return; }
            setRouteToast(msg);
            setTimeout(() => setRouteToast(null), 3500);
          }}
        />
      )}

      {selectedGuestProfile && (
        <GuestContextDrawer
          contact={selectedGuestProfile}
          user={user}
          claimedByName={selectedGuestProfile.claimedByName ?? null}
          claimBusy={claimBusy}
          onClose={() => setSelectedGuestProfile(null)}
          onGuestUpdated={applyGuestRowUpdate}
          onToggleClaim={setClaim}
        />
      )}
    </div>
  );
}
