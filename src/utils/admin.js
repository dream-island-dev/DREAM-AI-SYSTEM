// src/utils/admin.js
// Admin detection — works for both mock auth and Supabase OAuth.
// The DB trigger (004_rbac_owner.sql) hardcodes roles by email on first login.
// Client-side checks below mirror that logic for mock auth / instant UI.
//
// OWNER MODEL:
//   tzalamnadlan@gmail.com  → super_admin (undisputed owner, manages everyone)
//   promote7il@gmail.com    → admin       (legacy account, demoted from owner)
//   everyone else           → staff       (default; super-admin can promote)

/** The single, undisputed Super-Admin (owner). */
export const SUPER_ADMIN_EMAIL = "tzalamnadlan@gmail.com";

/** Emails that always receive at least the 'admin' tag (besides the owner). */
export const ADMIN_EMAILS = ["promote7il@gmail.com"];

/**
 * @deprecated kept for backwards-compat with older imports.
 * Points at the owner email.
 */
export const ADMIN_EMAIL = SUPER_ADMIN_EMAIL;

export const DEFAULT_DEPARTMENTS = [
  "קבלה", "ניקיון", "מסעדה", "תחזוקה", "ביטחון", "ספא",
];

const DEPT_KEY = "di_departments";

const normalize = (email) => (email ?? "").trim().toLowerCase();

/** Returns true if the user has admin or super_admin privileges */
export function isAdminUser(user) {
  if (!user) return false;
  const email = normalize(user.email);
  return (
    user.role === "admin" ||
    user.role === "super_admin" ||
    email === SUPER_ADMIN_EMAIL ||
    ADMIN_EMAILS.includes(email)
  );
}

/** Returns true ONLY for super_admin (the owner — can manage other users) */
export function isSuperAdmin(user) {
  if (!user) return false;
  return (
    user.role === "super_admin" ||
    normalize(user.email) === SUPER_ADMIN_EMAIL
  );
}

/** Load departments from localStorage (falls back to defaults) */
export function loadDepartments() {
  try {
    const raw = localStorage.getItem(DEPT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return [...DEFAULT_DEPARTMENTS];
}

/** Save departments to localStorage */
export function saveDepartments(depts) {
  localStorage.setItem(DEPT_KEY, JSON.stringify(depts));
}
