import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isEzgoSpaActivitiesCsvText } from "./ezgoSpaActivitiesCsvDetect.ts";

Deno.test("spa-ops header vs Doc2 arrivals", () => {
  assertEquals(
    isEzgoSpaActivitiesCsvText("iItemId,iLineStatus,iAddsLineId,sAttendantName,sActivityDesc\n"),
    true,
  );
  assertEquals(
    isEzgoSpaActivitiesCsvText("iOrderId,sTel1,sClientFullName,sRoomName\n"),
    false,
  );
});
