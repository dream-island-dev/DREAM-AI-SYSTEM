// deno test supabase/functions/_shared/staffNotifyTemplates.test.ts

import {
  applyStaffMessageTemplate,
  mergeDigestConfig,
  ADIR_MORNING_BRIEF_DEFAULTS,
  composeFromStaffTemplate,
  type StaffTemplateMap,
} from "./staffNotifyTemplates.ts";

Deno.test("applyStaffMessageTemplate — replaces placeholders", () => {
  const out = applyStaffMessageTemplate("שלום {{name}} | {{room}}", { name: "אדיר", room: "5" });
  if (!out.includes("אדיר") || !out.includes("5")) throw new Error(out);
});

Deno.test("applyStaffMessageTemplate — empty unknown keys", () => {
  const out = applyStaffMessageTemplate("{{a}}X{{b}}", { a: "1" });
  if (out !== "1X") throw new Error(out);
});

Deno.test("mergeDigestConfig — override non-empty only", () => {
  const merged = mergeDigestConfig(ADIR_MORNING_BRIEF_DEFAULTS, { greeting: "היי אדיר" });
  if (merged.greeting !== "היי אדיר") throw new Error(merged.greeting);
  if (!merged.title.includes("{{date_he}}")) throw new Error("default title lost");
});

Deno.test("composeFromStaffTemplate — inactive row falls back", () => {
  const map: StaffTemplateMap = new Map([
    ["adir_inventory_submit", {
      template_key: "adir_inventory_submit",
      recipient_role: "front_desk",
      category: "event",
      display_name_he: "x",
      channel_hint: null,
      message_text: "📦 {{location}}",
      digest_config: null,
      is_active: false,
      sort_order: 0,
    }],
  ]);
  const out = composeFromStaffTemplate(map, "adir_inventory_submit", { location: "מחסן" });
  if (out !== null) throw new Error("expected null for inactive");
});
