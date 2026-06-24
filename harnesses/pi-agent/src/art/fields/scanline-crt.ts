import type { ArcCell, ArtColor, FieldArt } from "../index.ts";

/** Even rows are bright code, odd rows are dark scanlines. A slow vertical
    phosphor rolling bar modulates the bright rows. */
export const scanlineCrt: FieldArt = {
  name: "scanline-crt",
  substrate: "code",
  animated: true,
  render(cols, rows, subs) {
    const phase = (Date.now() / 500) % (2 * Math.PI);
    const grid: ArcCell[][] = [];
    let i = 0;
    for (let r = 0; r < rows; r++) {
      const row: ArcCell[] = [];
      for (let c = 0; c < cols; c++) {
        if (r % 2 !== 0) {
          row.push({ char: " ", color: "dim" });
          i++;
          continue;
        }
        // bright scanline row
        const zRaw = 0.05 + 0.15 * (0.5 + 0.5 * Math.sin(phase + r * 0.4));
        const isNoise = Math.random() < 0.02;
        const color: ArtColor = isNoise ? "text" : (zRaw < 0.1 ? "accent" : "text");
        row.push({ char: subs[i % subs.length]!, color });
        i++;
      }
      grid.push(row);
    }
    return grid;
  },
};
