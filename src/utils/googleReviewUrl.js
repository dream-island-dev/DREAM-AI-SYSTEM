// Mirror of supabase/functions/_shared/googleReviewUrl.ts

export const DEFAULT_GOOGLE_REVIEW_URL =
  "https://search.google.com/local/writereview?placeid=ChIJzaIHH_ybAhURhKnG4XXJDGo";

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function withHttps(raw) {
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

export function resolveGoogleReviewUrl(raw) {
  const v = String(raw ?? "").trim();
  if (!v) return DEFAULT_GOOGLE_REVIEW_URL;

  const href = withHttps(v);
  const host = hostOf(href);
  if (!host) return DEFAULT_GOOGLE_REVIEW_URL;
  if (host === "waze.com" || host.endsWith(".waze.com")) return DEFAULT_GOOGLE_REVIEW_URL;

  let path = "/";
  try {
    path = new URL(href).pathname.replace(/\/+$/, "") || "/";
  } catch {
    path = "/";
  }
  if (
    (host === "dream-island.co.il" || host === "www.dream-island.co.il")
    && (path === "/" || path === "")
  ) {
    return DEFAULT_GOOGLE_REVIEW_URL;
  }

  return href;
}
