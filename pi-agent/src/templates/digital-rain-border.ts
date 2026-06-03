import type { TemplateRender } from "./index.ts";
import { centerInWidth } from "./index.ts";

const render: TemplateRender = (theme, w) => {
  const l1 = theme.fg("lime", "ｱｲｳｴｵｶｷｸ");
  const l2 = theme.fg("text", "F.R.I.D.A.Y.");
  const l3 = theme.fg("muted", "ghost.online · v2.0");
  const l4 = theme.fg("lime", "ﾅﾆﾇﾈﾉﾊﾋﾌ");
  return [centerInWidth(l1, w), centerInWidth(l2, w), centerInWidth(l3, w), centerInWidth(l4, w)];
};
export default render;
