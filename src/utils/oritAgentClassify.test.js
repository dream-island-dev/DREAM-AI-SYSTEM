/**
 * Tests for oritAgentClassify.js — mirrors tier-0 rules in _shared/oritAgentClassify.ts
 */

import {
  isGenericLeadFormSubject,
  threadMatchesTab,
  threadDisplayTitle,
  categoryMeta,
} from "./oritAgentClassify";

describe("oritAgentClassify", () => {
  test("detects generic website lead subject", () => {
    expect(isGenericLeadFormSubject("דרים איילנד - התקבלה פניה מלידים")).toBe(true);
    expect(isGenericLeadFormSubject("שאלה על סוויטה")).toBe(false);
  });

  test("complaint maps to complaints tab", () => {
    const t = { category: "complaint", subject: "x", from_name: "אירנה" };
    expect(threadMatchesTab(t, "complaints")).toBe(true);
    expect(threadMatchesTab(t, "leads")).toBe(false);
    expect(categoryMeta("complaint").label).toContain("תלונה");
  });

  test("lead maps to leads tab", () => {
    const t = { category: "lead", subject: "דרים איילנד - התקבלה פניה מלידים", from_name: "דני" };
    expect(threadMatchesTab(t, "leads")).toBe(true);
    expect(threadDisplayTitle({ ...t, ai_summary: "מעוניין בסוויטה לסוף שבוע" })).toContain("מעוניין");
  });

  test("generic subject uses summary not subject line", () => {
    const title = threadDisplayTitle({
      category: "complaint",
      subject: "דרים איילנד - התקבלה פניה מלידים",
      from_name: "אירנה",
      ai_summary: "תלונה חמורה על אירוע יום נישואין",
      from_email: "a@b.com",
    });
    expect(title).toContain("תלונה חמורה");
    expect(title).not.toContain("לידים");
  });
});
