// src/utils/admin.js
// Admin detection — works for both mock auth and Supabase OAuth.
// The DB trigger (004_rbac_owner.sql) hardcodes roles by email on first login.
// Client-side checks below mirror that logic for mock auth / instant UI.
//
// OWNER MODEL:
//   tzalamnadlan@gmail.com  → super_admin (owner)
//   mikeka13@gmail.com      → super_admin (co-owner)
//   promote7il@gmail.com    → admin       (legacy)
//   everyone else           → staff       (promotable by super_admin)

import { DEFAULT_DEPARTMENTS } from "../data/hotelDepartments";

export { DEFAULT_DEPARTMENTS };

/** The single, undisputed Super-Admin (owner). */
export const SUPER_ADMIN_EMAIL = "tzalamnadlan@gmail.com";

/** Co-owner / system admin — same privileges as owner in UI + DB trigger. */
export const CO_SUPER_ADMIN_EMAIL = "mikeka13@gmail.com";

const normalize = (email) => (email ?? "").trim().toLowerCase();

/** Emails allowed to use Google Sign-In on the login page (must exist in auth.users). */
export const GOOGLE_AUTH_WHITELIST = [
  SUPER_ADMIN_EMAIL,
  CO_SUPER_ADMIN_EMAIL,
  "promote7il@gmail.com",
].map(normalize);

/** Client-side gate before signInWithIdToken — case-insensitive. */
export function isGoogleAuthAllowed(email) {
  return GOOGLE_AUTH_WHITELIST.includes(normalize(email));
}

/** Emails that always receive at least the 'admin' tag (besides super_admins). */
export const ADMIN_EMAILS = ["promote7il@gmail.com"];

const SUPER_ADMIN_EMAILS = new Set(
  [SUPER_ADMIN_EMAIL, CO_SUPER_ADMIN_EMAIL].map(normalize),
);

/**
 * @deprecated kept for backwards-compat with older imports.
 * Points at the owner email.
 */
export const ADMIN_EMAIL = SUPER_ADMIN_EMAIL;

const DEPT_KEY = "di_departments";

/** Returns true if the user has admin or super_admin privileges */
export function isAdminUser(user) {
  if (!user) return false;
  const email = normalize(user.email);
  return (
    user.role === "admin" ||
    user.role === "super_admin" ||
    SUPER_ADMIN_EMAILS.has(email) ||
    ADMIN_EMAILS.includes(email)
  );
}

/** Returns true ONLY for super_admin (the owner — can manage other users) */
export function isSuperAdmin(user) {
  if (!user) return false;
  const email = normalize(user.email);
  return user.role === "super_admin" || SUPER_ADMIN_EMAILS.has(email);
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
