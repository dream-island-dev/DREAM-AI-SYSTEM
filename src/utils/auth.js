// src/utils/auth.js
// Central RBAC helper — Dream Island XOS.
// Use canPerform(action, user) everywhere to gate UI and operations by role.
// Roles resolve from the same email/role logic as admin.js — no duplication.

import { isAdminUser, isSuperAdmin } from "./admin";

// ── Role resolution ──────────────────────────────────────────────────────────
// Priority: super_admin > admin > manager > staff
export function getRole(user) {
  if (!user) return "staff";
  if (isSuperAdmin(user)) return "super_admin";
  if (isAdminUser(user))  return "admin";
  if (user.role === "manager") return "manager";
  return "staff";
}

// ── Permissions matrix ───────────────────────────────────────────────────────
const PERMISSIONS = {
  add_employee:     ["manager", "admin", "super_admin"],
  edit_employee:    ["manager", "admin", "super_admin"],
  delete_employee:  ["admin",   "super_admin"],
  manage_bot:       ["admin",   "super_admin"],
  view_admin_panel: ["admin",   "super_admin"],
  manage_users:     ["super_admin"],
};

// ── Main gate ────────────────────────────────────────────────────────────────
export function canPerform(action, user) {
  const role = getRole(user);
  return (PERMISSIONS[action] ?? []).includes(role);
}
