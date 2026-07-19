// Mirror of supabase/functions/_shared/voucherQuantityAudit.ts (UI only).

const CLASSIC_RE = /classic|קלאסיק|קלאסי|classic&more|classic&dinner/i;
const DELUXE_RE = /deluxe|דלקס|דלאקס/i;

const GROUP_COMPAT = {
  classic_general: ["classic_general", "classic_day"],
  classic_day: ["classic_general", "classic_day"],
  classic_evening: ["classic_evening"],
  classic_special: ["classic_special", "classic_day", "classic_general", "classic_evening"],
  deluxe_general: ["deluxe_general", "deluxe_special"],
  deluxe_special: ["deluxe_general", "deluxe_special"],
};

export function normalizePackageLabel(raw) {
  if (raw == null) return null;
  let s = String(raw).replace(/[\u200E\u200F\u202A-\u202E]/g, "").trim().toLowerCase();
  if (!s) return null;
  s = s
    .replace(/[״"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*\+\s*/g, " ")
    .replace(/\s*ו\s*/g, " ")
    .replace(/[.,\-–—/\\|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s.length ? s : null;
}

export function packageMatchGroup(label) {
  const n = normalizePackageLabel(label);
  if (!n) return null;
  const deluxe = DELUXE_RE.test(n);
  const classic = CLASSIC_RE.test(n);
  if (!classic && !deluxe) return null;
  const evening = /night|dinner|ערב|16:00|א-ד|א ד/.test(n);
  const day = /צהרים|lunch|כל השבוע|יום|day|בוקר|ארוחת צהר/.test(n);
  const special = /מבצע|special|ספיישל|חורף|יולי|קיץ/.test(n);
  if (deluxe) return special ? "deluxe_special" : "deluxe_general";
  if (evening) return "classic_evening";
  if (day) return "classic_day";
  if (special) return "classic_special";
  return "classic_general";
}

export function packageTypesMatchEnhanced(a, b) {
  const ga = packageMatchGroup(a);
  const gb = packageMatchGroup(b);
  if (ga && gb) {
    if (ga === gb) return true;
    const compat = GROUP_COMPAT[ga];
    if (compat && compat.includes(gb)) return true;
    if (ga.startsWith("deluxe") && gb.startsWith("deluxe")) return true;
  }
  const na = normalizePackageLabel(a);
  const nb = normalizePackageLabel(b);
  if (!na || !nb) return true;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  if (CLASSIC_RE.test(na) && CLASSIC_RE.test(nb)) return true;
  if (DELUXE_RE.test(na) && DELUXE_RE.test(nb)) return true;
  return false;
}

export const PACKAGE_GROUP_LABEL_HE = {
  classic_day: "קלאסיק (יום / צהרים)",
  classic_evening: "קלאסיק (ערב / night)",
  classic_special: "קלאסיק מבצע",
  classic_general: "קלאסיק",
  deluxe_general: "דלאקס",
  deluxe_special: "דלאקס מבצע",
};
