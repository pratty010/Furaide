import { parentPort } from "node:worker_threads";
import { buildSessionIndex, serializeSessionIndex } from "../dashboard/session-index.ts";

parentPort?.on("message", (msg) => {
  try {
    if (msg.type === "refresh") {
      const index = buildSessionIndex({ cwd: msg.cwd, dbPath: msg.dbPath, archiveRoot: msg.archiveRoot });
      parentPort?.postMessage({ type: "refresh-result", index: serializeSessionIndex(index) });
    }
  } catch (error) {
    parentPort?.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
});
