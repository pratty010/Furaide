import type { TemplateRender } from "./index.ts";
import { centerInWidth } from "./index.ts";

const render: TemplateRender = (theme, w) => {
  const torii = theme.fg("accent", "⛩");
  const bar = theme.fg("accent", "━━┯━━");
  const name = theme.fg("text", "F.R.I.D.A.Y.");
  const jp = theme.fg("muted", "神社モード");
  return [centerInWidth(torii, w), centerInWidth(bar, w), centerInWidth(name, w), centerInWidth(jp, w)];
};
export default render;
