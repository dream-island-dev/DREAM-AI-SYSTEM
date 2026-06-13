import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    // Verify caller is a logged-in admin
    const caller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const callerRole = user.user_metadata?.role;
    if (callerRole !== "admin" && callerRole !== "super_admin") {
      return json({ error: "Forbidden" }, 403);
    }

    // Admin client — SUPABASE_SERVICE_ROLE_KEY is auto-injected by Supabase runtime
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { email, password, name, newRole, department } = await req.json();
    if (!email || !password || !name) {
      return json({ error: "email, password, name required" }, 400);
    }

    const avatar = name
      .split(" ")
      .map((n: string) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // active immediately — no SMTP needed
      user_metadata: {
        name,
        role: newRole || "manager",
        department: department || "",
        avatar,
      },
    });

    if (error) return json({ error: error.message }, 400);
    return json({ user: data.user });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
});
