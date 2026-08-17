import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  automationScopeFromSalesSegmentKind,
  kindFromSalesSegmentLabel,
  kindFromSegmentMap,
  parseEzgoSalesSegmentId,
} from "./ezgoSalesSegment.ts";

Deno.test("SalesSegment id parse + Hebrew labels", () => {
  assertEquals(parseEzgoSalesSegmentId(3), 3);
  assertEquals(parseEzgoSalesSegmentId("10"), 10);
  assertEquals(kindFromSalesSegmentLabel("בודדים"), "individual");
  assertEquals(kindFromSalesSegmentLabel("קבוצות ישירות"), "direct_group");
  assertEquals(kindFromSalesSegmentLabel(""), null);
});

Deno.test("unmapped id is FAIL VISIBLE until staff maps", () => {
  const map = new Map<number, "individual" | "direct_group">([[3, "individual"]]);
  assertEquals(kindFromSegmentMap(3, map), "individual");
  assertEquals(kindFromSegmentMap(10, map), "unmapped");
  assertEquals(kindFromSegmentMap(null, map), "unmapped");
  assertEquals(automationScopeFromSalesSegmentKind("direct_group"), "courtesy_only");
  assertEquals(automationScopeFromSalesSegmentKind("individual"), null);
});
