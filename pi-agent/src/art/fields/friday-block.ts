import type { ArcCell, FieldArt } from "../index.ts";

const FRIDAY_BLOCK_LINES = [
  " ███████ ██████  ██ ██████   █████  ██    ██",
  " ██      ██   ██ ██ ██   ██ ██   ██  ██  ██ ",
  " █████   ██████  ██ ██   ██ ███████   ████  ",
  " ██      ██   ██ ██ ██   ██ ██   ██    ██   ",
  " ██      ██   ██ ██ ██████  ██   ██    ██   ",
  "                                             ",
  "         ╭───[  ◉  ARC-9000  ◉  ]───╮        ",
  "         │       F.R.I.D.A.Y.        │        ",
  "         │   tactical · responsive   │        ",
  "         ╰───────────────────────────╯        ",
];

export const fridayBlock: FieldArt = {
  name: "friday-block",
  substrate: "code",
  animated: false,
  render(cols, rows) {
    const grid: ArcCell[][] = [];

    for (const line of FRIDAY_BLOCK_LINES) {
      const row: ArcCell[] = [];
      for (const char of line) {
        row.push({ char, color: "text" });
      }
      grid.push(row);
    }

    return grid;
  },
};
