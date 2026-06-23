#!/usr/bin/env bun
import type { DirectoryRow, SessionDetail } from "../db.ts";
import type { UiState, UiSession } from "./state.ts";
import { StyledText, type TextChunk } from "@opentui/core";
import { getSessionDetail, getArchivedSessionDetail } from "../db.ts";
import { currentSession, cwd, getVisibleRows } from "./state.ts";
import { actionChips, confirmOverlayText, searchResultsFor, searchVisibleSlice, SEARCH_VISIBLE_WINDOW } from "./actions.ts";
import { renderSafe } from "../sanitize.ts";

type ThemeDoc = {
  name: string;
  vars: Record<string, string>;
  pane: Record<string, string>;
};

type LooseChunk = { text: string; fg?: any; bg?: any; bold?: boolean };

function asStyledText(chunks: LooseChunk[]): StyledText {
  return new StyledText(chunks as unknown as TextChunk[]);
}

let _theme: ThemeDoc = { name: "default", vars: {}, pane: {} };

export function setTheme(t: ThemeDoc): void {
  _theme = t;
}

export function tone(slot: string): any {
  const key = _theme.pane[slot] || slot;
  return _theme.vars[key] || key;
}

export function parseModel(model: string): string {
  if (!model) return "-";
  try {
    const parsed = JSON.parse(model) as { providerID?: string; id?: string; variant?: string };
    return [parsed.providerID, parsed.id, parsed.variant].filter(Boolean).join("/").replace(/\/$/, "");
  } catch {
    return model;
  }
}

export function formatTime(epoch: number): string {
  if (!epoch) return "--:--:--";
  const d = new Date(epoch);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function pad(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return text + " ".repeat(width - text.length);
}

export function clip(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width === 1) return "\u2026";
  return `${text.slice(0, width - 1)}\u2026`;
}

export function fmtCost(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return value > 0 ? `$${value.toFixed(2)}` : "$0.00";
}

export function fmtCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs < 1_000) return String(value);
  if (abs < 1_000_000) return `${(value / 1_000).toFixed(abs < 10_000 ? 1 : 0)}K`;
  if (abs < 1_000_000_000) return `${(value / 1_000_000).toFixed(abs < 10_000_000 ? 1 : 0)}M`;
  return `${(value / 1_000_000_000).toFixed(1)}B`;
}

const MESSAGE_MAX_CHARS = 100;

export function capMessage(text: string, max = MESSAGE_MAX_CHARS): string {
  if (text.length <= max) return text;
  if (max <= 1) return "\u2026";
  return `${text.slice(0, max - 1)}\u2026`;
}

export function overlayBoxWidth(viewportWidth: number): number {
  return Math.min(Math.max(60, Math.min(100, viewportWidth - 4)), viewportWidth - 2);
}

export function selectedDetail(state: UiState): SessionDetail | null {
  const selected = currentSession(state);
  if (!selected) return null;
  if (state.tab === "archived") return getArchivedSessionDetail(selected.id);
  return getSessionDetail({ id: selected.id, cwd: cwd() });
}

