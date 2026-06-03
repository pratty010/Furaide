import type { TemplateRender } from "./index.ts";
import { centerInWidth } from "./index.ts";

const render: TemplateRender = (theme, w) => {
  const l1 = theme.fg("muted", "「 ") + theme.fg("text", "F.R.I.D.A.Y.") + theme.fg("muted", " 」");
  const l2 = theme.fg("accent", "金曜日");
  const l3 = theme.fg("dim", "\"") + theme.fg("muted", "zen mode") + theme.fg("dim", "\"");
  const l4 = theme.fg("dim", "─ quantum ─");
  return [centerInWidth(l1, w), centerInWidth(l2, w), centerInWidth(l3, w), centerInWidth(l4, w)];
};
export default render;
