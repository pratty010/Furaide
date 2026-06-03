import type { TemplateRender } from "./index.ts";
import { centerInWidth } from "./index.ts";

const render: TemplateRender = (theme, w) => {
  const l1 = theme.fg("accent", "◆◇◆◇◆ ") + theme.fg("warning", "御朱印") + theme.fg("accent", " ◆◇◆◇◆");
  const l2 = theme.fg("text", "F.R.I.D.A.Y.");
  const l3 = theme.fg("muted", "stamped · ") + theme.fg("lime", "blessed");
  const l4 = theme.fg("accent", "◆◇◆◇◆━━━◆◇◆");
  return [centerInWidth(l1, w), centerInWidth(l2, w), centerInWidth(l3, w), centerInWidth(l4, w)];
};
export default render;
