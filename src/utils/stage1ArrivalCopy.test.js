import {
  ARRIVAL_CONFIRM_CTA_HE,
  ensureArrivalConfirmationCta,
  metaTemplateBodyToBotScript,
  parseStage1AutoAppendCta,
  resolveStage1OutboundBody,
  stage1WillAutoAppendCta,
} from "./stage1ArrivalCopy";

describe("stage1ArrivalCopy", () => {
  test("metaTemplateBodyToBotScript converts {{1}} to GUEST_NAME", () => {
    expect(metaTemplateBodyToBotScript("היי {{1}}!")).toBe("היי {{GUEST_NAME}}!");
  });

  test("resolveStage1OutboundBody appends CTA when enabled and missing", () => {
    const body = "שלום {{GUEST_NAME}}!";
    const out = resolveStage1OutboundBody(body, { autoAppendCta: true });
    expect(out).toContain("שלום דניאל כהן!");
    expect(out).toContain(ARRIVAL_CONFIRM_CTA_HE);
  });

  test("resolveStage1OutboundBody skips CTA when disabled", () => {
    const body = "שלום {{GUEST_NAME}}!";
    expect(resolveStage1OutboundBody(body, { autoAppendCta: false })).toBe("שלום דניאל כהן!");
  });

  test("stage1WillAutoAppendCta respects toggle and existing phrase", () => {
    const withCta = 'כתבו "כן, מגיעים!"';
    expect(stage1WillAutoAppendCta(withCta, true)).toBe(false);
    expect(stage1WillAutoAppendCta("שלום", true)).toBe(true);
    expect(stage1WillAutoAppendCta("שלום", false)).toBe(false);
  });

  test("parseStage1AutoAppendCta defaults on", () => {
    expect(parseStage1AutoAppendCta(undefined)).toBe(true);
    expect(parseStage1AutoAppendCta("false")).toBe(false);
  });

  test("ensureArrivalConfirmationCta mirrors edge module", () => {
    expect(ensureArrivalConfirmationCta("טקסט", { autoAppend: false })).toBe("טקסט");
  });
});
