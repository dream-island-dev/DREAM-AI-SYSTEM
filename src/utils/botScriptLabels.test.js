import { isGarbledDbLabel, resolveBotScriptDisplayName, scriptKeyFriendly } from "./botScriptLabels";

describe("botScriptLabels", () => {
  test("isGarbledDbLabel detects question-mark corruption", () => {
    expect(isGarbledDbLabel("?????? ?????? ??? ???????? ????????")).toBe(true);
    expect(isGarbledDbLabel("בוקר הגעה — שבת (שלב 3)")).toBe(false);
  });

  test("resolveBotScriptDisplayName falls back to friendly map", () => {
    expect(resolveBotScriptDisplayName("stage_3_morning_shabbat", "????")).toBe(
      scriptKeyFriendly("stage_3_morning_shabbat"),
    );
    expect(resolveBotScriptDisplayName("stage_3_morning_shabbat", "בוקר הגעה — שבת (שלב 3)")).toBe(
      "בוקר הגעה — שבת (שלב 3)",
    );
  });
});
