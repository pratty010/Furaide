import type { TemplateRender } from "./index.ts";
import { centerInWidth } from "./index.ts";

const render: TemplateRender = (theme, w) => {
  const rivets = theme.fg("accent", "▰▰▰▰▰▰▰▰▰");
  const name = theme.fg("accent", "▰ ") + theme.fg("text", "F.R.I.D.A.Y.") + theme.fg("accent", " ▰");
  const mode = theme.fg("accent", "▰ ") + theme.fg("muted", "[AUTOPILOT]") + theme.fg("accent", " ▰");
  return [centerInWidth(rivets, w), centerInWidth(name, w), centerInWidth(mode, w), centerInWidth(rivets, w)];
};
export default render;
