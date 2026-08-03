/** @jest-environment node */
import {
  botScriptToMetaTemplateBody,
  detectMetaScriptDrift,
  normalizeTemplateBodyForCompare,
  templateBodiesMatch,
} from "./metaTemplateDrift";

const CANONICAL = "כניסה למתחם החל מהשעה 12:00";
const STALE = "מתקני הריזורט, הבריכות והמתחמים פתוחים עבורכם כבר מהשעה 09:00";

describe("metaTemplateDrift", () => {
  test("botScriptToMetaTemplateBody", () => {
    expect(botScriptToMetaTemplateBody("היי {{GUEST_NAME}}")).toBe("היי {{1}}");
  });

  test("detectMetaScriptDrift flags 09:00 vs 12:00", () => {
    const script = `בוקר אור {{GUEST_NAME}}!\n🌸 ${CANONICAL}`;
    const meta = `בוקר אור {{1}}!\n🌸 ${STALE}`;
    expect(detectMetaScriptDrift(meta, script)).toMatch(/פער תוכן/);
  });

  test("detectMetaScriptDrift null when aligned", () => {
    const body = `בוקר {{1}} — ${CANONICAL}`;
    const script = `בוקר {{GUEST_NAME}} — ${CANONICAL}`;
    expect(detectMetaScriptDrift(body, script)).toBeNull();
  });

  test("normalizeTemplateBodyForCompare", () => {
    expect(normalizeTemplateBodyForCompare("a  b")).toBe("a b");
    expect(templateBodiesMatch("{{1}} x", "{{GUEST_NAME}} x")).toBe(true);
  });
});
