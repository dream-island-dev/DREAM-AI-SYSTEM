import {
  buildSpaUpsellMetaTemplateCatalog,
  isAllowedSpaUpsellMetaTemplate,
  SPA_UPSELL_CHANNEL_META,
  SPA_UPSELL_CHANNEL_WHAPI,
  SPA_UPSELL_META_TEMPLATE_DEFAULT,
} from "./spaUpsellAudience";

export const SPA_UPSELL_SEND_PULSE_MS = 2500;

export async function fetchSpaUpsellDispatchMeta(supabase) {
  const [scriptRes, tmplRes] = await Promise.all([
    supabase
      .from("bot_scripts")
      .select("message_text")
      .eq("script_key", "spa_upsell_daypass")
      .maybeSingle(),
    supabase.functions.invoke("get-wa-templates", { body: { all: true } }),
  ]);
  const templates = tmplRes.data?.templates ?? [];
  const metaTemplateCatalog = buildSpaUpsellMetaTemplateCatalog(templates);
  const defaultRow = metaTemplateCatalog.find((t) => t.name === SPA_UPSELL_META_TEMPLATE_DEFAULT)
    ?? metaTemplateCatalog[0];
  return {
    scriptText: scriptRes.data?.message_text ?? "",
    metaTemplateCatalog,
    metaTemplateStatus: defaultRow?.status ?? null,
    metaTemplateBodyText: defaultRow?.bodyText ?? "",
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Array<{ id: number, name?: string, phone?: string }>} targets
 * @param {string} [channel]
 * @param {(progress: { current: number, total: number }) => void} [onProgress]
 * @param {string} [waTemplateName] Meta template when channel=meta_template
 */
export async function sendSpaUpsellBatch(
  supabase,
  targets,
  channel = SPA_UPSELL_CHANNEL_WHAPI,
  onProgress,
  waTemplateName,
) {
  const results = [];
  const ch = channel || SPA_UPSELL_CHANNEL_WHAPI;
  const metaTemplate = ch === SPA_UPSELL_CHANNEL_META
    && isAllowedSpaUpsellMetaTemplate(waTemplateName)
    ? String(waTemplateName).trim()
    : (ch === SPA_UPSELL_CHANNEL_META ? SPA_UPSELL_META_TEMPLATE_DEFAULT : null);

  for (let i = 0; i < targets.length; i++) {
    const guest = targets[i];
    onProgress?.({ current: i + 1, total: targets.length });
    try {
      const body = {
        trigger: "spa_upsell_daypass",
        guestId: guest.id,
        force: true,
        force_channel: ch,
      };
      if (metaTemplate) body.waTemplateName = metaTemplate;

      const { data, error } = await supabase.functions.invoke("whatsapp-send", { body });
      if (error) results.push({ guest, result: "error", error: error.message });
      else if (data?.skipped) results.push({ guest, result: "skipped", reason: data.reason });
      else if (data?.ok) results.push({ guest, result: "sent" });
      else results.push({ guest, result: "failed", error: data?.error ?? "unknown" });
    } catch (e) {
      results.push({ guest, result: "error", error: e?.message ?? String(e) });
    }
    if (i < targets.length - 1) {
      await new Promise((r) => setTimeout(r, SPA_UPSELL_SEND_PULSE_MS));
    }
  }
  return results;
}

export async function scheduleSpaUpsellTasks(supabase, payload) {
  if (!payload?.length) return { count: 0, error: null };
  const { data, error } = await supabase.rpc("staff_schedule_tasks_batch", { p_tasks: payload });
  if (error) return { count: 0, error };
  const count = typeof data === "number" ? data : payload.length;
  return { count, error: null };
}
