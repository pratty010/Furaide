import type { TemplateRender } from "./index.ts";
import { centerInWidth } from "./index.ts";

const render: TemplateRender = (theme, w) => {
  const stripe = theme.fg("accent", "◢◤◢◤◢◤◢◤◢◤");
  const star = theme.fg("warning", "★ ") + theme.fg("text", "F.R.I.D.A.Y.") + theme.fg("warning", " ★");
  const gacha = theme.fg("muted", "GACHA") + theme.fg("dim", " · ") + theme.fg("lime", "¥420");
  return [centerInWidth(stripe, w), centerInWidth(star, w), centerInWidth(gacha, w), centerInWidth(stripe, w)];
};
export default render;
