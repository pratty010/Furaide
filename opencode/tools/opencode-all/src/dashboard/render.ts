#!/usr/bin/env bun
import type { DirectoryRow, SessionDetail } from "../db.ts";
import type { UiState, UiSession } from "./state.ts";
import { StyledText, type TextChunk } from "@opentui/core";
import { getSessionDetail } from "../db.ts";
import { currentSession, cwd, getVisibleRows } from "./state.ts";
import { actionChips, confirmOverlayText, searchResultsFor, searchVisibleSlice, SEARCH_VISIBLE_WINDOW } from "./actions.ts";
import { renderSafe } from "../sanitize.ts";

type ThemeDoc = {
  name: string;
  vars: Record<string, string>;
  pane: Record<string, string>;
};

let _theme: ThemeDoc = { name: "default", vars: {}, pane: {} };

export function setTheme(t: ThemeDoc): void {
  _theme = t;
}

export function tone(slot: string): string {
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
  return value > 0 ? `$${value.toFixed(2)}` : "$0.00";
}

export function selectedDetail(state: UiState): SessionDetail | null {
  const selected = currentSession(state);
  if (!selected) return null;
  return getSessionDetail({ id: selected.id, cwd: cwd() });
}

export function buildMessagesContent(state: UiState): StyledText {
  const chunks: TextChunk[] = [];
  const selected = currentSession(state);
  if (!selected) {
    chunks.push({ text: "Select a session\n", fg: tone("muted") });
    return new StyledText(chunks);
  }
  const rowsVisible = Math.max(5, Math.floor(state.viewport.height * 0.35));
  const msgs = state.messageRows.filter(m => m.role === "user" || m.role === "assistant");
  if (msgs.length === 0) {
    chunks.push({ text: "(no messages)\n", fg: tone("muted") });
    return new StyledText(chunks);
  }
  const start = Math.max(0, Math.min(state.messageScroll, Math.max(0, msgs.length - rowsVisible)));
  const visible = msgs.slice(start, start + rowsVisible);
  if (msgs.length > rowsVisible) {
    chunks.push({ text: `Messages ${start + 1}-${Math.min(start + rowsVisible, msgs.length)}/${msgs.length}\n`, fg: tone("dim") });
  }
  for (const m of visible) {
    const prefix = m.role === "user" ? "U" : "A";
    chunks.push({
      text: `${formatTime(m.time)} ${prefix} ${m.text}\n`,
      fg: m.role === "user" ? tone("cyan") : tone("text"),
    });
  }
  return new StyledText(chunks);
}

export function buildMetadataContent(
  state: UiState,
  detail?: SessionDetail | null,
): StyledText {
  const d = detail !== undefined ? detail : selectedDetail(state);
  const chunks: TextChunk[] = [];
  if (!d) {
    chunks.push({ text: "No session selected\n", fg: tone("muted") });
    return new StyledText(chunks);
  }
  chunks.push({ text: `id: ${d.id}\n`, fg: tone("detailValue") });
  chunks.push({ text: `\uD83D\uDCC1 ${d.directory}${d.isCurrent ? " (cwd)" : ""}\n`, fg: tone("detailValue") });
  chunks.push({ text: `\uD83E\uDD16 ${d.agent || "-"} \u00B7 ${parseModel(d.model)}\n`, fg: tone("detailValue") });
  chunks.push({ text: `\uD83D\uDCB0 ${fmtCost(d.cost)}\n`, fg: tone("detailCost") });
  chunks.push({ text: `\uD83D\uDCCA in ${d.tokensInput} \u00B7 out ${d.tokensOutput} \u00B7 reasoning ${d.tokensReasoning}\n`, fg: tone("detailTokens") });
  chunks.push({ text: `\uD83D\uDDC2  cache r ${d.tokensCacheRead} \u00B7 w ${d.tokensCacheWrite}\n`, fg: tone("detailTokens") });
  chunks.push({ text: `\uD83D\uDCC5 created ${formatTime(d.timeCreated)} \u00B7 updated ${formatTime(d.timeUpdated)}${d.timeArchived ? ` \u00B7 archived ${formatTime(d.timeArchived)}` : ""}\n`, fg: tone("detailValue") });
  chunks.push({ text: `\uD83D\uDCC8 ${d.summaryFiles} files \u00B7 +${d.summaryAdditions} / -${d.summaryDeletions}\n`, fg: tone("detailValue") });
  chunks.push({ text: `\uD83D\uDCCE ${d.diffPath ? `${d.diffPath} (${d.diffBytes || 0}b)` : "-"}\n`, fg: tone("detailValue") });
  if (d.suspicious) {
    chunks.push({ text: "\u26A0 suspicious session\n", fg: tone("danger") });
  }
  if (d.toolCounts.length > 0) {
    chunks.push({ text: `\uD83D\uDD27 ${d.toolCounts.slice(0, 4).map(t => `${t.tool} ${t.count} ${t.status}`).join(" \u00B7 ")}\n`, fg: tone("success") });
  }
  const rowsVisible = Math.max(4, Math.floor(state.viewport.height * 0.35));
  const start = Math.max(0, Math.min(state.detailScroll, Math.max(0, chunks.length - rowsVisible)));
  return new StyledText(chunks.slice(start, start + rowsVisible));
}

