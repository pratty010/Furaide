import { CODE_SNIPPETS, KATAKANA_POOL, pickCodeSnippet } from "./substrates.ts";
import { arcReactor } from "./fields/arc-reactor.ts";
import { digitalRain } from "./fields/digital-rain.ts";
import { kamiWhirlpool } from "./fields/kami-whirlpool.ts";
import { eventHorizon } from "./fields/event-horizon.ts";
import { lissajousOrbit } from "./fields/lissajous-orbit.ts";
import { ripplePond } from "./fields/ripple-pond.ts";
import { scanlineCrt } from "./fields/scanline-crt.ts";
import { fridayBlock } from "./fields/friday-block.ts";

export type ArtColor = "text" | "accent" | "muted" | "dim";
export type ArcCell = { char: string; color: ArtColor };
export type FieldRenderFn = (cols: number, rows: number, subs: string) => ArcCell[][];

export interface FieldArt {
  name: string;
  substrate: "code" | "katakana";
  animated?: boolean;
  render: FieldRenderFn;
}

export const AR = 0.45;
export const ZONES = [0.2, 0.38, 0.55, 0.75, 0.9] as const;

export function zoneColor(n: number): ArtColor | "space" {
  if (n > ZONES[4]) return "space";
  if (n < ZONES[0]) return "accent";
  if (n < ZONES[1]) return "text";
  if (n < ZONES[2]) return "muted";
  if (n < ZONES[3]) return "dim";
  return "dim";
}

const ALL_FIELDS: FieldArt[] = [
  arcReactor, digitalRain, kamiWhirlpool, eventHorizon,
  lissajousOrbit, ripplePond, scanlineCrt, fridayBlock,
];

export function pickField(): FieldArt {
  return ALL_FIELDS[Math.floor(Math.random() * ALL_FIELDS.length)]!;
}

export function resolveSubstrate(field: FieldArt): string {
  return field.substrate === "katakana" ? KATAKANA_POOL : pickCodeSnippet();
}

export { CODE_SNIPPETS, KATAKANA_POOL };
