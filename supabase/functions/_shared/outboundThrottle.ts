// Shared outbound burst protection — whatsapp-cron enforces this between
// sequential whatsapp-send calls; any other bulk guest sender must import
// the same constant so Whapi/Meta never see an unthrottled burst.

/** Pause between individual guest outbound dispatches (Meta + Whapi safety). */
export const INTER_SEND_DELAY_MS = 2500;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
