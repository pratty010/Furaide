export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    const withProtocol = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
    try {
      url = new URL(withProtocol);
    } catch {
      return raw;
    }
  }

  url.hash = "";
  url.protocol = "https:";

  if (url.pathname.endsWith("/") && url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  url.hostname = url.hostname.toLowerCase();

  if (url.hostname.startsWith("www.")) {
    url.hostname = url.hostname.slice(4);
  }

  return url.toString();
}

export function isValidUrl(raw: string): boolean {
  try {
    new URL(raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`);
    return true;
  } catch {
    return false;
  }
}
