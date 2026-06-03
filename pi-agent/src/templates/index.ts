import { visibleWidth } from "@mariozechner/pi-tui";
import type { ExtensionContextTheme } from "../ui/types.ts";

export type Theme = ExtensionContextTheme;
export type TemplateRender = (theme: Theme, panelWidth: number) => string[];

export function centerInWidth(text: string, width: number): string {
  const vw = visibleWidth(text);
  if (vw >= width) return text;
  const padL = Math.floor((width - vw) / 2);
  const padR = width - vw - padL;
  return " ".repeat(padL) + text + " ".repeat(padR);
}

import arcadeCabinet from "./arcade-cabinet.ts";
import crtTerminal from "./crt-terminal.ts";
import neonSign from "./neon-sign.ts";
import gachaPlate from "./gacha-plate.ts";
import toriiGate from "./torii-gate.ts";
import diamondCrest from "./diamond-crest.ts";
import scroll from "./scroll.ts";
import scoreScreen from "./score-screen.ts";
import barcodeTag from "./barcode-tag.ts";
import waveCrest from "./wave-crest.ts";
import arcMedallion from "./arc-medallion.ts";
import chunkyCartridge from "./chunky-cartridge.ts";
import sakuraFrame from "./sakura-frame.ts";
import lanternRow from "./lantern-row.ts";
import kanjiStamps from "./kanji-stamps.ts";
import shrineSeal from "./shrine-seal.ts";
import digitalRainBorder from "./digital-rain-border.ts";
import edoScroll from "./edo-scroll.ts";
import levelSelect from "./level-select.ts";
import konbiniReceipt from "./konbini-receipt.ts";
import subwayBoard from "./subway-board.ts";
import ramenTicket from "./ramen-ticket.ts";
import wantedPoster from "./wanted-poster.ts";
import mangaPanel from "./manga-panel.ts";
import fortuneSlip from "./fortune-slip.ts";
import mahjongTiles from "./mahjong-tiles.ts";

export const TEMPLATE_SET: TemplateRender[] = [
  arcadeCabinet, crtTerminal, neonSign, gachaPlate, toriiGate, diamondCrest,
  scroll, scoreScreen, barcodeTag, waveCrest, arcMedallion, chunkyCartridge,
  sakuraFrame, lanternRow, kanjiStamps, shrineSeal, digitalRainBorder, edoScroll,
  levelSelect, konbiniReceipt, subwayBoard, ramenTicket,
  wantedPoster, mangaPanel, fortuneSlip, mahjongTiles,
];

export function pickTemplate(): TemplateRender {
  const forced = process.env.PI_FRIDAY_TEMPLATE;
  if (forced) {
    const idx = Number(forced);
    if (Number.isInteger(idx) && idx >= 0 && idx < TEMPLATE_SET.length) return TEMPLATE_SET[idx]!;
  }
  return TEMPLATE_SET[Math.floor(Math.random() * TEMPLATE_SET.length)]!;
}
