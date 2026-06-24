import type { ArcCell, ArtColor, FieldArt } from "../index.ts";

let _cols = 0;
let _heads: number[] = [];
let _speeds: number[] = [];
let _lastMs = 0;

export const digitalRain: FieldArt = {
  name: "digital-rain",
  substrate: "katakana",
  animated: true,
  render(cols, rows, subs) {
    const now = Date.now();
    if (cols !== _cols) {
      _cols = cols;
      _heads = Array.from({ length: cols }, () => Math.random() * rows);
      _speeds = Array.from({ length: cols }, () => 1.5 + Math.random() * 2.5);
      _lastMs = now;
    }
    const dt = Math.min((now - _lastMs) / 1000, 0.1);
    _lastMs = now;
    for (let c = 0; c < cols; c++) {
      _heads[c] = (_heads[c]! + _speeds[c]! * dt) % rows;
    }
    const grid: ArcCell[][] = [];
    let i = 0;
    for (let r = 0; r < rows; r++) {
      const row: ArcCell[] = [];
      for (let c = 0; c < cols; c++) {
        const dist = (r - Math.floor(_heads[c]!) + rows) % rows;
        let color: ArtColor;
        if (dist === 0)     color = "accent";
        else if (dist <= 2) color = "text";
        else if (dist <= 4) color = "muted";
        else                color = "dim";
        const char = dist > 6 ? " " : subs[i % subs.length]!;
        row.push({ char, color });
        i++;
      }
      grid.push(row);
    }
    return grid;
  },
};
