import type { ArcCell, FieldArt } from "../index.ts";
import { AR, zoneColor } from "../index.ts";

/** Bright ring at r ~= r0; hard void for r < r_inner (center cutout).
    Outer falloff via standard zone mapping. */
export const eventHorizon: FieldArt = {
  name: "event-horizon",
  substrate: "code",
  render(cols, rows, subs) {
    const cx = (cols - 1) / 2;
    const cy = (rows - 1) / 2;
    const maxR = Math.max(cols, rows / AR) / 2;
    const r0 = maxR * 0.45;
    const rInner = maxR * 0.18;
    const grid: ArcCell[][] = [];
    let i = 0;
    for (let r = 0; r < rows; r++) {
      const row: ArcCell[] = [];
      for (let c = 0; c < cols; c++) {
        const dx = c - cx;
        const dy = (r - cy) / AR;
        const radius = Math.sqrt(dx * dx + dy * dy);
        if (radius < rInner) {
          row.push({ char: " ", color: "dim" });
          i++;
          continue;
        }
        const theta = Math.atan2(dy, dx);
        const r0eff = r0 * (1 + 0.08 * Math.sin(5 * theta));
        const n = Math.abs(radius - r0eff) / r0;
        const zc = zoneColor(n);
        row.push({ char: zc === "space" ? " " : subs[i % subs.length]!, color: zc === "space" ? "dim" : zc });
        i++;
      }
      grid.push(row);
    }
    return grid;
  },
};
