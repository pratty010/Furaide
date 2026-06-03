import type { TemplateRender } from "./index.ts";
import { centerInWidth } from "./index.ts";

const render: TemplateRender = (theme, w) => {
  const wave = theme.fg("dim", "～～～～～～～～");
  const name = theme.fg("accent", "F.R.I.D.A.Y.");
  const ja = theme.fg("muted", "金  曜  日");
  return [centerInWidth(wave, w), centerInWidth(name, w), centerInWidth(ja, w), centerInWidth(wave, w)];
};
export default render;
