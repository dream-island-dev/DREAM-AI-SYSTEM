// Canonical Google "write a review" link for Dream Island (Sde Yoav).
// Place ID confirmed via Maps listing (phone 08-670-5600) + Waze place.ChIJ*.
// Do not use Waze /ul/ navigation shorts as GOOGLE_REVIEW_URL.

export const DEFAULT_GOOGLE_REVIEW_URL =
  "https://search.google.com/local/writereview?placeid=ChIJzaIHH_ybAhURhKnG4XXJDGo";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function withHttps(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

export function resolveGoogleReviewUrl(raw?: string | null): string {
  const v = String(raw ?? "").trim();
  if (!v) return DEFAULT_GOOGLE_REVIEW_URL;

  const href = withHttps(v);
  const host = hostOf(href);
  if (!host) return DEFAULT_GOOGLE_REVIEW_URL;
  if (host === "waze.com" || host.endsWith(".waze.com")) return DEFAULT_GOOGLE_REVIEW_URL;

  const path = (() => {
    try {
      return new URL(href).pathname.replace(/\/+$/, "") || "/";
    } catch {
      return "/";
    }
  })();
  if (
    (host === "dream-island.co.il" || host === "www.dream-island.co.il")
    && (path === "/" || path === "")
  ) {
    return DEFAULT_GOOGLE_REVIEW_URL;
  }

  return href;
}
