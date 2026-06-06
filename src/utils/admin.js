// src/utils/admin.js
// Admin detection — works for both mock auth and Supabase OAuth.
// The DB trigger (002_admin_setup.sql) sets role='admin' in profiles
// for this email on first login. Client-side check covers mock auth.

export const ADMIN_EMAIL = "promote7il@gmail.com";

export const DEFAULT_DEPARTMENTS = [
  "קבלה", "ניקיון", "מסעדה", "תחזוקה", "ביטחון", "ספא",
];

const DEPT_KEY = "di_departments";

/** Returns true if the user has admin or super_admin privileges */
export function isAdminUser(user) {
  if (!user) return false;
  return (
    user.role === "admin" ||
    user.role === "super_admin" ||
    (user.email ?? "").toLowerCase() === ADMIN_EMAIL
  );
}

/** Returns true ONLY for super_admin (can manage other users) */
export function isSuperAdmin(user) {
  if (!user) return false;
  return (
    user.role === "super_admin" ||
    (user.email ?? "").toLowerCase() === ADMIN_EMAIL
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
