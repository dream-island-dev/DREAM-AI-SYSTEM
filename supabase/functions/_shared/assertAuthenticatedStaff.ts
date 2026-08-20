// supabase/functions/_shared/assertAuthenticatedStaff.ts
//
// Overnight hardening (2026-08-20): minimum auth bar for Edge Functions that
// were previously reachable with zero authentication, but are in practice
// only ever called from the logged-in XOS UI via supabase.functions.invoke()
// (which attaches the caller's session JWT as the Authorization header).
//
// This is deliberately NOT a new permission matrix — src/utils/auth.js's
// PERMISSIONS/ROUTE_ACCESS tables are untouched, and this file does not try
// to replicate them. It only enforces: "the caller holds a valid Supabase
// session AND their profile is not suspended." Callers that need a specific
// role (e.g. invite-user → super_admin) pass `requiredRole`.
//
// Every function that starts using this must keep --no-verify-jwt at deploy
// time — this check replaces the platform gate, it doesn't stack with it.

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export interface StaffProfile {
  id?: string | null;
  email?: string | null;
  role?: string | null;
  status?: string | null;
}

export interface AuthenticatedStaff {
  id: string;
  email: string;
  role: string;
  status: string;
}

/** Pulls the bearer token out of the Authorization header. Pure — no I/O. */
export function extractBearerToken(req: Request): string {
  const bearer = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const token = bearer.replace(/^Bearer\s*/i, "").trim();
  if (!token) throw new AuthError("unauthorized: missing bearer token", 401);
  return token;
}

/**
 * Pure validation of an already-fetched profiles row: not suspended, and
 * (optionally) role is in the allowed set. Split out from the DB-calling
 * wrapper below so the actual policy logic is unit-testable without a live
 * Supabase connection.
 */
export function checkStaffProfileAllowed(
  profile: StaffProfile | null | undefined,
  requiredRole?: string | string[],
): AuthenticatedStaff {
  if (!profile || !profile.id) {
    throw new AuthError("unauthorized: no profile for this account", 401);
  }
  if (String(profile.status ?? "active") === "suspended") {
    throw new AuthError("unauthorized: account suspended", 401);
  }

  const staff: AuthenticatedStaff = {
    id: String(profile.id),
    email: String(profile.email ?? ""),
    role: String(profile.role ?? "staff"),
    status: String(profile.status ?? "active"),
  };

  if (requiredRole) {
    const allowed = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    if (!allowed.includes(staff.role)) {
      throw new AuthError(`forbidden: requires role ${allowed.join(" or ")}`, 403);
    }
  }

  return staff;
}

/**
 * Full check: bearer token → auth.getUser → profiles row → checkStaffProfileAllowed.
 * `admin` must be a service-role Supabase client (auth.getUser works with any
 * client, but the profiles lookup needs to bypass RLS the same way the rest
 * of these functions already do).
 *
 * Throws AuthError on any failure — callers can either let it bubble into
 * their existing catch block (recommended: keeps each function's existing
 * error-response shape/status code unchanged) or catch it explicitly.
 */
// deno-lint-ignore no-explicit-any
export async function assertAuthenticatedStaff(
  admin: any,
  req: Request,
  opts?: { requiredRole?: string | string[] },
): Promise<AuthenticatedStaff> {
  const token = extractBearerToken(req);

  const { data: authData, error: authErr } = await admin.auth.getUser(token);
  const user = authData?.user;
  if (authErr || !user) throw new AuthError("unauthorized: invalid session", 401);

  const { data: profile, error: profErr } = await admin
    .from("profiles")
    .select("id, email, role, status")
    .eq("id", user.id)
    .maybeSingle();
  if (profErr) throw new AuthError("unauthorized: profile lookup failed", 401);

  return checkStaffProfileAllowed(profile as StaffProfile | null, opts?.requiredRole);
}
