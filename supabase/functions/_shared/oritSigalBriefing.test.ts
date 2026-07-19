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

Deno.test("composeSigalComplaintBriefing — warm package with ack + full", () => {
  const body = composeSigalComplaintBriefing(
    thread,
    "שלום נעמי,\nקיבלנו את פנייתך.",
    "שלום נעמי,\nאנחנו מטפלים בניקיון.",
  );

  if (!body.includes("היי אורית")) throw new Error("missing greeting");
  if (!body.includes("ניקיון")) throw new Error("missing summary");
  if (!body.includes("קיבלנו את פנייתך")) throw new Error("missing ack");
  if (!body.includes("מטפלים בניקיון")) throw new Error("missing full reply");
  if (!body.includes("כן שלחי")) throw new Error("missing send CTA");
  if (!body.includes("סיימתי")) throw new Error("missing close CTA");
  assertEquals(body.includes("thread=869b0a98"), true);
});

Deno.test("composeSigalGuestReplyBriefing — guest reply + draft", () => {
  const body = composeSigalGuestReplyBriefing(
    thread,
    "תודה, אבל עדיין לא קיבלתי החזר.",
    "שלום נעמי,\nאני בודקת את הנושא מול הנהלה.",
  );

  if (!body.includes("השיב/ה למייל")) throw new Error("missing guest reply header");
  if (!body.includes("לא קיבלתי החזר")) throw new Error("missing guest text");
  if (!body.includes("בודקת את הנושא")) throw new Error("missing follow-up draft");
  if (!body.includes("סיימתי")) throw new Error("missing close CTA");
});

Deno.test("composeSigalStaleReminder — gentle nudge", () => {
  const body = composeSigalStaleReminder({
    ...thread,
    auto_ack_sent_at: null,
    full_reply_sent_at: null,
  });
  if (!body.includes("מזכירה בעדינות")) throw new Error("missing reminder tone");
  if (!body.includes("אישור קבלה")) throw new Error("missing ack nudge");
});

Deno.test("composeSigalAckSentFollowUp", () => {
  const body = composeSigalAckSentFollowUp("נעמי");
  if (!body.includes("שלחתי")) throw new Error("missing sent ack");
  if (!body.includes("תשובה מלאה")) throw new Error("missing full reply hint");
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

  if (!body.includes("סיכום ערב")) throw new Error("missing evening header");
  if (!body.includes("נשאר פתוח")) throw new Error("missing open section");
  if (!body.includes("טופל היום: 2")) throw new Error("missing handled count");
  if (!body.includes("מחר בבוקר")) throw new Error("missing tomorrow hint");
});
