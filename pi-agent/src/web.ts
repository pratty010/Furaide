import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import registerWebTools from "./web/index.ts";
import registerWebActivity from "./web/web-activity.ts";

export function registerFridayWeb(pi: ExtensionAPI): void {
  registerWebTools(pi);
  registerWebActivity(pi);
}

export default registerFridayWeb;
