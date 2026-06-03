import type { TemplateRender } from "./index.ts";
import { centerInWidth } from "./index.ts";

const render: TemplateRender = (theme, w) => {
  const l1 = theme.fg("warning", "おみくじ ") + theme.fg("accent", "大吉");
  const l2 = theme.fg("text", "FRIDAY");
  const l3 = theme.fg("muted", "運勢 : ") + theme.fg("lime" as any, "最高");
  const l4 = theme.fg("dim", "─".repeat(Math.min(w, 14)));
  return [centerInWidth(l1, w), centerInWidth(l2, w), centerInWidth(l3, w), centerInWidth(l4, w)];
};
export default render;
