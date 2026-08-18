/** Header sniff for EZGO spa-ops CSV vs Doc2 arrivals CSV. Mirror of src/utils/ezgoSpaActivitiesParser.js. */

export function isEzgoSpaActivitiesCsvText(text: string): boolean {
  const head = String(text ?? "").slice(0, 1200);
  return /sAttendantName/i.test(head) && /iAddsLineId/i.test(head) && /sActivityDesc/i.test(head);
}

export function isEzgoSpaActivitiesCsvBytes(data: Uint8Array): boolean {
  return isEzgoSpaActivitiesCsvText(new TextDecoder("utf-8", { fatal: false }).decode(data));
}
