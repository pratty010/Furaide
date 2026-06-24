import type { ArcCell, FieldArt } from "../index.ts";
import { AR, zoneColor } from "../index.ts";

export const arcReactor: FieldArt = {
  name: "arc-reactor",
  substrate: "code",
  render(cols, rows, subs) {
    const cx = (cols - 1) / 2;
    const cy = (rows - 1) / 2;
    const maxR = Math.max(cols, rows / AR) / 2;
    const grid: ArcCell[][] = [];
    let i = 0;
    for (let r = 0; r < rows; r++) {
      const row: ArcCell[] = [];
      for (let c = 0; c < cols; c++) {
        const dx = c - cx;
        const dy = (r - cy) / AR;
        const rawD = Math.sqrt(dx * dx + dy * dy);
        if (rawD / maxR < 0.12) {
          row.push({ char: subs[i % subs.length]!, color: "accent" });
          i++;
          continue;
        }
        const theta = Math.atan2(dy, dx);
        const spoke = 1 + 0.15 * Math.sin(6 * theta);
        const d = (rawD * spoke) / maxR;
        const zc = zoneColor(d);
        row.push({ char: zc === "space" ? " " : subs[i % subs.length]!, color: zc === "space" ? "dim" : zc });
        i++;
      }
      grid.push(row);
    }
    return grid;
  },
};
