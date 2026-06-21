#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Box, BoxRenderable, ScrollBoxRenderable, TextRenderable, createCliRenderer, type CliRenderer } from "@opentui/core";
import type { StyledText } from "@opentui/core";
import { buildSessionIndex } from "./dashboard/session-index.ts";
import { createInitialState, cwd, reloadState, type UiState } from "./dashboard/state.ts";
import { applyKey } from "./dashboard/actions.ts";
import { dashboardLayout } from "./dashboard/layout.ts";
export { applyKey, buildSearchOverlay };
import {
  setTheme,
  buildSessionsContent,
  buildMetadataContent,
  buildMessagesContent,
  buildActionBarContent,
  buildSearchOverlay,
  buildChoiceOverlay,
  buildConfirmOverlay,
  tone,
} from "./dashboard/render.ts";

const theme = JSON.parse(readFileSync(new URL("../themes/friday.json", import.meta.url), "utf8"));
setTheme(theme);

export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") {
    return "opencode CLI not found. Set OPENCODE_ALL_OPENCODE_BIN or install opencode.";
  }
  return error instanceof Error ? error.message : String(error);
}

function mapKey(key: any): string {
  if (key?.ctrl && key?.name === "c") return "q";
  if (key?.ctrl && key?.name === "d") return "Ctrl+D";
  if (key?.ctrl && key?.name === "u") return "Ctrl+U";
  if (key?.name === "down") return "j";
  if (key?.name === "up") return "k";
  if (key?.name === "pagedown") return "PageDown";
  if (key?.name === "pageup") return "PageUp";
  if (key?.name === "tab") return "Tab";
  if (key?.shift && key?.name === "tab") return "S-Tab";
  if (key?.name === "return") return "Enter";
  if (key?.name === "escape") return "Escape";
  if (key?.name === "backspace") return "Backspace";
  return key?.sequence || key?.name || "";
}

function opencodeBin(): string {
  return process.env.OPENCODE_ALL_OPENCODE_BIN || "opencode";
}

export type ContinueRequest = { id: string; fork: boolean };

export async function runChildSession(
  renderer: Pick<CliRenderer, "requestRender"> & { suspend?: () => unknown; resume?: () => unknown },
  req: ContinueRequest,
  spawnImpl: typeof spawn = spawn,
  auditImpl: (action: string, sessionId: string, status: string) => void = audit,
): Promise<void> {
  auditImpl("open_session", req.id, "started");
  renderer.suspend?.();
  const child = spawnImpl(opencodeBin(), ["--session", req.id, ...(req.fork ? ["--fork"] : [])], { stdio: "inherit" });
  const status = await new Promise<string>((resolve) => {
    child.on("exit", (code, signal) => {
      if (signal) resolve(`signal ${signal}`);
      else resolve(`exit ${code ?? 0}`);
    });
    child.on("error", (error) => resolve(`error ${errorMessage(error)}`));
  });
  auditImpl("open_session", req.id, status);
  renderer.resume?.();
  renderer.requestRender();
}

