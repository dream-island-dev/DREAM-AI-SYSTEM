import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  __resetSpaGroupCampaignCacheForTest,
  buildSpaGroupCampaignReply,
  parseSpaGroupCampaignToken,
  parseSpaGroupCampaignsConfig,
  resolveCampaignByToken,
  resolveCampaignWithFallback,
  BUILTIN_SPA_GROUP_CAMPAIGNS,
} from "./spaGroupCampaign.ts";

Deno.test("parseSpaGroupCampaignToken: extracts XOS token from prefilled text", () => {
  assertEquals(
    parseSpaGroupCampaignToken("אשמח לתאם עיסוי — XOS-EVE-1008"),
    "XOS-EVE-1008",
  );
  assertEquals(parseSpaGroupCampaignToken("xos-eve-1008"), "XOS-EVE-1008");
  assertEquals(parseSpaGroupCampaignToken("שלום"), null);
});

Deno.test("parseSpaGroupCampaignsConfig: valid JSON", () => {
  const campaigns = parseSpaGroupCampaignsConfig({
    campaigns: [{
      id: "everest-2026-08-10",
      token: "XOS-EVE-1008",
      label: "אוורסט",
      arrival_date: "2026-08-10",
      enabled: true,
    }],
  });
  assertEquals(campaigns.length, 1);
  assertEquals(campaigns[0].token, "XOS-EVE-1008");
  assertEquals(campaigns[0].arrival_date, "2026-08-10");
});

Deno.test("resolveCampaignByToken: enabled only", () => {
  const campaigns = parseSpaGroupCampaignsConfig({
    campaigns: [
      { id: "a", token: "XOS-A", label: "A", arrival_date: "2026-08-10", enabled: false },
      { id: "b", token: "XOS-B", label: "B", arrival_date: "2026-08-11" },
    ],
  });
  assertEquals(resolveCampaignByToken(campaigns, "XOS-A"), null);
  assertEquals(resolveCampaignByToken(campaigns, "XOS-B")?.id, "b");
});

Deno.test("parseSpaGroupCampaignsConfig: string JSON from bot_config", () => {
  const raw = `{"campaigns":[{"id":"x","token":"XOS-X","label":"Test","arrival_date":"2026-08-10"}]}`;
  assertEquals(parseSpaGroupCampaignsConfig(raw)[0]?.token, "XOS-X");
});

Deno.test("resolveCampaignWithFallback: builtin when DB empty", () => {
  assertEquals(resolveCampaignWithFallback([], "XOS-EVE-1008")?.id, "everest-2026-08-10");
  assertEquals(resolveCampaignWithFallback([], "XOS-UNKNOWN"), null);
});

Deno.test("buildSpaGroupCampaignReply: spa-specific copy not generic handoff", () => {
  const reply = buildSpaGroupCampaignReply("דני");
  assertEquals(reply.includes("דני"), true);
  assertEquals(reply.includes("תיאום טיפול הספא"), true);
  assertEquals(reply.includes("אני בודק את זה מול הצוות"), false);
});

Deno.test("BUILTIN has everest token", () => {
  assertEquals(BUILTIN_SPA_GROUP_CAMPAIGNS.some((c) => c.token === "XOS-EVE-1008"), true);
});

Deno.test("cache reset hook", () => {
  __resetSpaGroupCampaignCacheForTest();
  assertEquals(true, true);
});
