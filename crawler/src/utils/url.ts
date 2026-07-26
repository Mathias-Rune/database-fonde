const SKIP_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
  ".css",
  ".js",
  ".zip",
  ".mp4",
  ".mp3",
  ".woff",
  ".woff2"
];

export function normalizeUrl(rawUrl: string, baseUrl?: string): string | undefined {
  try {
    const url = new URL(rawUrl, baseUrl);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export function isSameDomain(candidate: string, root: string): boolean {
  const candidateHost = new URL(candidate).hostname.replace(/^www\./, "");
  const rootHost = new URL(root).hostname.replace(/^www\./, "");
  return candidateHost === rootHost || candidateHost.endsWith(`.${rootHost}`);
}

export function isProbablySkippableUrl(url: string): boolean {
  const parsed = new URL(url);
  const path = parsed.pathname.toLowerCase();
  if (SKIP_EXTENSIONS.some((extension) => path.endsWith(extension))) return true;
  if (/\/(privacy|cookies|cookie|persondata|gdpr|login|wp-admin|cart|shop)\b/.test(path)) return true;
  return false;
}

export function sourceTypeFromUrl(url: string): "html" | "pdf" | "other" {
  if (new URL(url).pathname.toLowerCase().endsWith(".pdf")) return "pdf";
  return "html";
}

export function domainKey(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}