export async function startInteractiveTui(): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: true, targetFps: 30, useMouse: true });
  let state = createInitialState(buildSessionIndex({ cwd: cwd() }), { height: process.stdout.rows || 24, width: process.stdout.columns || 100 });
  state = reloadState(state);
  let layout = dashboardLayout(state.viewport.width, state.viewport.height);
  let continueRequest: ContinueRequest | null = null;
  let quitRequested = false;
  let settleLoop: (() => void) | null = null;

  function makeScrollPane(
    paneRenderer: CliRenderer,
    id: string,
    content: StyledText,
    focus: "messages" | "metadata" | "sessions",
    wrapMode: "none" | "word" = "word",
  ) {
    const text = new TextRenderable(paneRenderer, { id: `${id}-text`, wrapMode, truncate: wrapMode === "none", content });
    const scrollBox = new ScrollBoxRenderable(paneRenderer, {
      id: `${id}-scroll`,
      flexGrow: 1,
      scrollY: true,
      onMouseDown: (event) => {
        if (state.focus !== focus) {
          state = { ...state, focus };
          rebuildLayout();
          refreshPanes();
          paneRenderer.requestRender();
        }
      },
      onMouseScroll: (event) => {
        if (state.focus !== focus) {
          state = { ...state, focus };
          refreshPanes();
          paneRenderer.requestRender();
        }
        const button = Number((event as any).button ?? 0);
        const scroll = (event as any).scroll;
        const delta = typeof scroll?.deltaY === "number"
          ? scroll.deltaY
          : button === 4 ? -3 : button === 5 ? 3 : 0;
        if (delta !== 0) scrollBox.scrollBy({ x: 0, y: delta });
        event.stopPropagation?.();
      },
    });
    scrollBox.add(text);
    return { scrollBox, text };
  }

  const { scrollBox: messagesScroll, text: messagesText } = makeScrollPane(renderer, "messages", buildMessagesContent(state), "messages", "word");
  const { scrollBox: metadataScroll, text: metadataText } = makeScrollPane(renderer, "metadata", buildMetadataContent(state), "metadata");

  const { scrollBox: sessionsScroll, text: sessionsText } = makeScrollPane(
    renderer,
    "sessions",
    buildSessionsContent(state),
    "sessions",
  );

  const actionBar = new TextRenderable(renderer, {
    id: "action-bar",
    height: layout.actionRows,
    wrapMode: "word",
    truncate: true,
    content: buildActionBarContent(state),
  });
  // Action bar click handling intentionally deferred: chips are rendered as a single
  // StyledText with no per-chip boundary in OpenTUI. Hit-testing would require a
  // custom terminal hit-test engine (Ponytail rule) to walk chunks and map x to a
  // chip id, which is fragile against truncation, font width changes, and locale
  // text shaping. Re-evaluate if OpenTUI ships a low-code per-region click API.

  const searchOverlay = new TextRenderable(renderer, {
    id: "search-overlay", position: "absolute", top: "20%", left: "10%", right: "10%", height: "60%", zIndex: 100, visible: false,
    content: buildSearchOverlay(state),
  });
  const confirmOverlay = new TextRenderable(renderer, {
    id: "confirm-overlay", position: "absolute", top: "35%", left: "15%", right: "15%", height: "30%", zIndex: 110, visible: false,
    content: buildConfirmOverlay(state),
  });
  const choiceOverlay = new TextRenderable(renderer, {
    id: "choice-overlay", position: "absolute", top: "32%", left: "15%", right: "15%", height: "36%", zIndex: 105, visible: false,
    content: buildChoiceOverlay(state),
  });

  const bodyArea = new BoxRenderable(renderer, { id: "body-area", flexDirection: "column", flexGrow: 1 });
  const rootColumn = Box({ flexDirection: "column", width: "100%", height: "100%" }, bodyArea, actionBar);
  renderer.root.add(rootColumn);
  renderer.root.add(searchOverlay);
  renderer.root.add(confirmOverlay);
  renderer.root.add(choiceOverlay);

  function rebuildLayout() {
    layout = dashboardLayout(state.viewport.width, state.viewport.height);
    actionBar.height = layout.actionRows;
    for (const child of bodyArea.getChildren()) bodyArea.remove(child.id);

    if (layout.mode === "focused") {
      const focusPane = state.focus === "messages" ? messagesScroll
        : state.focus === "metadata" ? metadataScroll
        : sessionsScroll;
      const title = state.focus === "messages" ? "Messages" : state.focus === "metadata" ? "Metadata" : "Sessions";
      bodyArea.add(Box({ flexDirection: "column", flexGrow: 1, border: true, borderColor: tone("listBorderFocus"), backgroundColor: tone("surface"), title } as any, focusPane));
    } else {
      const topRow = Box({ flexDirection: "row", flexGrow: layout.topPercent, maxHeight: layout.topMaxHeight },
        Box({ flexDirection: "column", flexGrow: 1, border: true, borderColor: tone(state.focus === "messages" ? "listBorderFocus" : "listBorder"), backgroundColor: tone("surface"), title: "Messages" } as any, messagesScroll),
        Box({ flexDirection: "column", flexGrow: 1, border: true, borderColor: tone(state.focus === "metadata" ? "listBorderFocus" : "detailBorder"), backgroundColor: tone("surface"), title: "Metadata" } as any, metadataScroll),
      );
      const sRow = Box({ flexDirection: "column", flexGrow: layout.sessionsPercent, minHeight: layout.sessionsMinHeight, border: true, borderColor: tone(state.focus === "sessions" ? "listBorderFocus" : "listBorder"), backgroundColor: tone("surface"), title: "Sessions" } as any, sessionsScroll);
      bodyArea.add(topRow);
      bodyArea.add(sRow);
    }
  }

  const refreshPanes = () => {
    messagesText.content = buildMessagesContent(state);
    metadataText.content = buildMetadataContent(state);
    sessionsText.content = buildSessionsContent(state);
    actionBar.content = buildActionBarContent(state);
    searchOverlay.content = buildSearchOverlay(state);
    confirmOverlay.content = buildConfirmOverlay(state);
    choiceOverlay.content = buildChoiceOverlay(state);
    searchOverlay.visible = state.inputMode === "search";
    confirmOverlay.visible = !!state.pendingAction;
    choiceOverlay.visible = !!state.pendingChoice;
  };

  function onResize() {
    const vp = { height: process.stdout.rows || 24, width: process.stdout.columns || 100 };
    state = { ...state, viewport: vp };
    rebuildLayout();
    refreshPanes();
    renderer.requestRender();
  }

  process.stdout.on("resize", onResize);

  const onKeypress = (key: any) => {
    const mapped = mapKey(key);
    if (mapped === "q") {
      quitRequested = true;
      settleLoop?.();
      return;
    }
    if (mapped === "R" && !state.inputMode && !state.pendingAction && !state.pendingChoice) {
      state = reloadState({ ...state, index: buildSessionIndex({ cwd: cwd() }), status: "index refreshed", cursor: 0, listScroll: 0 });
      refreshPanes();
      renderer.requestRender();
      return;
    }
    const prevFocus = state.focus;
    const next = applyKey(state, mapped, (id, fork) => { continueRequest = { id, fork }; });
    if (next !== state) {
      state = next;
      refreshPanes();
      if (state.focus !== prevFocus) rebuildLayout();
    }
    if (continueRequest) {
      settleLoop?.();
      return;
    }
    renderer.requestRender();
  };

  renderer.keyInput.on("keypress", onKeypress);
  rebuildLayout();
  refreshPanes();
  renderer.requestRender();

  try {
    while (!quitRequested) {
      await new Promise<void>((resolve) => {
        settleLoop = resolve;
      });
      settleLoop = null;
      if (quitRequested) break;
      if (continueRequest) {
        const req = continueRequest;
        continueRequest = null;
        await runChildSession(renderer, req);
        rebuildLayout();
        refreshPanes();
        renderer.requestRender();
      }
    }
  } finally {
    process.stdout.off("resize", onResize);
    renderer.keyInput.off?.("keypress", onKeypress);
    renderer.destroy();
  }
}

function dataDir(): string {
  const base = process.env.XDG_DATA_HOME || join(process.env.HOME || ".", ".local", "share");
  return join(base, "opencode", "tools", "opencode-all");
}

function audit(action: string, sessionId: string, status: string): void {
  const file = join(dataDir(), "audit.log");
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), action, session_id: sessionId, status })}\n`, { flag: "a", mode: 0o600 });
}

function printFallbackList(): void {
  const index = buildSessionIndex({ cwd: cwd() });
  const rows = [...index.active.values()].sort((a, b) => b.timeUpdated - a.timeUpdated);
  for (const row of rows) console.log(`${row.id}\t${row.title}\t${row.directory}`);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.includes("--list")) {
    printFallbackList();
    return;
  }
  if (process.stdout.isTTY && !argv.includes("--no-tui")) {
    await startInteractiveTui();
    return;
  }
  const state = createInitialState(buildSessionIndex({ cwd: cwd() }), { height: process.stdout.rows || 24, width: process.stdout.columns || 100 });
  const sessions = buildSessionsContent(state);
  for (const chunk of sessions.chunks) {
    if (chunk.text) process.stdout.write(String(chunk.text));
  }
}

if (import.meta.main) await main();
