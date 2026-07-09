// Inbox read-cursor + recent-activity roster helpers (WhatsAppInbox).
// Pure functions — no Supabase calls.

import { isGuestReactionRow } from "./inboxReactions";

/** Contacts with a message in this window appear in the pinned «פעילות אחרונה» section. */
export const INBOX_RECENT_ACTIVITY_MS = 24 * 60 * 60 * 1000;

export function contactLastMessageAt(contact) {
  const last = contact?.messages?.[contact.messages.length - 1];
  return last?.created_at ?? null;
}

export function isRecentlyActive(contact, nowMs = Date.now(), windowMs = INBOX_RECENT_ACTIVITY_MS) {
  const at = contactLastMessageAt(contact);
  if (!at) return false;
  const ts = new Date(at).getTime();
  return Number.isFinite(ts) && nowMs - ts < windowMs;
}

/**
 * Inbound unread for one staff member:
 * - After read cursor: inbound with created_at strictly after last_read_at
 * - Fallback (no cursor): local _read flag + legacy «no outbound after» guard
 */
export function countUnreadInbound(messages, readCursorAt = null) {
  if (!messages?.length) return 0;
  const cursorTs = readCursorAt ? new Date(readCursorAt).getTime() : null;
  let n = 0;
  for (const m of messages) {
    if (m.direction !== "inbound" || isGuestReactionRow(m)) continue;
    if (cursorTs != null && Number.isFinite(cursorTs)) {
      const msgTs = new Date(m.created_at).getTime();
      if (Number.isFinite(msgTs) && msgTs > cursorTs) n++;
      continue;
    }
    if (m._read) continue;
    const answered = messages.some(
      (o) => o.direction === "outbound" && o.created_at > m.created_at,
    );
    if (!answered) n++;
  }
  return n;
}

/** Merge DB cursor into local _read flags (optimistic UI + refresh survival). */
export function applyReadCursorToMessages(messages, readCursorAt) {
  if (!readCursorAt || !messages?.length) return messages;
  const cursorTs = new Date(readCursorAt).getTime();
  if (!Number.isFinite(cursorTs)) return messages;
  return messages.map((m) => {
    if (m.direction !== "inbound" || m._read) return m;
    const msgTs = new Date(m.created_at).getTime();
    if (Number.isFinite(msgTs) && msgTs <= cursorTs) return { ...m, _read: true };
    return m;
  });
}

/** Apply all staff read cursors to a flat message list (post-fetch / post-load). */
export function applyAllReadCursors(rows, readCursorsByPhone) {
  if (!rows?.length || !readCursorsByPhone?.size) return rows ?? [];
  return rows.map((m) => {
    const key = m.threadKey ?? `${m.phone}::${m.inbox_channel ?? "meta"}`;
    const cursor = readCursorsByPhone.get(key);
    if (!cursor || m.direction !== "inbound" || m._read) return m;
    const msgTs = new Date(m.created_at).getTime();
    const cursorTs = new Date(cursor).getTime();
    if (Number.isFinite(msgTs) && Number.isFinite(cursorTs) && msgTs <= cursorTs) {
      return { ...m, _read: true };
    }
    return m;
  });
}

/**
 * Recent conversations (24h) always float to the top — regardless of segment filter
 * or secondary sort mode (Mike: oversight without hunting).
 */
export function sortContactsRecentFirst(contacts, sortMode, sortRosterContactsFn) {
  const recent = contacts.filter((c) => isRecentlyActive(c));
  const recentKeys = new Set(recent.map((c) => c.threadKey ?? `${c.phone}::${c.inbox_channel ?? "meta"}`));
  const rest = contacts.filter((c) => !recentKeys.has(c.threadKey ?? `${c.phone}::${c.inbox_channel ?? "meta"}`));
  return [
    ...sortRosterContactsFn(recent, "activity"),
    ...sortRosterContactsFn(rest, sortMode),
  ];
}

export function contactUnreadCount(contact, readCursorsByPhone) {
  const key = contact.threadKey ?? `${contact.phone}::${contact.inbox_channel ?? "meta"}`;
  const cursor = readCursorsByPhone?.get?.(key) ?? null;
  return countUnreadInbound(contact.messages, cursor);
}

/**
 * «הכל» roster: pinned recent section first (cross-segment), then segment buckets
 * for contacts without recent activity. Recent contacts are deduped from below.
 */
export function buildGroupedRosterSections(contacts, sortMode, lang, options = {}) {
  const {
    getInboxRosterSegmentMeta,
    INBOX_ROSTER_SEGMENT_ORDER,
    classifyInboxContactSegment,
    sortRosterContacts,
    recentWindowMs = INBOX_RECENT_ACTIVITY_MS,
    nowMs = Date.now(),
  } = options;

  const recent = contacts.filter((c) => isRecentlyActive(c, nowMs, recentWindowMs));
  const recentKeys = new Set(recent.map((c) => c.threadKey ?? `${c.phone}::${c.inbox_channel ?? "meta"}`));
  const rest = contacts.filter((c) => !recentKeys.has(c.threadKey ?? `${c.phone}::${c.inbox_channel ?? "meta"}`));

  const sections = [];

  if (recent.length) {
    sections.push({
      key: "recent",
      label: lang === "en" ? "🕐 Recent activity" : "🕐 פעילות אחרונה",
      hint: lang === "en" ? "Last 24 hours — all guests" : "24 שעות אחרונות — כל האורחים",
      contacts: sortRosterContacts(recent, "activity"),
    });
  }

  const alerts = rest.filter((c) => c.humanRequested);
  const nonAlerts = rest.filter((c) => !c.humanRequested);

  if (alerts.length) {
    const meta = getInboxRosterSegmentMeta("alerts", lang);
    sections.push({
      key: "alerts",
      ...meta,
      contacts: sortRosterContacts(alerts, sortMode),
    });
  }

  for (const seg of INBOX_ROSTER_SEGMENT_ORDER) {
    const inSeg = nonAlerts.filter((c) => classifyInboxContactSegment(c) === seg);
    if (!inSeg.length) continue;
    sections.push({
      key: seg,
      ...getInboxRosterSegmentMeta(seg, lang),
      contacts: sortRosterContacts(inSeg, sortMode),
    });
  }

  return sections;
}
