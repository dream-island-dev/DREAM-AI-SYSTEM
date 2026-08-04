import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  buildSpaGroupLeadEmailBody,
  buildSpaGroupLeadEmailSubject,
  isSpaGroupLeadGuest,
  resolveSpaGroupLabel,
  resolveSpaGroupLeadNotifyEmail,
} from "./spaGroupLeadNotify.ts";

Deno.test("isSpaGroupLeadGuest: untagged/legacy guest is not a group lead", () => {
  assertEquals(isSpaGroupLeadGuest(null), false);
  assertEquals(isSpaGroupLeadGuest({}), false);
  assertEquals(isSpaGroupLeadGuest({ guest_profile: {} }), false);
  assertEquals(isSpaGroupLeadGuest({ guest_profile: { spa: {} } }), false);
});

Deno.test("isSpaGroupLeadGuest: manual tag (SpaUpsellConfirmModal task 3) reads as group", () => {
  const guest = { guest_profile: { spa: { lead_audience: "group" } } };
  assertEquals(isSpaGroupLeadGuest(guest), true);
});

Deno.test("isSpaGroupLeadGuest: wa.me campaign link (spaGroupCampaign.ts) also reads as group", () => {
  assertEquals(
    isSpaGroupLeadGuest({ guest_profile: { spa: { group_campaign: "everest-2026-08-10" } } }),
    true,
  );
  assertEquals(
    isSpaGroupLeadGuest({ guest_profile: { spa: { source: "wa_group_link" } } }),
    true,
  );
});

Deno.test("resolveSpaGroupLabel: reads free-text label, trims, null when absent", () => {
  assertEquals(resolveSpaGroupLabel({ guest_profile: { spa: { group_label: "  אוורסט טכנולוגיות  " } } }), "אוורסט טכנולוגיות");
  assertEquals(resolveSpaGroupLabel({ guest_profile: { spa: {} } }), null);
  assertEquals(resolveSpaGroupLabel(null), null);
});

Deno.test("resolveSpaGroupLeadNotifyEmail: defaults to Meirav when no env override", () => {
  Deno.env.delete("SPA_GROUP_LEAD_NOTIFY_EMAIL");
  assertEquals(resolveSpaGroupLeadNotifyEmail(), "Maayana@dream-island.co.il");
});

Deno.test("resolveSpaGroupLeadNotifyEmail: env override wins", () => {
  Deno.env.set("SPA_GROUP_LEAD_NOTIFY_EMAIL", "override@dream-island.co.il");
  assertEquals(resolveSpaGroupLeadNotifyEmail(), "override@dream-island.co.il");
  Deno.env.delete("SPA_GROUP_LEAD_NOTIFY_EMAIL");
});

Deno.test("buildSpaGroupLeadEmailSubject: includes group label when present", () => {
  assertEquals(buildSpaGroupLeadEmailSubject(null), "💆 ליד ספא חדש — קבוצה");
  assertStringIncludes(buildSpaGroupLeadEmailSubject("אוורסט טכנולוגיות"), "אוורסט טכנולוגיות");
});

Deno.test("buildSpaGroupLeadEmailBody: includes guest fields and guest reply quote", () => {
  const body = buildSpaGroupLeadEmailBody({
    guestName: "דנה כהן",
    phone: "+972501234567",
    arrivalDate: "2026-08-11",
    groupLabel: "אוורסט טכנולוגיות",
    guestReply: "אשמח לתאם",
  });
  assertStringIncludes(body, "דנה כהן");
  assertStringIncludes(body, "+972501234567");
  assertStringIncludes(body, "2026-08-11");
  assertStringIncludes(body, "אוורסט טכנולוגיות");
  assertStringIncludes(body, "אשמח לתאם");
});

Deno.test("buildSpaGroupLeadEmailBody: placeholders when fields missing, no quote line without reply", () => {
  const body = buildSpaGroupLeadEmailBody({ phone: "" });
  assertStringIncludes(body, "שם: —");
  assertStringIncludes(body, "טלפון: —");
  assertEquals(body.includes("הודעת האורח"), false);
});
