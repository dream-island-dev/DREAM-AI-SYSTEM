// supabase/functions/_shared/assertAuthenticatedStaff.test.ts
//
// Run: deno test supabase/functions/_shared/assertAuthenticatedStaff.test.ts

import { assertEquals, assertThrows } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  AuthError,
  checkStaffProfileAllowed,
  extractBearerToken,
} from "./assertAuthenticatedStaff.ts";

function reqWithAuth(header: string | null): Request {
  const headers = new Headers();
  if (header !== null) headers.set("Authorization", header);
  return new Request("https://example.com/fn", { headers });
}

// ── extractBearerToken ───────────────────────────────────────────────────────

Deno.test("extractBearerToken: no Authorization header → AuthError 401", () => {
  const err = assertThrows(() => extractBearerToken(reqWithAuth(null)), AuthError);
  assertEquals((err as AuthError).status, 401);
});

Deno.test("extractBearerToken: empty Authorization header → AuthError 401", () => {
  assertThrows(() => extractBearerToken(reqWithAuth("")), AuthError);
});

Deno.test("extractBearerToken: 'Bearer ' with no token → AuthError 401", () => {
  assertThrows(() => extractBearerToken(reqWithAuth("Bearer   ")), AuthError);
});

Deno.test("extractBearerToken: valid 'Bearer <jwt>' → returns token", () => {
  const token = extractBearerToken(reqWithAuth("Bearer abc.def.ghi"));
  assertEquals(token, "abc.def.ghi");
});

Deno.test("extractBearerToken: case-insensitive 'bearer' prefix", () => {
  const token = extractBearerToken(reqWithAuth("bearer abc.def.ghi"));
  assertEquals(token, "abc.def.ghi");
});

// ── checkStaffProfileAllowed ─────────────────────────────────────────────────

Deno.test("checkStaffProfileAllowed: no profile row → AuthError 401 (unauthorized)", () => {
  const err = assertThrows(() => checkStaffProfileAllowed(null), AuthError);
  assertEquals((err as AuthError).status, 401);
});

Deno.test("checkStaffProfileAllowed: profile missing id → AuthError 401", () => {
  assertThrows(() => checkStaffProfileAllowed({ email: "x@y.com", role: "staff", status: "active" }), AuthError);
});

Deno.test("checkStaffProfileAllowed: suspended status → AuthError 401, regardless of role", () => {
  const err = assertThrows(
    () => checkStaffProfileAllowed({ id: "u1", role: "super_admin", status: "suspended" }),
    AuthError,
  );
  assertEquals((err as AuthError).status, 401);
});

Deno.test("checkStaffProfileAllowed: active staff, no requiredRole → passes, returns staff record", () => {
  const staff = checkStaffProfileAllowed({ id: "u1", email: "a@b.com", role: "staff", status: "active" });
  assertEquals(staff, { id: "u1", email: "a@b.com", role: "staff", status: "active" });
});

Deno.test("checkStaffProfileAllowed: null status treated as active (defaults to allowed)", () => {
  const staff = checkStaffProfileAllowed({ id: "u1", role: "manager", status: null });
  assertEquals(staff.status, "active");
});

Deno.test("checkStaffProfileAllowed: requiredRole set, role matches → passes", () => {
  const staff = checkStaffProfileAllowed(
    { id: "u1", role: "super_admin", status: "active" },
    "super_admin",
  );
  assertEquals(staff.role, "super_admin");
});

Deno.test("checkStaffProfileAllowed: requiredRole set, role does not match → AuthError 403 (forbidden)", () => {
  const err = assertThrows(
    () => checkStaffProfileAllowed({ id: "u1", role: "staff", status: "active" }, "super_admin"),
    AuthError,
  );
  assertEquals((err as AuthError).status, 403);
});

Deno.test("checkStaffProfileAllowed: requiredRole as array, role in list → passes", () => {
  const staff = checkStaffProfileAllowed(
    { id: "u1", role: "manager", status: "active" },
    ["admin", "super_admin", "manager"],
  );
  assertEquals(staff.role, "manager");
});

Deno.test("checkStaffProfileAllowed: requiredRole as array, role not in list → AuthError 403", () => {
  assertThrows(
    () => checkStaffProfileAllowed({ id: "u1", role: "receptionist", status: "active" }, ["admin", "super_admin"]),
    AuthError,
  );
});

// ── Overnight-hardening acceptance checklist (from the brief) ───────────────

Deno.test("acceptance: no token → unauthorized", () => {
  assertThrows(() => extractBearerToken(reqWithAuth(null)), AuthError);
});

Deno.test("acceptance: suspended profile → unauthorized even with a role match", () => {
  assertThrows(
    () => checkStaffProfileAllowed({ id: "u1", role: "admin", status: "suspended" }, ["admin", "super_admin"]),
    AuthError,
  );
});

Deno.test("acceptance: active staff, no required role (chat/automation-queue/etc.) → ok", () => {
  const staff = checkStaffProfileAllowed({ id: "u1", role: "receptionist", status: "active" });
  assertEquals(staff.role, "receptionist");
});

Deno.test("acceptance: non-super_admin on invite-user's required role → forbidden", () => {
  const err = assertThrows(
    () => checkStaffProfileAllowed({ id: "u1", role: "admin", status: "active" }, "super_admin"),
    AuthError,
  );
  assertEquals((err as AuthError).status, 403);
});

Deno.test("acceptance: super_admin on invite-user's required role → ok", () => {
  const staff = checkStaffProfileAllowed({ id: "u1", role: "super_admin", status: "active" }, "super_admin");
  assertEquals(staff.role, "super_admin");
});
