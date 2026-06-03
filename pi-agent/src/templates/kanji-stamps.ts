import type { TemplateRender } from "./index.ts";
import { centerInWidth } from "./index.ts";

const render: TemplateRender = (theme, w) => {
  const l1 = theme.fg("accent", "【 ") + theme.fg("text", "F.R.I.D.A.Y.") + theme.fg("accent", " 】");
  const l2 = theme.fg("accent", "神") + theme.fg("dim", " │ ") +
             theme.fg("accent", "速") + theme.fg("dim", " │ ") +
             theme.fg("accent", "零") + theme.fg("dim", " │ ") +
             theme.fg("accent", "界");
  const l3 = theme.fg("dim", "\"") + theme.fg("muted", "無。empty returns.") + theme.fg("dim", "\"");
  const l4 = theme.fg("muted", "禅モード");
  return [centerInWidth(l1, w), centerInWidth(l2, w), centerInWidth(l3, w), centerInWidth(l4, w)];
};
export default render;
