import { z } from "zod"

export const Message = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
})

export const NormalizedEvent = z.object({
  type: z.enum(["message", "tool-call", "tool-result", "final", "error"]),
  message: z.string().optional(),
  payload: z.unknown().optional(),
})

export const AuthStatus = z.object({
  backend: z.enum(["opencode", "pi"]),
  provider: z.string(),
  authenticated: z.boolean(),
  detail: z.string().optional(),
})

export function normalizeOpencodeEvent(raw) {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw
  if (data.type === "text" || data.type === "message") {
    return NormalizedEvent.parse({ type: "message", message: data.text ?? data.content ?? "" })
  }
  if (data.type === "tool_call") {
    return NormalizedEvent.parse({ type: "tool-call", payload: data })
  }
  if (data.type === "tool_result") {
    return NormalizedEvent.parse({ type: "tool-result", payload: data })
  }
  if (data.type === "error") {
    return NormalizedEvent.parse({ type: "error", message: data.message ?? "unknown error" })
  }
  return NormalizedEvent.parse({ type: "final", payload: data })
}

export function normalizePiEvent(raw) {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw
  if (data.event === "assistant_message" || data.event === "text") {
    return NormalizedEvent.parse({ type: "message", message: data.text ?? data.content ?? "" })
  }
  if (data.event === "tool_call") {
    return NormalizedEvent.parse({ type: "tool-call", payload: data })
  }
  if (data.event === "tool_result") {
    return NormalizedEvent.parse({ type: "tool-result", payload: data })
  }
  if (data.event === "error") {
    return NormalizedEvent.parse({ type: "error", message: data.message ?? "unknown error" })
  }
  return NormalizedEvent.parse({ type: "final", payload: data })
}

export function parseJsonLines(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}
