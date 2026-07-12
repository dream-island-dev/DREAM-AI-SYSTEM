import {
  buildTwoParamRoomVars,
  clearExpectedParamCountCache,
  countMetaBodyParams,
  fitVarsToExpectedCount,
  resolveExpectedBodyParamCount,
} from "./metaTemplateVars.ts";

Deno.test("countMetaBodyParams: highest placeholder index", () => {
  clearExpectedParamCountCache();
  const body = "שלום {{1}}, החדר {{2}} מוכן";
  if (countMetaBodyParams(body) !== 2) throw new Error("expected 2 params");
});

Deno.test("countMetaBodyParams: single placeholder", () => {
  const body = "🔑 {{1}}, הסוויטה שלך מוכנה";
  if (countMetaBodyParams(body) !== 1) throw new Error("expected 1 param");
});

Deno.test("fitVarsToExpectedCount: trims excess vars (132000 prevention)", () => {
  const fitted = fitVarsToExpectedCount(
    ["ליאור ורותי חזיזה", "רובי 3"],
    1,
    { guestName: "ליאור ורותי חזיזה" },
  );
  if (fitted.length !== 1) throw new Error(`expected 1 var, got ${fitted.length}`);
  if (fitted[0] !== "ליאור ורותי חזיזה") throw new Error(`unexpected name: ${fitted[0]}`);
});

Deno.test("fitVarsToExpectedCount: pads missing vars", () => {
  const fitted = fitVarsToExpectedCount(["ישראל"], 3);
  if (fitted.length !== 3) throw new Error("expected 3 vars");
  if (fitted[0] !== "ישראל") throw new Error("name mismatch");
  if (fitted[1] !== "12:00" || fitted[2] !== "15:00") throw new Error("timing pad mismatch");
});

Deno.test("buildTwoParamRoomVars: name + room", () => {
  const vars = buildTwoParamRoomVars({ name: "Test", room: "Suite 1" });
  if (vars[0] !== "Test" || vars[1] !== "Suite 1") throw new Error("room vars mismatch");
});

Deno.test("resolveExpectedBodyParamCount: dream_room_ready1 fallback is 1", async () => {
  clearExpectedParamCountCache();
  const count = await resolveExpectedBodyParamCount("dream_room_ready1");
  if (count !== 1) throw new Error(`dream_room_ready1 expected 1, got ${count}`);
});
