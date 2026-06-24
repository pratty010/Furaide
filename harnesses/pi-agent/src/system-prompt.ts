import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

let _cachedAppend: string | null = null;

export function loadFridayAppend(): string {
  if (_cachedAppend != null) return _cachedAppend;
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "APPEND_SYSTEM.md");
  _cachedAppend = readFileSync(path, "utf8");
  return _cachedAppend;
}

/** Reset cache. Test-only. */
export function _resetCacheForTests(): void {
  _cachedAppend = null;
}

export function registerSystemPromptInjector(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    const ours = loadFridayAppend();
    const ev = event as any;
    const currentPrompt: string = ev.systemPrompt ?? "";
    const existingAppend: string = ev.systemPromptOptions?.appendSystemPrompt ?? "";

    let newPrompt: string;
    if (existingAppend && currentPrompt.endsWith(existingAppend)) {
      // Replace the existing append with ours prepended before it
      const base = currentPrompt.slice(0, -existingAppend.length);
      newPrompt = base + ours + "\n\n---\n\n" + existingAppend;
    } else if (existingAppend) {
      // Fallback: append ours with separator
      newPrompt = currentPrompt + "\n\n" + ours + "\n\n---\n\n" + existingAppend;
    } else {
      // No existing append: just append ours
      newPrompt = currentPrompt + "\n\n" + ours;
    }

    return { systemPrompt: newPrompt };
  });
}
