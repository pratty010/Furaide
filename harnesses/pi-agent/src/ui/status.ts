import type { AssistantMessageEvent } from "@mariozechner/pi-ai";
import { pickNextWitty, formatWitty, type WittyLine } from "../runtime/witty-lines.ts";

export type StatusKind =
  | "ready"
  | "thinking"
  | "streaming_thinking"
  | "streaming_text"
  | "tool_call"
  | "tool_exec"
  | "error";

export interface StatusSnapshot {
  kind: StatusKind;
  kanji: string;
  color: "success" | "secondary" | "accent" | "warning" | "error" | "muted";
  label: string;
  detail: string;
  subheader: string;
}

const KANJI: Record<StatusKind, string> = {
  ready:               "待",
  thinking:            "思",
  streaming_thinking:  "脳",
  streaming_text:      "速",
  tool_call:           "書",
  tool_exec:           "行",
  error:               "断",
};

const LABEL: Record<StatusKind, string> = {
  ready:              "ready",
  thinking:           "thinking",
  streaming_thinking: "thinking",
  streaming_text:     "streaming",
  tool_call:          "tool_call",
  tool_exec:          "tool_exec",
  error:              "error",
};

const COLOR: Record<StatusKind, StatusSnapshot["color"]> = {
  ready:              "success",
  thinking:           "secondary",
  streaming_thinking: "muted",
  streaming_text:     "accent",
  tool_call:          "warning",
  tool_exec:          "warning",
  error:              "error",
};

const STATE_EMOJI: Record<StatusKind, string> = {
  ready:              "",
  thinking:           "💭",
  streaming_thinking: "🧠",
  streaming_text:     "✍️",
  tool_call:          "🛠",
  tool_exec:          "🛠",
  error:              "⚠️",
};

let kind: StatusKind = "ready";
let lastTool = "";
let toolArgsBuffer = "";
let errorDetail = "";
let agentStartMs = 0;
let toolStartMs = 0;
let outputTokens = 0;
let thinkingTokens = 0;
let lastReadyAtMs = 0;
let currentWitty: WittyLine | null = null;
let modelName = "";

export function resetForSession(): void {
  kind = "ready";
  lastTool = "";
  toolArgsBuffer = "";
  errorDetail = "";
  agentStartMs = 0;
  toolStartMs = 0;
  outputTokens = 0;
  thinkingTokens = 0;
  lastReadyAtMs = Date.now();
  currentWitty = pickNextWitty();
}

export function setModel(name: string): void {
  modelName = name;
}

export function onBeforeAgentStart(): void {
  kind = "thinking";
  lastTool = "";
  errorDetail = "";
  toolArgsBuffer = "";
  agentStartMs = Date.now();
  outputTokens = 0;
  thinkingTokens = 0;
}

export function onMessageUpdate(ev: AssistantMessageEvent): void {
  switch (ev.type) {
    case "thinking_start":
      if (kind !== "error") kind = "thinking";
      thinkingTokens = 0;
      break;
    case "thinking_delta":
      if (kind === "error") break;
      thinkingTokens += Math.ceil(ev.delta.length / 4);
      kind = thinkingTokens > 0 ? "streaming_thinking" : "thinking";
      break;
    case "text_start":
      if (kind !== "error") kind = "streaming_text";
      outputTokens = 0;
      break;
    case "text_delta":
      if (kind !== "error") kind = "streaming_text";
      outputTokens += Math.ceil(ev.delta.length / 4);
      break;
    case "toolcall_start":
      if (kind === "error") break;
      kind = "tool_call";
      toolArgsBuffer = "";
      break;
    case "toolcall_delta":
      if (kind === "error") break;
      kind = "tool_call";
      break;
    case "toolcall_end":
      if (kind === "error") break;
      lastTool = ev.toolCall.name ?? "";
      break;
    default:
      break;
  }
}

export function onToolStart(name: string): void {
  kind = "tool_exec";
  lastTool = name;
  toolStartMs = Date.now();
  errorDetail = "";
  toolArgsBuffer = "";
}

export function onToolEnd(isError: boolean, errMsg?: string): void {
  if (isError) {
    kind = "error";
    errorDetail = (errMsg ?? `${lastTool} failed`).slice(0, 60);
  } else {
    kind = "thinking";
    lastTool = "";
    toolStartMs = 0;
  }
  toolArgsBuffer = "";
}

export function onAgentEnd(): void {
  kind = "ready";
  lastTool = "";
  toolArgsBuffer = "";
  errorDetail = "";
  outputTokens = 0;
  thinkingTokens = 0;
  toolStartMs = 0;
  lastReadyAtMs = Date.now();
  currentWitty = pickNextWitty();
}

function elapsedSeconds(startMs: number): number {
  if (startMs === 0) return 0;
  return Math.max(0, Math.floor((Date.now() - startMs) / 1000));
}

function buildSubheader(k: StatusKind): string {
  const emoji = STATE_EMOJI[k];
  const label = LABEL[k];
  switch (k) {
    case "ready": {
      const w = currentWitty ?? pickNextWitty();
      const ago = elapsedSeconds(lastReadyAtMs);
      const agoStr = ago < 5 ? "just now" : `${ago}s ago`;
      return `${formatWitty(w)} · ${agoStr}`;
    }
    case "thinking":
      return `${emoji} ${label} · planning · …`;
    case "streaming_thinking":
      return `${emoji} ${label} · ${thinkingTokens} tok`;
    case "streaming_text":
      return modelName
        ? `${emoji} streaming · ${outputTokens} tok · ${modelName}`
        : `${emoji} streaming · ${outputTokens} tok`;
    case "tool_call":
      return `${emoji} ${label} · ${lastTool || "?"} · writing args`;
    case "tool_exec": {
      const sec = elapsedSeconds(toolStartMs);
      return `${emoji} ${label} · ${lastTool || "?"} · ${sec}s`;
    }
    case "error":
      return `${emoji} ${label} · ${lastTool || "?"} · ${errorDetail || "?"}`;
  }
}

export function snapshot(): StatusSnapshot {
  return {
    kind,
    kanji: KANJI[kind],
    color: COLOR[kind],
    label: LABEL[kind],
    detail: kind === "ready" && currentWitty
      ? formatWitty(currentWitty)
      : kind === "error"
        ? errorDetail
        : kind === "tool_call" || kind === "tool_exec"
          ? lastTool
          : "",
    subheader: buildSubheader(kind),
  };
}
