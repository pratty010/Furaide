export function truncate(text: string, maxChars: number = 10_000): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n... [truncated]";
}

export function sanitizeOutput(value: unknown, maxDepth: number = 5, currentDepth: number = 0): unknown {
  if (currentDepth > maxDepth) return "[max depth]";

  if (value === null || value === undefined) return value;
  if (typeof value === "string") return truncate(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeOutput(item, maxDepth, currentDepth + 1));
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = sanitizeOutput(val, maxDepth, currentDepth + 1);
    }
    return result;
  }

  return String(value);
}
