import type { TemplateRender } from "./index.ts";
import { centerInWidth } from "./index.ts";
import { pickMode } from "../art/data.ts";

const render: TemplateRender = (theme, w) => {
  const top = theme.fg("accent", "╔═══════════════╗");
  const mid = theme.fg("accent", "║ ") + theme.fg("text", "F.R.I.D.A.Y.") + theme.fg("accent", " ║");
  const mode = theme.fg("accent", "║ ") + theme.fg("muted", pickMode().padEnd(13).slice(0, 13)) + theme.fg("accent", " ║");
  const bot = theme.fg("accent", "╚═══════════════╝");
  return [centerInWidth(top, w), centerInWidth(mid, w), centerInWidth(mode, w), centerInWidth(bot, w)];
};
export default render;
