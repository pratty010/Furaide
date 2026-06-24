import type { ArcCell, FieldArt } from "../index.ts";
import { AR, zoneColor } from "../index.ts";

let _phi = Math.PI / 2;

/** For each cell, compute min distance to the parametric curve
    (A*sin(a*t), B*sin(b*t + phi)), a:b = 5:4, animated phi. */
export const lissajousOrbit: FieldArt = {
  name: "lissajous-orbit",
  substrate: "code",
  animated: true,
  render(cols, rows, subs) {
    const cx = (cols - 1) / 2;
    const cy = (rows - 1) / 2;
    const A = (cols / 2) * 0.85;
    const B = ((rows / AR) / 2) * 0.85;
    const a = 5, b = 4;

    _phi = (_phi + 0.015) % (2 * Math.PI);
    const samples = 400;
    const pts: [number, number][] = [];
    for (let s = 0; s < samples; s++) {
      const t = (s / samples) * 2 * Math.PI;
      pts.push([A * Math.sin(a * t), B * Math.sin(b * t + _phi)]);
    }

    const norm = Math.max(A, B);
    const grid: ArcCell[][] = [];
    let i = 0;
    for (let r = 0; r < rows; r++) {
      const row: ArcCell[] = [];
      for (let c = 0; c < cols; c++) {
        const x = c - cx;
        const y = (r - cy) / AR;
        let best = Infinity;
        for (const [px, py] of pts) {
          const dx = x - px, dy = y - py;
          const d2 = dx * dx + dy * dy;
          if (d2 < best) best = d2;
        }
        const n = Math.sqrt(best) / (norm * 0.5);
        const zc = zoneColor(n);
        row.push({ char: zc === "space" ? " " : subs[i % subs.length]!, color: zc === "space" ? "dim" : zc });
        i++;
      }
      grid.push(row);
    }
    return grid;
  },
};
