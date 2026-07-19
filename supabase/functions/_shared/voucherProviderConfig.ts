// Re-exports strategy profiles + Hever/Police package inference (used by voucherPdfParse).

export {
  type VoucherProviderKey,
  type VoucherProviderProfile,
  VOUCHER_PROVIDER_PROFILES,
  resolveVoucherProviderProfile,
} from "./voucherReconciliationStrategy.ts";

/** Unit price (₪) → package label for Hever/Police PDF rows (no explicit package column). */
export function inferHeverPolicePackage(unitPrice: number, org: string): string | null {
  const isPolice = /שוטר/i.test(org);
  const p = Math.round(unitPrice * 100) / 100;
  if (isPolice) {
    if (p >= 690 && p <= 700) return "שוטרים מבצע דלאקס";
    if (p >= 775 && p <= 785) return "שוטרים דלאקס";
    if (p >= 448 && p <= 458) return "שוטרים מבצע קלאסיק";
    if (p >= 538 && p <= 548) return "שוטרים קלאסיק וארוחת צהרים";
  } else {
    if (p >= 775 && p <= 785) return "חבר דלאקס";
    if (p >= 755 && p <= 765) return "חבר דלאקס";
    if (p >= 528 && p <= 538) return "חבר קלאסיק עם ארוחת צהרים";
    if (p >= 538 && p <= 548) return "חבר קלאסיק עם ארוחת צהרים";
    if (p >= 2525 && p <= 2545) return "חבר פרימיום";
  }
  return null;
}
