import type { TemplateRender } from "./index.ts";
import { centerInWidth } from "./index.ts";

const render: TemplateRender = (theme, w) => {
  const l1 = theme.fg("accent", "HI-1UP") + theme.fg("dim", "  ★  ") + theme.fg("warning", "CREDIT 01");
  const l2 = theme.fg("text", "F.R.I.D.A.Y.");
  const l3 = theme.fg("muted", "SCORE ") + theme.fg("lime", "099.97");
  const l4 = theme.fg("accent", "▸ ") + theme.fg("muted", "press start");
  return [centerInWidth(l1, w), centerInWidth(l2, w), centerInWidth(l3, w), centerInWidth(l4, w)];
};
export default render;
