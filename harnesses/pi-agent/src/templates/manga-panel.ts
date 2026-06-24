import type { TemplateRender } from "./index.ts";
import { centerInWidth } from "./index.ts";

const render: TemplateRender = (theme, w) => {
  const l1 = theme.fg("dim", "「") + theme.fg("text", " 起動完了！") + theme.fg("dim", "」");
  const l2 = theme.fg("accent", "＊FRIDAY＊");
  const l3 = theme.fg("dim", "— ") + theme.fg("muted", "了解です") + theme.fg("dim", " —");
  const l4 = theme.fg("dim", "─".repeat(Math.min(w, 14)));
  return [centerInWidth(l1, w), centerInWidth(l2, w), centerInWidth(l3, w), centerInWidth(l4, w)];
};
export default render;
