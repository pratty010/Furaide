import { createHash } from "node:crypto";

export function hashString(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function hashRequest(parts: Record<string, unknown>): string {
  const sorted = Object.keys(parts)
    .sort()
    .map((key) => `${key}=${JSON.stringify(parts[key])}`)
    .join("&");
  return hashString(sorted);
}
