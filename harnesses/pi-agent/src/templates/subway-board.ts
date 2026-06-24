import type { TemplateRender } from "./index.ts";
import { centerInWidth } from "./index.ts";

const render: TemplateRender = (theme, w) => {
  const l1 = theme.fg("warning", "◄ ") + theme.fg("muted", "次の電車") + theme.fg("warning", " ►");
  const l2 = theme.fg("text", "FRIDAY LINE");
  const l3 = theme.fg("dim", "まもなく発車");
  const l4 = theme.fg("dim", "─".repeat(Math.min(w, 14)));
  return [centerInWidth(l1, w), centerInWidth(l2, w), centerInWidth(l3, w), centerInWidth(l4, w)];
};
export default render;
