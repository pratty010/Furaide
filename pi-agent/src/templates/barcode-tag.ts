import type { TemplateRender } from "./index.ts";
import { centerInWidth } from "./index.ts";

const render: TemplateRender = (theme, w) => {
  const bar = theme.fg("text", "▐█▐▌█▐█▌▐▌█");
  const name = theme.fg("accent", "F.R.I.D.A.Y.");
  const id = theme.fg("muted", "id · ") + theme.fg("lime", "4297-3310");
  return [centerInWidth(bar, w), centerInWidth(name, w), centerInWidth(id, w), centerInWidth(bar, w)];
};
export default render;