export function buildMessagesContent(state: UiState): StyledText {
  const chunks: LooseChunk[] = [];
  const selected = currentSession(state);
  if (!selected) {
    chunks.push({ text: "Select a session\n", fg: tone("muted") });
    return asStyledText(chunks);
  }
  const msgs = state.messageRows.filter(m => m.role === "user" || m.role === "assistant");
  if (msgs.length === 0) {
    chunks.push({ text: "(no messages)\n", fg: tone("muted") });
    return asStyledText(chunks);
  }
  const rowWidth = Math.max(20, state.viewport.width - 12);
  const prefixLen = 8; // "HH:MM U "
  const wrapWidth = Math.max(10, rowWidth - prefixLen);

  function wrapText(text: string, width: number): string[] {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return [""];
    const words = clean.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      if (word.length > width) {
        if (line) { lines.push(line); line = ""; }
        for (let i = 0; i < word.length; i += width) {
          lines.push(word.slice(i, i + width));
        }
        continue;
      }
      if (line.length === 0) {
        line = word;
      } else if (line.length + 1 + word.length <= width) {
        line += " " + word;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  const start = Math.max(0, Math.min(state.messageScroll, msgs.length - 1));
  const visible = msgs.slice(start);
  if (msgs.length > 1) {
    chunks.push({ text: `Messages ${start + 1}-${msgs.length}/${msgs.length}\n`, fg: tone("dim") });
  }
  for (const m of visible) {
    const prefix = m.role === "user" ? "U" : "A";
    const timeStr = formatTime(m.time).slice(0, 5);
    const isUser = m.role === "user";
    const fg = isUser ? tone("cyan") : tone("text");
    const bg = isUser ? tone("listSelectedBg") : tone("surfaceAlt");
    const capped = capMessage(m.text);
    const lines = wrapText(capped, wrapWidth);
    for (let i = 0; i < lines.length; i++) {
      if (i === 0) {
        chunks.push({
          text: `${timeStr} ${prefix} ${lines[i]}\n`,
          fg,
          bg,
          bold: isUser,
        });
      } else {
        chunks.push({
          text: `${" ".repeat(prefixLen)}${lines[i]}\n`,
          fg,
          bg,
        });
      }
    }
    chunks.push({ text: "\n", fg: tone("muted") });
  }
  return asStyledText(chunks);
}

export function buildMetadataContent(
  state: UiState,
  detail?: SessionDetail | null,
): StyledText {
  const d = detail !== undefined ? detail : selectedDetail(state);
  const chunks: LooseChunk[] = [];
  if (!d) {
    chunks.push({ text: "No session selected\n", fg: tone("muted") });
    return asStyledText(chunks);
  }
  chunks.push({ text: `id: ${d.id}\n`, fg: tone("detailValue") });
  chunks.push({ text: `\uD83D\uDCC1 ${d.directory}${d.isCurrent ? " (cwd)" : ""}\n`, fg: tone("detailValue") });
  chunks.push({ text: `\uD83E\uDD16 ${d.agent || "-"} \u00B7 ${parseModel(d.model)}\n`, fg: tone("detailValue") });
  chunks.push({ text: `\uD83D\uDCB0 ${fmtCost(d.cost)}\n`, fg: tone("detailCost") });
  chunks.push({ text: `\uD83D\uDCCA in ${fmtCompact(d.tokensInput)} \u00B7 out ${fmtCompact(d.tokensOutput)} \u00B7 reasoning ${fmtCompact(d.tokensReasoning)}\n`, fg: tone("detailTokens") });
  chunks.push({ text: `\uD83D\uDDC2  cache r ${fmtCompact(d.tokensCacheRead)} \u00B7 w ${fmtCompact(d.tokensCacheWrite)}\n`, fg: tone("detailTokens") });
  chunks.push({ text: `\uD83D\uDCC5 created ${formatTime(d.timeCreated)} \u00B7 updated ${formatTime(d.timeUpdated)}${d.timeArchived ? ` \u00B7 archived ${formatTime(d.timeArchived)}` : ""}\n`, fg: tone("detailValue") });
  if (state.tab === "archived" && "archivePath" in d) {
    const ad = d as SessionDetail & { archivePath?: string; archiveBytes?: number };
    chunks.push({ text: `archive file: ${ad.archivePath || "-"}\n`, fg: tone("detailValue") });
    chunks.push({ text: `archive bytes: ${fmtCompact(ad.archiveBytes || 0)}\n`, fg: tone("detailValue") });
  }
  chunks.push({ text: `\uD83D\uDCC8 ${fmtCompact(d.summaryFiles)} files \u00B7 +${fmtCompact(d.summaryAdditions)} / -${fmtCompact(d.summaryDeletions)}\n`, fg: tone("detailValue") });
  if (state.tab === "active") {
    chunks.push({ text: `\uD83D\uDCCE ${d.diffPath ? `${d.diffPath} (${fmtCompact(d.diffBytes || 0)}b)` : "-"}\n`, fg: tone("detailValue") });
  }
  if (d.suspicious) {
    chunks.push({ text: "\u26A0 suspicious session\n", fg: tone("danger") });
  }
  if (d.toolCounts.length > 0) {
    chunks.push({ text: `\uD83D\uDD27 ${d.toolCounts.slice(0, 4).map(t => `${t.tool} ${fmtCompact(t.count)} ${t.status}`).join(" \u00B7 ")}\n`, fg: tone("success") });
  }
  const rowsVisible = Math.max(4, Math.floor(state.viewport.height * 0.35));
  const start = Math.max(0, Math.min(state.detailScroll, Math.max(0, chunks.length - rowsVisible)));
  return asStyledText(chunks.slice(start, start + rowsVisible));
}

export function buildSessionsContent(state: UiState): StyledText {
  const chunks: LooseChunk[] = [];
  const visible = getVisibleRows(state);
  const activeTab = state.tab === "active" ? "[Active]" : " Active ";
  const archivedTab = state.tab === "archived" ? "[Archived]" : " Archived ";
  chunks.push({ text: `${activeTab} ${archivedTab}  ${state.cursor + 1}/${Math.max(visible.length, 1)}\n`, fg: tone("text"), bg: tone("surfaceAlt"), bold: true });

  const maxRows = Math.max(4, Math.floor(state.viewport.height * 0.45));
  const start = Math.max(0, Math.min(state.listScroll, Math.max(0, visible.length - maxRows)));
  const end = Math.min(visible.length, start + maxRows + 2);

  for (let i = start; i < end; i++) {
    const item = visible[i];
    const isDir = item && !("id" in item);
    const isSelected = i === state.cursor;
    const marker = isSelected ? "\u276f " : "  ";
    if (isDir) {
      const dir = item as DirectoryRow;
      const isExpanded = state.expandedFolders.has(dir.directory);
      const prefix = isExpanded ? "\u25bc" : "\u25b6";
      const cwdMark = dir.directory.startsWith(cwd()) ? "\u25c9 " : "\u25cb ";
      const maxDirWidth = Math.max(10, state.viewport.width - 6);
      const label = `${marker}${cwdMark}${prefix} ${clip(dir.directory, maxDirWidth)}`;
      const color = dir.directory.startsWith(cwd()) ? tone("cyan") : tone("success");
      chunks.push({ text: label + "\n", fg: color, bold: isSelected });
    } else {
      const session = item as UiSession;
      const archive = session.timeArchived == null ? "" : "[A] ";
      const label = `${marker}  ${archive}${session.title}  ${formatTime(session.timeUpdated)}  ${fmtCost(session.cost)}`;
      const color = session.isCurrent ? tone("cyan") : tone("muted");
      chunks.push({ text: label + "\n", fg: color, bg: isSelected ? tone("listSelectedBg") : undefined });
    }
  }
  return asStyledText(chunks);
}
export function buildActionBarContent(state: UiState): StyledText {
  const chips = actionChips(state);
  const chunks: LooseChunk[] = [];
  for (let i = 0; i < chips.length; i++) {
    const chip = chips[i];
    let fg = tone("statusFg");
    let bold = false;
    if (chip.primary) { fg = tone("accent"); bold = true; }
    if (chip.danger) { fg = tone("danger"); bold = true; }
    if (i > 0) chunks.push({ text: " | ", fg: tone("dim"), bg: tone("statusBg") });
    chunks.push({ text: chip.label, fg, bg: tone("statusBg"), bold });
  }
  return asStyledText(chunks);
}

export function buildSearchOverlay(state: UiState): StyledText {
  const chunks: LooseChunk[] = [];
  const boxWidth = overlayBoxWidth(state.viewport.width);
  const inner = boxWidth - 2;
  const all = searchResultsFor(state);
  const visible = searchVisibleSlice(state);
  const start = Math.max(0, Math.min(state.searchScroll, Math.max(0, all.length - SEARCH_VISIBLE_WINDOW)));

  chunks.push({ text: `${clip("\uD83D\uDD0D Search Sessions", inner).padEnd(inner)}\n`, fg: tone("modalFg"), bg: tone("modalBg"), bold: true });
  const input = `> ${state.query}\u2588`;
  chunks.push({ text: `${clip(input, inner).padEnd(inner)}\n`, fg: tone("text"), bg: tone("modalBg") });
  if (all.length === 0) {
    chunks.push({ text: `${clip("No matches", inner).padEnd(inner)}\n`, fg: tone("muted"), bg: tone("modalBg") });
  } else {
    for (let i = 0; i < visible.length; i++) {
      const r = visible[i];
      const isSelected = (start + i) === state.searchSelected;
      const tabMarker = r.tab === "active" ? "[A]" : "[a]";
      const prefix = `${tabMarker} `;
      const dirPad = Math.min(r.session.directory.length, Math.max(10, inner * 0.35));
      const titleMax = Math.max(10, inner - dirPad - prefix.length - 5);
      const left = clip(r.session.title, titleMax);
      const row = `${isSelected ? "\u276f" : " "} ${prefix}${left.padEnd(titleMax)}  ${clip(r.session.directory, dirPad).padEnd(dirPad)}\n`;
      chunks.push({ text: row, fg: isSelected ? tone("accent") : tone("text"), bg: isSelected ? tone("listSelectedBg") : tone("modalBg") });
    }
    for (let i = visible.length; i < SEARCH_VISIBLE_WINDOW; i++) {
      chunks.push({ text: `${" ".repeat(inner)}\n`, fg: tone("modalFg"), bg: tone("modalBg") });
    }
  }
  const footer = all.length > SEARCH_VISIBLE_WINDOW
    ? `\u2191\u2193 select \u00B7 Enter open active only \u00B7 Esc cancel \u00B7 ${start + 1}\u2013${Math.min(start + SEARCH_VISIBLE_WINDOW, all.length)}/${all.length}`
    : "\u2191\u2193 select \u00B7 Enter open active only \u00B7 Esc cancel";
  chunks.push({ text: `${clip(footer, inner).padEnd(inner)}\n`, fg: tone("dim"), bg: tone("modalBg") });
  return asStyledText(chunks);
}

export function buildChoiceOverlay(state: UiState): StyledText {
  const chunks: LooseChunk[] = [];
  if (!state.pendingChoice) return asStyledText(chunks);
  const boxWidth = overlayBoxWidth(state.viewport.width);
  const inner = boxWidth - 2;
  const isBulk = !!state.pendingDirectory;
  const title = isBulk ? "Archive or Delete (bulk)" : "Archive or Delete";
  chunks.push({ text: `${clip(title, inner).padEnd(inner)}\n`, fg: tone("modalFg"), bg: tone("modalBg"), bold: true });
  const archiveLabel = isBulk ? "[A] Archive & delete all sessions" : "[A] Archive & delete session";
  const deleteLabel = isBulk ? "[D] Delete all sessions (no archive)" : "[D] Delete session only (no archive)";
  chunks.push({ text: `${clip(archiveLabel, inner).padEnd(inner)}\n`, fg: tone("accent"), bg: tone("modalBg") });
  chunks.push({ text: `${clip(deleteLabel, inner).padEnd(inner)}\n`, fg: tone("danger"), bg: tone("modalBg") });
  chunks.push({ text: `${clip("[C] Cancel", inner).padEnd(inner)}\n`, fg: tone("dim"), bg: tone("modalBg") });
  return asStyledText(chunks);
}

export function buildConfirmOverlay(state: UiState): StyledText {
  const chunks: LooseChunk[] = [];
  if (!state.pendingAction) return asStyledText(chunks);
  const boxWidth = overlayBoxWidth(state.viewport.width);
  const inner = boxWidth - 2;
  const isDestructive = state.pendingAction === "delete"
    || state.pendingAction === "bulk_delete";
  const title = state.pendingAction.replaceAll("_", " ").toUpperCase();
  chunks.push({ text: `${clip(title, inner).padEnd(inner)}\n`, fg: tone("modalFg"), bg: tone("modalBg"), bold: true });
  if (isDestructive) {
    chunks.push({ text: `${clip("\u26A0 DESTRUCTIVE \u2014 cannot be undone", inner).padEnd(inner)}\n`, fg: tone("danger"), bg: tone("modalBg"), bold: true });
  }
  chunks.push({ text: `${clip(renderSafe(confirmOverlayText(state)), inner).padEnd(inner)}\n`, fg: tone("detailValue"), bg: tone("modalBg") });
  const session = currentSession(state);
  if (session) {
    chunks.push({ text: `${clip(`${renderSafe(session.title)} (${renderSafe(session.id)})`, inner).padEnd(inner)}\n`, fg: tone("muted"), bg: tone("modalBg") });
  }
  chunks.push({ text: `${clip("[y/Enter] confirm \u00B7 [n/Esc] cancel", inner).padEnd(inner)}\n`, fg: tone("dim"), bg: tone("modalBg") });
  return asStyledText(chunks);
}