export function buildSessionsContent(state: UiState): StyledText {
  const chunks: TextChunk[] = [];
  const visible = getVisibleRows(state);
  const activeTab = state.tab === "active" ? "[Active]" : " Active ";
  const archivedTab = state.tab === "archived" ? "[Archived]" : " Archived ";
  chunks.push({ text: `${activeTab} ${archivedTab}  ${state.cursor + 1}/${Math.max(visible.length, 1)}\n`, fg: tone("text"), bg: tone("surfaceAlt"), bold: true });

  for (let i = 0; i < visible.length; i++) {
    const item = visible[i];
    const isDir = item && !("id" in item);
    const isSelected = i === state.cursor;
    const marker = isSelected ? "\u276f " : "  ";
    if (isDir) {
      const dir = item as DirectoryRow;
      const isExpanded = state.expandedFolders.has(dir.directory);
      const prefix = isExpanded ? "\u25bc" : "\u25b6";
      const cwdMark = dir.directory.startsWith(cwd()) ? "\u25c9 " : "\u25cb ";
      const label = `${marker}${cwdMark}${prefix} ${dir.directory} (${dir.active} active, ${dir.archived} archived)`;
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
  return new StyledText(chunks);
}
export function buildActionBarContent(state: UiState): StyledText {
  const chips = actionChips(state);
  const chunks: TextChunk[] = [];
  for (let i = 0; i < chips.length; i++) {
    const chip = chips[i];
    let fg = tone("statusFg");
    let bold = false;
    if (chip.primary) { fg = tone("accent"); bold = true; }
    if (chip.danger) { fg = tone("danger"); bold = true; }
    if (i > 0) chunks.push({ text: " | ", fg: tone("dim"), bg: tone("statusBg") });
    chunks.push({ text: chip.label, fg, bg: tone("statusBg"), bold });
  }
  return new StyledText(chunks);
}

export function buildSearchOverlay(state: UiState): StyledText {
  const chunks: TextChunk[] = [];
  const boxWidth = Math.max(60, Math.min(100, state.viewport.width - 4));
  const inner = boxWidth - 4;
  const all = searchResultsFor(state);
  const visible = searchVisibleSlice(state);
  const start = Math.max(0, Math.min(state.searchScroll, Math.max(0, all.length - SEARCH_VISIBLE_WINDOW)));

  chunks.push({ text: "\u250c" + "\u2500".repeat(boxWidth - 2) + "\u2510\n", fg: tone("modalBorder") });
  chunks.push({ text: `\u2502 ${clip("\uD83D\uDD0D Search Sessions", inner).padEnd(inner)} \u2502\n`, fg: tone("modalFg"), bg: tone("modalBg"), bold: true });
  const input = `> ${state.query}\u2588`;
  chunks.push({ text: `\u2502 ${clip(input, inner).padEnd(inner)} \u2502\n`, fg: tone("text"), bg: tone("modalBg") });
  chunks.push({ text: "\u251c" + "\u2500".repeat(boxWidth - 2) + "\u2524\n", fg: tone("modalBorder"), bg: tone("modalBg") });
  if (all.length === 0) {
    chunks.push({ text: `\u2502 ${clip("No matches", inner).padEnd(inner)} \u2502\n`, fg: tone("muted"), bg: tone("modalBg") });
  } else {
    for (let i = 0; i < visible.length; i++) {
      const r = visible[i];
      const isSelected = (start + i) === state.searchSelected;
      const left = clip(r.title, Math.max(20, inner - r.directory.length - 4));
      const row = `\u2502 ${isSelected ? "\u276f" : " "} ${left.padEnd(Math.max(20, inner - r.directory.length - 4))}  ${clip(r.directory, r.directory.length).padEnd(r.directory.length)} \u2502\n`;
      chunks.push({ text: row, fg: isSelected ? tone("accent") : tone("text"), bg: isSelected ? tone("listSelectedBg") : tone("modalBg") });
    }
    for (let i = visible.length; i < SEARCH_VISIBLE_WINDOW; i++) {
      chunks.push({ text: `\u2502 ${" ".repeat(inner)} \u2502\n`, fg: tone("modalFg"), bg: tone("modalBg") });
    }
  }
  chunks.push({ text: "\u251c" + "\u2500".repeat(boxWidth - 2) + "\u2524\n", fg: tone("modalBorder"), bg: tone("modalBg") });
  const footer = all.length > SEARCH_VISIBLE_WINDOW
    ? `\u2191\u2193 select \u00B7 Enter open \u00B7 Esc cancel \u00B7 ${start + 1}\u2013${Math.min(start + SEARCH_VISIBLE_WINDOW, all.length)}/${all.length}`
    : "\u2191\u2193 select \u00B7 Enter open \u00B7 Esc cancel";
  chunks.push({ text: `\u2502 ${clip(footer, inner).padEnd(inner)} \u2502\n`, fg: tone("dim"), bg: tone("modalBg") });
  chunks.push({ text: "\u2514" + "\u2500".repeat(boxWidth - 2) + "\u2518\n", fg: tone("modalBorder") });
  return new StyledText(chunks);
}

export function buildConfirmOverlay(state: UiState): StyledText {
  const chunks: TextChunk[] = [];
  if (!state.pendingAction) return new StyledText(chunks);
  const boxWidth = Math.max(60, Math.min(100, state.viewport.width - 6));
  const inner = boxWidth - 4;
  const isDestructive = state.pendingAction === "delete"
    || state.pendingAction === "archive_and_delete"
    || state.pendingAction === "bulk_delete";
  chunks.push({ text: "\u250c" + "\u2500".repeat(boxWidth - 2) + "\u2510\n", fg: tone("modalBorder") });
  const title = state.pendingAction.replaceAll("_", " ").toUpperCase();
  chunks.push({ text: `\u2502 ${clip(title, inner).padEnd(inner)} \u2502\n`, fg: tone("modalFg"), bg: tone("modalBg"), bold: true });
  if (isDestructive) {
    chunks.push({ text: `\u2502 ${clip("\u26A0 DESTRUCTIVE \u2014 cannot be undone", inner).padEnd(inner)} \u2502\n`, fg: tone("danger"), bg: tone("modalBg"), bold: true });
  }
  chunks.push({ text: `\u2502 ${clip(renderSafe(confirmOverlayText(state)), inner).padEnd(inner)} \u2502\n`, fg: tone("detailValue"), bg: tone("modalBg") });
  const session = currentSession(state);
  if (session) {
    chunks.push({ text: `\u2502 ${clip(`${renderSafe(session.title)} (${renderSafe(session.id)})`, inner).padEnd(inner)} \u2502\n`, fg: tone("muted"), bg: tone("modalBg") });
  }
  chunks.push({ text: `\u2502 ${clip("[y/Enter] confirm \u00B7 [n/Esc] cancel", inner).padEnd(inner)} \u2502\n`, fg: tone("dim"), bg: tone("modalBg") });
  chunks.push({ text: "\u2514" + "\u2500".repeat(boxWidth - 2) + "\u2518\n", fg: tone("modalBorder") });
  return new StyledText(chunks);
}
