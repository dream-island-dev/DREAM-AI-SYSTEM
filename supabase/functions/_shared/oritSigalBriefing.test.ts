// Run: deno test --allow-env supabase/functions/_shared/oritSigalBriefing.test.ts

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  areSigalBriefingDraftsReady,
  composeSigalAckSentFollowUp,
  composeSigalComplaintBriefing,
  composeSigalGuestReplyBriefing,
  composeSigalEveningActionPlan,
  composeSigalStaleReminder,
} from "./oritSigalBriefing.ts";

const thread = {
  id: "869b0a98-781a-4f3a-954c-7c263232d7b5",
  subject: "תלונה",
  from_name: "נעמי",
  from_email: "relay@richkid.co.il",
  guest_contact_email: "naomi@example.com",
  category: "complaint",
  urgency: "high",
  ai_summary: "אורחת מתלוננת על ניקיון החדר.",
};

const PULSE_MAX = 720;

Deno.test("composeSigalComplaintBriefing — pulse only, no inline drafts", () => {
  const body = composeSigalComplaintBriefing(
    thread,
    "שלום נעמי,\nקיבלנו את פנייתך.",
    "שלום נעמי,\nאנחנו מטפלים בניקיון.",
  );

  if (!body.includes("נעמי")) throw new Error("missing guest");
  if (!body.includes("ניקיון")) throw new Error("missing summary");
  if (!body.includes("תראי לי")) throw new Error("missing ack CTA");
  if (!body.includes("קיבלנו את פנייתך")) throw new Error("missing ack phrase");
  if (!body.includes("שלב 1")) throw new Error("missing step 1 focus");
  if (body.includes("שלב 2")) throw new Error("phase 1 should not push full letter yet");
  if (!body.includes("orit_cs_agent")) throw new Error("missing app deep link");
  if (!body.includes("thread=")) throw new Error("missing thread id in link");
  if (body.includes("קיבלנו את פנייתך.\n")) throw new Error("should not inline ack draft");
  if (body.includes("מטפלים בניקיון")) throw new Error("should not inline full draft");
  if (body.length > PULSE_MAX) throw new Error(`pulse too long: ${body.length}`);
  assertEquals(body.includes("תסדרי"), true);
  assertEquals(body.includes("במחשב"), false);
});

Deno.test("composeSigalComplaintBriefing — phase 2 after ack sent", () => {
  const body = composeSigalComplaintBriefing(
    { ...thread, auto_ack_sent_at: "2026-07-19T10:00:00Z", full_reply_sent_at: null },
    "שלום נעמי,\nקיבלנו את פנייתך.",
    "שלום נעמי,\nאנחנו מטפלים בניקיון.",
  );

  if (!body.includes("כבר נשלח")) throw new Error("missing ack sent marker");
  if (!body.includes("שלב 2")) throw new Error("missing step 2");
  if (!body.includes("תשובה מלאה")) throw new Error("missing full CTA");
  if (body.includes("שלב 1 (דחוף)")) throw new Error("should not repeat step 1");
});

Deno.test("composeSigalGuestReplyBriefing — snippet only", () => {
  const body = composeSigalGuestReplyBriefing(
    thread,
    "תודה, אבל עדיין לא קיבלתי החזר.",
    "שלום נעמי,\nאני בודקת את הנושא מול הנהלה.",
  );

  if (!body.includes("השיב/ה")) throw new Error("missing guest reply header");
  if (!body.includes("לא קיבלתי החזר")) throw new Error("missing guest snippet");
  if (body.includes("בודקת את הנושא")) throw new Error("should not inline follow-up draft");
  if (!body.includes("תשובה מלאה")) throw new Error("missing CTA");
  if (body.length > PULSE_MAX) throw new Error(`pulse too long: ${body.length}`);
});

Deno.test("composeSigalStaleReminder — gentle nudge", () => {
  const body = composeSigalStaleReminder({
    ...thread,
    auto_ack_sent_at: null,
    full_reply_sent_at: null,
  });
  if (!body.includes("מזכירה בעדינות")) throw new Error("missing reminder tone");
  if (!body.includes("תראי לי")) throw new Error("missing ack nudge");
});

Deno.test("composeSigalAckSentFollowUp", () => {
  const body = composeSigalAckSentFollowUp("נעמי");
  if (!body.includes("קיבלנו את פנייתך")) throw new Error("missing ack phrase");
  if (!body.includes("שלב 2")) throw new Error("missing step 2 hint");
});

Deno.test("areSigalBriefingDraftsReady", () => {
  assertEquals(areSigalBriefingDraftsReady("ack", "full", true), true);
  assertEquals(areSigalBriefingDraftsReady("ack", "", true), false);
  assertEquals(areSigalBriefingDraftsReady("", "full", false), true);
});

Deno.test("composeSigalEveningActionPlan — open items + handled today", () => {
  const body = composeSigalEveningActionPlan({
    openComplaints: [{
      id: "t1",
      subject: "ניקיון",
      from_name: "נעמי",
      urgency: "high",
      ai_summary: "תלונה על ניקיון",
      overdue: false,
      hasAckDraft: true,
      hasFullDraft: true,
      channel: "email",
      initialSent: true,
    }],
    otherOpenCount: 1,
    handledToday: 2,
  });
  if (!body.includes("נשאר פתוח")) throw new Error("missing open section");
  if (!body.includes("טופל היום: 2")) throw new Error("missing handled count");
});
