/**
 * Client-side Meta template drift detection — mirrors
 * supabase/functions/_shared/metaTemplateCanonicalGuard.ts for ACC previews.
 */

export function botScriptToMetaTemplateBody(scriptBody) {
  return String(scriptBody ?? "")
    .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, "{{1}}")
    .trim();
}

export function normalizeTemplateBodyForCompare(text) {
  return String(text ?? "")
    .replace(/\{\{\s*\d+\s*\}\}/g, "{{}}")
    .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, "{{}}")
    .replace(/\s+/g, " ")
    .trim();
}

export function templateBodiesMatch(canonical, live) {
  const a = normalizeTemplateBodyForCompare(canonical);
  const b = normalizeTemplateBodyForCompare(live);
  if (!a || !b) return true;
  return a === b;
}

/** Returns Hebrew warning when live Meta body ≠ ACC session script. */
export function detectMetaScriptDrift(metaBodyText, sessionScriptText) {
  if (!metaBodyText?.trim() || !sessionScriptText?.trim()) return null;
  const canonical = botScriptToMetaTemplateBody(sessionScriptText);
  if (templateBodiesMatch(canonical, metaBodyText)) return null;
  return (
    "⚠️ פער תוכן: תבנית Meta החיה לא תואמת לסקריפט ACC. " +
    "שליחה אוטומטית דרך Dream Bot תיחסם עד שתאשרו את התבנית ב-Meta " +
    "או תעבירו את ערוץ האוטומציה ל-Whapi."
  );
}
