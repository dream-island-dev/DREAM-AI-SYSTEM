// src/utils/auth.js
// Central RBAC helper — Dream Island XOS.
// Use canPerform(action, user) everywhere to gate UI and operations by role.
// Roles resolve from the same email/role logic as admin.js — no duplication.

import { isAdminUser, isSuperAdmin } from "./admin";

// ── Role resolution ──────────────────────────────────────────────────────────
// Priority: super_admin > admin > manager > receptionist > staff
export function getRole(user) {
  if (!user) return "staff";
  if (isSuperAdmin(user)) return "super_admin";
  if (isAdminUser(user))  return "admin";
  if (user.role === "manager") return "manager";
  if (user.role === "receptionist") return "receptionist";
  return "staff";
}

export function isReceptionist(user) {
  return user?.role === "receptionist";
}

/** Receptionist-focused sidebar — core front-desk routes only. */
export const RECEPTIONIST_FOCUS_NAV_IDS = new Set([
  "dashboard",
  "wa_inbox",
  "guests",
  "vip_guests",
  "requests_board",
  "ops_board",
  "feedback_dashboard",
  "data_sync",
  "voucher_reconciliation",
]);

export function filterNavItemsForUser(items, user) {
  if (!isReceptionist(user)) return items;
  return items.filter((item) => RECEPTIONIST_FOCUS_NAV_IDS.has(item.id));
}

// ── Permissions matrix ───────────────────────────────────────────────────────
const PERMISSIONS = {
  add_employee:     ["manager", "admin", "super_admin"],
  edit_employee:    ["manager", "admin", "super_admin"],
  delete_employee:  ["admin",   "super_admin"],
  manage_bot:       ["admin",   "super_admin"],
  view_admin_panel: ["admin",   "super_admin"],
  manage_users:     ["super_admin"],
  create_ops_task:  ["manager", "admin", "super_admin", "receptionist"],
  view_data_sync:   ["admin",   "super_admin", "receptionist"],
  view_vouchers:    ["admin",   "super_admin", "receptionist"],
};

// ── Route guards (App.js switch / guardPage) ─────────────────────────────────
const ROUTE_ACCESS = {
  admin:                  ["admin", "super_admin"],
  admin_updates:          ["admin", "super_admin"],
  bot_config:             ["admin", "super_admin"],
  bot_settings:           ["admin", "super_admin"],
  bot_scripts:            ["admin", "super_admin"],
  automation_center:      ["admin", "super_admin"],
  executive_playbook:     ["super_admin"],
  portal_settings:        ["admin", "super_admin"],
  cms_security:           ["admin", "super_admin"],
  users_mgmt:             ["super_admin"],
  data_sync:              ["admin", "super_admin", "receptionist"],
  voucher_reconciliation: ["admin", "super_admin", "receptionist"],
  routing_control_center: ["admin", "super_admin"],
};

/** Orit CS Agent — super_admin always; others only if flagged in User Management (סוכן אורית ✓). */
export function canAccessOritCsAgent(user) {
  if (!user) return false;
  if (isSuperAdmin(user)) return true;
  return user.orit_cs_agent_access === true;
}

// ── Main gate ────────────────────────────────────────────────────────────────
export function canPerform(action, user) {
  const role = getRole(user);
  return (PERMISSIONS[action] ?? []).includes(role);
}

/** Sidebar nav visibility — staff sees open items; receptionist also gets receptionistOk. */
export function canSeeNavItem(item, user) {
  if (!user) return false;
  if (item.oritCsAgentOnly) return canAccessOritCsAgent(user);
  if (isSuperAdmin(user) || isAdminUser(user) || user.role === "manager") return true;
  if (user.role === "receptionist") {
    return !item.managerOnly || item.receptionistOk === true;
  }
  return !item.managerOnly;
}

/** App.js guardPage helper — returns true when user may render the route. */
export function canAccessRoute(routeId, user) {
  if (!user) return false;
  if (routeId === "orit_cs_agent") return canAccessOritCsAgent(user);
  const allowed = ROUTE_ACCESS[routeId];
  if (!allowed) return true;
  const role = getRole(user);
  return allowed.includes(role);
}
