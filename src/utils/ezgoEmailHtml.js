// EZGO Operations daily report — extract HTML from Gmail download (.eml) or raw paste.

export function decodeQuotedPrintable(input) {
  const softBreaks = String(input).replace(/=\r?\n/g, "");
  const bytes = [];
  for (let i = 0; i < softBreaks.length; i++) {
    if (softBreaks[i] === "=" && i + 2 < softBreaks.length) {
      const hex = softBreaks.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(softBreaks.charCodeAt(i) & 0xff);
  }
  try {
    return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
  } catch {
    return String.fromCharCode(...bytes);
  }
}

function _partBody(part) {
  const split = part.split(/\r?\n\r?\n/);
  if (split.length < 2) return "";
  let body = split.slice(1).join("\n\n");
  body = body.replace(/\r?\n--[^\r\n]+[\s\S]*$/, "").trim();

  const cte = part.match(/content-transfer-encoding:\s*([^\s;]+)/i)?.[1]?.toLowerCase();
  if (cte === "quoted-printable") return decodeQuotedPrintable(body);
  if (cte === "base64") {
    try {
      const bin = atob(body.replace(/\s/g, ""));
      const arr = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder("utf-8").decode(arr);
    } catch {
      return "";
    }
  }
  return body;
}

export function extractHtmlFromEml(emlText) {
  const raw = String(emlText || "");
  if (!raw.trim()) return null;

  const boundary = raw.match(/boundary="?([^"\r\n;]+)"?/i)?.[1];
  const chunks = boundary
    ? raw.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"))
    : [raw];

  for (const part of chunks) {
    if (!/content-type:\s*text\/html/i.test(part)) continue;
    const body = _partBody(part);
    if (/<table[\s>]/i.test(body)) return body;
  }

  const inline = raw.match(/<html[\s\S]*?<\/html>/i);
  if (inline && /<table[\s>]/i.test(inline[0])) return inline[0];
  return null;
}

export function looksLikeDoc1Html(text) {
  const s = String(text || "").trimStart().replace(/^\uFEFF/, "");
  return /<!DOCTYPE\s+html|<html[\s>]|<table[\s>]/i.test(s);
}

export function looksLikeEml(text) {
  const s = String(text || "");
  return (
    /content-type:\s*multipart/i.test(s)
    || (/^from:/im.test(s) && /content-type:\s*text\/html/i.test(s))
  );
}

/** Returns HTML string for Doc 1 parser, or null if not recognizable. */
export function resolveEzgoHtmlFromUpload({ text, filename = "" }) {
  const raw = String(text || "");
  if (!raw.trim()) return null;

  const isEml = /\.eml$/i.test(filename) || looksLikeEml(raw);
  if (isEml) {
    const fromEml = extractHtmlFromEml(raw);
    if (fromEml) return fromEml;
  }

  if (looksLikeDoc1Html(raw)) return raw.trimStart().replace(/^\uFEFF/, "");
  return null;
}
