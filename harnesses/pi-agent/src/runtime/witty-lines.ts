export interface WittyLine {
  emoji: string;
  english: string;
  japanese: string;
}

export const WITTY_LINES: ReadonlyArray<WittyLine> = [
  { emoji: "🌸", english: "Standing by, sir",          japanese: "待機中" },
  { emoji: "⚙️", english: "All systems nominal",        japanese: "全システム正常" },
  { emoji: "🎌", english: "At your service",            japanese: "お任せください" },
  { emoji: "🗾", english: "Awaiting your command",      japanese: "ご命令をどうぞ" },
  { emoji: "🍵", english: "Steady on the wire",         japanese: "静観中" },
  { emoji: "🌙", english: "Listening",                  japanese: "拝聴中" },
  { emoji: "🤖", english: "Online and attentive",       japanese: "起動完了" },
  { emoji: "🎐", english: "Hardware optimal",           japanese: "ハードウェア最適化" },
  { emoji: "🍶", english: "Ready when you are",         japanese: "準備完了" },
  { emoji: "🗼", english: "Holding the line",           japanese: "ライン保持" },
];

let _lastIndex = -1;

export function pickNextWitty(): WittyLine {
  if (WITTY_LINES.length === 0) {
    return { emoji: "•", english: "ready", japanese: "" };
  }
  let idx = Math.floor(Math.random() * WITTY_LINES.length);
  if (idx === _lastIndex && WITTY_LINES.length > 1) {
    idx = (idx + 1) % WITTY_LINES.length;
  }
  _lastIndex = idx;
  return WITTY_LINES[idx]!;
}

export function formatWitty(line: WittyLine): string {
  return line.japanese
    ? `${line.emoji} "${line.english} · ${line.japanese}"`
    : `${line.emoji} "${line.english}"`;
}

export function _resetForTests(): void {
  _lastIndex = -1;
}
