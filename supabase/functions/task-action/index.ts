// supabase/functions/task-action/index.ts
// ══════════════════════════════════════════════════════════════════════════════
// XOS CORE Sprint 2 — Accept / Complete callback for the in-group task card.
//
// The task card (sent by whapi-webhook) carries two links:
//   …/task-action?id={taskId}&action=accept|complete&token={action_token}
//
// TWO-STEP, CRAWLER-SAFE, ATTRIBUTED FLOW:
//   GET   → renders an interstitial HTML page (NO database mutation). This is
//           what the WhatsApp link-preview crawler hits — it only ever sees a
//           page, never flips a task. The page asks "Confirm action as:" and
//           shows the whitelist names (Lidor / Adir / Osnat) as POST buttons.
//   POST  → the staffer's tap commits: validates token + actor, updates the
//           task (status + claimed_by/claimed_at on accept, resolved_by/
//           resolved_at on complete — resolved from the actor's profiles.phone),
//           posts an English confirmation back into the ops group, and renders
//           a success page. Crawlers don't POST, so state only changes on a
//           real human tap.
//
// The action_token (migration 073) is the only secret — a forged/guessed id is
// rejected. Deploy with --no-verify-jwt (public callback; the token is the auth).
//
// Group confirmation target = WHAPI_GROUP_ID (single ops group). If unset, the
// DB still updates and the page still renders — only the group echo is skipped
// (logged). Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// WHAPI_TOKEN (for the echo). Optional: WHAPI_GROUP_ID.
// ══════════════════════════════════════════════════════════════════════════════

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhapiText } from "../_shared/whapiSend.ts";

// name → authorized internal phone (reverse of whapi-webhook's ADMIN_WHITELIST).
const STAFF: Record<string, string> = {
  Lidor: "972504654306",
  Adir:  "972546294885",
  Osnat: "972502278833",
};
const STAFF_NAMES = Object.keys(STAFF);

const HTML = { "Content-Type": "text/html; charset=utf-8" };

