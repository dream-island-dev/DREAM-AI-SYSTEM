import { isGarbledDbText, resolveBotScriptDisplayName, scriptKeyFriendly } from "./botScriptLabels";

describe("botScriptLabels", () => {
  test("isGarbledDbText detects question-mark corruption", () => {
    expect(isGarbledDbText("?????? ?????? ??? ???????? ????????")).toBe(true);
    expect(isGarbledDbText("בוקר הגעה — שבת (שלב 3)")).toBe(false);
  });

  test("isGarbledDbText detects replacement-char and mojibake corruption", () => {
    expect(isGarbledDbText("��� בוקר")).toBe(true);
    expect(isGarbledDbText("cafÃ© rÃ©sumÃ© naÃ¯ve")).toBe(true);
    expect(isGarbledDbText("")).toBe(false);
    expect(isGarbledDbText(null)).toBe(false);
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
