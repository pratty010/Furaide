import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerHeader } from "./ui/header.ts";
import { registerFooter } from "./ui/footer.ts";
import { registerWidgets } from "./ui/widgets.ts";

export function registerFridayTheme(pi: ExtensionAPI): void {
  registerHeader(pi);
  registerFooter(pi);
  registerWidgets(pi);

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setTheme("friday");
  });
}

export default registerFridayTheme;