// ── Minimal branded, mobile-first page shell (Dream Island gold/ivory). ──────
function page(title: string, inner: string, accent = "#C9A96E"): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><style>
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Heebo,sans-serif;
background:#F5F0E8;color:#1A1A1A;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{background:#fff;border:1px solid #E0D5C5;border-radius:18px;max-width:420px;width:100%;
padding:28px 24px;box-shadow:0 10px 40px rgba(0,0,0,.08);text-align:center}
h1{font-size:20px;margin:0 0 6px}.muted{color:#6b6b6b;font-size:14px;margin:0 0 18px}
.task{background:#FAF6EF;border:1px solid #E0D5C5;border-radius:12px;padding:14px;margin:14px 0;text-align:left;font-size:15px}
.task b{color:${accent}}
button{display:block;width:100%;padding:15px;margin:10px 0 0;font-size:17px;font-weight:700;
border:none;border-radius:12px;background:${accent};color:#1A1A1A;cursor:pointer}
button:active{transform:scale(.98)}.big{font-size:40px;margin:0 0 8px}
</style></head><body><div class="card">${inner}</div></body></html>`;
}

const ACTION_LABEL: Record<string, string> = { accept: "Accept Task", complete: "Mark Completed", bump: "Bump Task" };

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok");

  const url     = new URL(req.url);
  const id      = url.searchParams.get("id")     ?? "";
  const action  = url.searchParams.get("action") ?? "";
  const token   = url.searchParams.get("token")  ?? "";

  try {
    if (!id || (action !== "accept" && action !== "complete" && action !== "bump") || !token) {
      return new Response(page("Invalid link", `<p class="big">⚠️</p><h1>Invalid link</h1>
        <p class="muted">This task link is missing or malformed.</p>`), { status: 400, headers: HTML });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: task } = await supabase
      .from("tasks").select("id, room_number, description, status, action_token").eq("id", id).maybeSingle();

    // Token gate — forged/guessed ids and crawler hits without the secret die here.
    if (!task || !task.action_token || task.action_token !== token) {
      return new Response(page("Link expired", `<p class="big">🔒</p><h1>Link not valid</h1>
        <p class="muted">This action link is expired or incorrect.</p>`), { status: 403, headers: HTML });
    }

    const roomLabel = task.room_number ? `Suite ${task.room_number}` : "Suite —";
    const taskBox = `<div class="task">🏷️ <b>${roomLabel}</b><br>📋 ${escapeHtml(String(task.description ?? ""))}</div>`;

    // Already finished — show state, never double-fire.
    if (task.status === "done") {
      return new Response(page("Already completed", `<p class="big">✔️</p><h1>Already completed</h1>${taskBox}`), { headers: HTML });
    }

    // ── GET → render attribution interstitial (NO mutation) ─────────────────
    if (req.method === "GET") {
      const buttons = STAFF_NAMES.map((n) => `<button name="actor" value="${n}" type="submit">${n}</button>`).join("");
      const inner = `<h1>${ACTION_LABEL[action]}</h1>
        <p class="muted">Confirm action as:</p>${taskBox}
        <form method="POST" action="${escapeAttr(req.url)}">${buttons}</form>`;
      return new Response(page(ACTION_LABEL[action], inner), { headers: HTML });
    }

    // ── POST → commit, attributed to the tapped name ────────────────────────
    if (req.method === "POST") {
      const form = await req.formData().catch(() => null);
      const actor = String(form?.get("actor") ?? "");
      if (!STAFF_NAMES.includes(actor)) {
        return new Response(page("Pick a name", `<p class="big">👤</p><h1>Who are you?</h1>
          <p class="muted">Please reopen the link and tap your name.</p>`), { status: 400, headers: HTML });
      }

      // Resolve actor → profiles UUID for claimed_by / resolved_by. If the staff
      // member has no profiles row (no phone set, migration 070), the status
      // still updates and we log it — FAIL VISIBLE, never block the op.
      const phone = STAFF[actor];
      const local = "0" + phone.slice(3);
      const { data: prof } = await supabase
        .from("profiles").select("id").in("phone", [phone, "+" + phone, local]).maybeSingle();
      const actorUuid = (prof?.id as string) ?? null;
      if (!actorUuid && action !== "bump") console.warn(`[task-action] no profiles row for ${actor} (${phone}) — status updated, ${action === "accept" ? "claimed_by" : "resolved_by"} left null`);

      // ── Bump (Session 26 Sprint 3.3) — manager's reply to a personal SLA
      // alert (sla-escalation-cron, source='guest_request' tasks). Pure
      // re-notify: resends the request into the ops group in a louder format
      // so it doesn't keep losing the scroll race. No status/claim mutation —
      // resolution still only happens via the 👍🏼 reaction (whapi-webhook
      // Sprint 2) or someone tapping Accept/Complete on a card that has them.
      if (action === "bump") {
        const groupId = Deno.env.get("WHAPI_GROUP_ID")?.trim();
        const bumpText = `⚡ MANAGER BUMP: [${task.room_number ?? "—"}] - ${task.description} needed ASAP! ⚡`;
        let sent = false;
        if (groupId) {
          try { await sendWhapiText(groupId, bumpText, { noLinkPreview: true }); sent = true; }
          catch (e) { console.warn("[task-action] bump group send failed:", (e as Error).message); }
        } else {
          console.warn("[task-action] WHAPI_GROUP_ID unset — bump not sent");
        }
        const inner = sent
          ? `<p class="big">⚡</p><h1>Task bumped</h1><p class="muted">Resent to the ops group by <b>${actor}</b></p>${taskBox}`
          : `<p class="big">⚠️</p><h1>Bump failed to send</h1><p class="muted">Could not reach the ops group — check WHAPI_GROUP_ID / Whapi status.</p>${taskBox}`;
        return new Response(page(sent ? "Task bumped" : "Bump failed", inner), { status: sent ? 200 : 502, headers: HTML });
      }

      const now = new Date().toISOString();
      // resolved_by_phone/resolved_by_name (migration 078) mirror the same raw-
      // identity capture the whapi-webhook 👍🏼 reaction listener does — same
      // columns, same "done" mutation point, so a task resolved via this legacy
      // link path still renders attribution on the Ops Board.
      const patch = action === "accept"
        ? { status: "in_progress", claimed_by: actorUuid, claimed_at: now, updated_at: now }
        : { status: "done", resolved_by: actorUuid, resolved_by_phone: phone, resolved_by_name: actor, resolved_at: now, updated_at: now };

      const { error: upErr } = await supabase.from("tasks").update(patch).eq("id", id);
      if (upErr) throw new Error(`task_update_failed: ${upErr.message}`);

      // Echo confirmation into the ops group (best-effort, non-blocking).
      const verb = action === "accept" ? "accepted" : "completed";
      const emoji = action === "accept" ? "✅" : "✔️";
      const statusWord = action === "accept" ? "In Progress" : "Done";
      const echo = `${emoji} ${roomLabel} — "${task.description}" ${verb} by ${actor} · Status: ${statusWord}`;
      const groupId = Deno.env.get("WHAPI_GROUP_ID")?.trim();
      if (groupId) {
        try { await sendWhapiText(groupId, echo, { noLinkPreview: true }); }
        catch (e) { console.warn("[task-action] group echo failed:", (e as Error).message); }
      } else {
        console.warn("[task-action] WHAPI_GROUP_ID unset — DB updated, group echo skipped");
      }

      const inner = `<p class="big">${emoji}</p><h1>Task ${verb}</h1>
        <p class="muted">Logged as <b>${actor}</b> · ${statusWord}</p>${taskBox}`;
      return new Response(page(`Task ${verb}`, inner), { headers: HTML });
    }

    return new Response(page("Method not allowed", `<h1>405</h1>`), { status: 405, headers: HTML });
  } catch (err: unknown) {
    const m = err instanceof Error ? err.message : String(err);
    console.error("[task-action] error:", m);
    return new Response(page("Something went wrong", `<p class="big">⚠️</p><h1>Something went wrong</h1>
      <p class="muted">${escapeHtml(m)}</p>`), { status: 500, headers: HTML });
  }
});

// Minimal HTML/attribute escaping (task descriptions are staff free-text).
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
