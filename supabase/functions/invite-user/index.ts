// supabase/functions/invite-user/index.ts
// Creates a new user with a temporary password + stamps their profile row.
//
// Flow:
//   1. admin.createUser({ email, password, email_confirm: true })
//   2. handle_new_auth_user trigger auto-creates public.profiles row
//   3. upsert profiles — applies name / role / department / must_change_password=true
//
// If email already exists, updates the profile only (no new auth user created).
//
// Body: {
//   email: string, name: string,
//   password: string  (required — no default),
//   role?: "staff"|"manager"|"admin",
//   department?: string|null
// }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_ROLES = ["staff", "manager", "admin"];

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json() as Record<string, unknown>;
    const email      = String(body.email ?? "").trim().toLowerCase();
    const name       = String(body.name  ?? "").trim();
    const password   = String(body.password   ?? "").trim();
    const role       = String(body.role       ?? "staff");
    const department = body.department ? String(body.department) : null;

    if (!email || !email.includes("@")) throw new Error("valid email is required");
    if (!name)                          throw new Error("name is required");
    if (!password || password.length < 8) throw new Error("password is required and must be at least 8 characters");
    if (!ALLOWED_ROLES.includes(role))  throw new Error("invalid role: " + role);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    let userId: string | null = null;
    let alreadyExists = false;

    // ── 1. Create auth user with confirmed email + temp password ──────────────
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, full_name: name },
      });

    if (createErr) {
      if (/already.*(registered|exists)/i.test(createErr.message ?? "")) {
        alreadyExists = true;
        // Look up existing profile by email
        const { data: prof } = await admin
          .from("profiles").select("id").ilike("email", email).maybeSingle();
        userId = (prof as Record<string, string> | null)?.id ?? null;
        if (!userId) throw new Error("user_exists_but_profile_not_found");
      } else {
        throw new Error("create_user_failed: " + createErr.message);
      }
    } else {
      userId = created?.user?.id ?? null;
    }

    if (!userId) throw new Error("could_not_resolve_user_id");

    // ── 2. Wait briefly for the DB trigger to fire, then upsert profile ───────
    await new Promise((r) => setTimeout(r, 300));

    const { error: upErr } = await admin.from("profiles").upsert({
      id:                   userId,
      email,
      name,
      role,
      department,
      status:               "active",
      must_change_password: !alreadyExists,
      avatar_text:          name.slice(0, 2).toUpperCase(),
    }, { onConflict: "id" });

    if (upErr) throw new Error("profile_update_failed: " + upErr.message);

    return new Response(
      JSON.stringify({ ok: true, userId, alreadyExists }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
