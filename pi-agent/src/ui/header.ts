import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { pickField, resolveSubstrate, type FieldArt, type ArcCell } from "../art/index.ts";

const ART_ROWS = 12;

let cachedGrid: ArcCell[][] | null = null;
let cachedCols = 0;
let field: FieldArt | null = null;
let subs = "";

export function registerHeader(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    field = pickField();
    subs = resolveSubstrate(field);
    cachedGrid = null;
    cachedCols = 0;

    ctx.ui.setHeader((tui, theme) => {
      return {
        dispose() {
        },
        invalidate() {
          cachedGrid = null;
        },
        handleInput(data: string) {
        },
        render(width: number) {
          const innerWidth = Math.max(50, width - 4);

          if (!field) return [];
          if (!cachedGrid || cachedCols !== innerWidth) {
            cachedCols = innerWidth;
            cachedGrid = field.render(innerWidth, ART_ROWS, subs);
          }

          const eq = "═".repeat(innerWidth + 2);
          const top = theme.fg("dim", `╔${eq}╗`);
          const bot = theme.fg("dim", `╚${eq}╝`);
          const side = theme.fg("dim", "║");

          const artLines: string[] = [];
          for (const row of cachedGrid) {
            let line = "";
            for (const cell of row) {
              line += theme.fg(cell.color, cell.char);
            }
            artLines.push(line);
          }

          const artHeight = artLines.length;
          const verticalPadTotal = Math.max(0, ART_ROWS - artHeight);
          const verticalPadTop = Math.floor(verticalPadTotal / 2);
          const verticalPadBottom = verticalPadTotal - verticalPadTop;

          const artWidth = cachedGrid.length > 0 ? cachedGrid[0]!.length : 0;
          const horizontalPadLeft = Math.max(0, Math.floor((innerWidth - artWidth) / 2));
          const centeredArt = artLines.map((line) => " ".repeat(horizontalPadLeft) + line);
          const blankLine = " ".repeat(innerWidth);

          const paddedArt = [
            ...Array(verticalPadTop).fill(blankLine),
            ...centeredArt,
            ...Array(verticalPadBottom).fill(blankLine),
          ];

          const displayRows: string[] = [];
          for (const line of paddedArt) {
            displayRows.push(`${side} ${line} ${side}`);
          }

          return [
            top,
            ...displayRows,
            bot,
          ];
        },
      };
    });
  });

}

export default registerHeader;
