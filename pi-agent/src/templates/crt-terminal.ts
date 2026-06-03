import type { TemplateRender } from "./index.ts";
import { centerInWidth } from "./index.ts";

const render: TemplateRender = (theme, w) => {
  const l1 = theme.fg("dim", "┌[ ") + theme.fg("cyan", "akiba://v2.0") + theme.fg("dim", " ]┐");
  const l2 = theme.fg("dim", "│ ") + theme.fg("accent", "> ") + theme.fg("text", "F.R.I.D.A.Y.") + theme.fg("accent", "_") + theme.fg("dim", " │");
  const l3 = theme.fg("dim", "│ ") + theme.fg("lime", "boot ok") + theme.fg("dim", " · ") + theme.fg("muted", "online") + theme.fg("dim", " │");
  const l4 = theme.fg("dim", "└──────────────┘");
  return [centerInWidth(l1, w), centerInWidth(l2, w), centerInWidth(l3, w), centerInWidth(l4, w)];
};
export default render;
