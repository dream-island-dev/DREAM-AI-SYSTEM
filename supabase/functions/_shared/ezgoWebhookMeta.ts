export function pickEzgoWebhookString(
  obj: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

export function extractEzgoWebhookMeta(
  payload: unknown,
): { event_type: string | null; external_id: string | null } {
  if (!payload || typeof payload !== "object") {
    return { event_type: null, external_id: null };
  }

  const root = payload as Record<string, unknown>;
  const nested =
    root.data && typeof root.data === "object"
      ? root.data as Record<string, unknown>
      : null;

  const event_type =
    pickEzgoWebhookString(root, ["event", "eventType", "event_type", "type", "action"]) ??
    (nested
      ? pickEzgoWebhookString(nested, ["event", "eventType", "event_type", "type", "action"])
      : null);

  const external_id =
    pickEzgoWebhookString(root, [
      "id",
      "orderId",
      "order_id",
      "reservationId",
      "reservation_id",
      "bookingId",
      "booking_id",
      "externalId",
      "external_id",
    ]) ??
    (nested
      ? pickEzgoWebhookString(nested, [
        "id",
        "orderId",
        "order_id",
        "reservationId",
        "reservation_id",
        "bookingId",
        "booking_id",
        "externalId",
        "external_id",
      ])
      : null);

  return { event_type, external_id };
}
