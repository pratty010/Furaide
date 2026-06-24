import type { ArcCell, FieldArt } from "../index.ts";
import { AR, zoneColor } from "../index.ts";

/** Log-spiral: z = fract(theta/(2π) + k·log(r/r_ref)). Arms emerge as
    level sets of z near 0 and 0.5. */
export const kamiWhirlpool: FieldArt = {
  name: "kami-whirlpool",
  substrate: "code",
  render(cols, rows, subs) {
    const cx = (cols - 1) / 2;
    const cy = (rows - 1) / 2;
    const rRef = 2;
    const k = 0.55;
    const grid: ArcCell[][] = [];
    let i = 0;
    for (let r = 0; r < rows; r++) {
      const row: ArcCell[] = [];
      for (let c = 0; c < cols; c++) {
        const dx = c - cx;
        const dy = (r - cy) / AR;
        const radius = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
        if (radius < rRef * 0.5) {
          row.push({ char: subs[i % subs.length]!, color: "accent" });
          i++;
          continue;
        }
        const theta = Math.atan2(dy, dx);
        let z = ((theta / (2 * Math.PI)) + k * Math.log(radius / rRef));
        z = z - Math.floor(z);                    // fract
        // Make both z≈0 and z≈0.5 bright (two arms):
        const n = Math.min(Math.abs(z - 0.0), Math.abs(z - 0.5), Math.abs(z - 1.0)) * 2;
        const zc = zoneColor(n);
        row.push({ char: zc === "space" ? " " : subs[i % subs.length]!, color: zc === "space" ? "dim" : zc });
        i++;
      }
      grid.push(row);
    }
    return grid;
  },
};
