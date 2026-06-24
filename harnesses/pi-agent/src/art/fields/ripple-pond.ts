import type { ArcCell, FieldArt } from "../index.ts";
import { AR, zoneColor } from "../index.ts";

/** z = 0.5 - 0.5*cos(k*r)*exp(-r/lambda). Concentric damped rings. */
export const ripplePond: FieldArt = {
  name: "ripple-pond",
  substrate: "code",
  animated: true,
  render(cols, rows, subs) {
    const cx = (cols - 1) / 2;
    const cy = (rows - 1) / 2;
    const maxR = Math.max(cols, rows / AR) / 2;
    const k = (2 * Math.PI * 4) / maxR;
    const lambda = maxR * 0.9;
    const phase = (Date.now() / 800) % (2 * Math.PI);
    const grid: ArcCell[][] = [];
    let i = 0;
    for (let r = 0; r < rows; r++) {
      const row: ArcCell[] = [];
      for (let c = 0; c < cols; c++) {
        const dx = c - cx;
        const dy = (r - cy) / AR;
        const radius = Math.sqrt(dx * dx + dy * dy);
        const z = 0.5 - 0.5 * Math.cos(k * radius - phase) * Math.exp(-radius / lambda);
        const zc = zoneColor(z);
        row.push({ char: zc === "space" ? " " : subs[i % subs.length]!, color: zc === "space" ? "dim" : zc });
        i++;
      }
      grid.push(row);
    }
    return grid;
  },
};
