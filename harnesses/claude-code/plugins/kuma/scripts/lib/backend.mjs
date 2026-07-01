import { createOpencodeBackend } from "./opencode-backend.mjs"
import { createPiBackend } from "./pi-backend.mjs"

export const BACKEND_NAMES = ["opencode", "pi"]

export function createBackend(name) {
  if (name === "opencode") return createOpencodeBackend()
  if (name === "pi") return createPiBackend()
  throw new Error(`Unknown backend: ${name}. Expected one of: ${BACKEND_NAMES.join(", ")}`)
}
