// Run: deno test --allow-env supabase/functions/_shared/oritSigalWhapiSend.test.ts

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  ORIT_CS_MOBILE_LINK_LABEL,
  composeOritCsMobileLinkLine,
  composeOritCsMobileLinkUrl,
  messageExpectsOritCsLinkFollowUp,
} from "./oritGuestOutbound.ts";

const THREAD_ID = "869b0a98-781a-4f3a-954c-7c263232d7b5";

Deno.test("composeOritCsMobileLinkLine — label only, no inline URL", () => {
  const line = composeOritCsMobileLinkLine(THREAD_ID);
  assertEquals(line, ORIT_CS_MOBILE_LINK_LABEL);
  assertEquals(line.includes("https://"), false);
  assertEquals(line.includes("orit_cs_agent"), false);
});

Deno.test("composeOritCsMobileLinkUrl — LTR-marked URL only", () => {
  const url = composeOritCsMobileLinkUrl(THREAD_ID);
  assertEquals(url.startsWith("\u200E"), true);
  assertEquals(url.includes("page=orit_cs_agent"), true);
  assertEquals(url.includes(`thread=${THREAD_ID}`), true);
});

Deno.test("messageExpectsOritCsLinkFollowUp — detects label in composed briefing", () => {
  const body = ["סטטוס", composeOritCsMobileLinkLine(THREAD_ID)].join("\n");
  assertEquals(messageExpectsOritCsLinkFollowUp(body), true);
  assertEquals(messageExpectsOritCsLinkFollowUp("שלום"), false);
});
