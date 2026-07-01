import { generateJobId, upsertJob } from "./state.mjs"

export const JOB_KINDS = ["review", "task"]
export const JOB_STATUSES = ["queued", "running", "done", "error", "cancelled"]

export function createJob(cwd, { kind, provider, model, backend, resumable = false }) {
  if (!JOB_KINDS.includes(kind)) {
    throw new Error(`Unknown job kind: ${kind}`)
  }
  const id = generateJobId(kind)
  const job = {
    id,
    kind,
    provider,
    model,
    backend,
    status: "queued",
    phase: null,
    resumable,
    resultReady: false,
    sessionHandle: null,
    pid: null,
    result: null,
    errorMessage: null,
  }
  upsertJob(cwd, job)
  return job
}

export function markRunning(cwd, id, { pid, phaseHint = null } = {}) {
  return upsertJob(cwd, { id, status: "running", phase: phaseHint, pid })
}

export function markDone(cwd, id, { result, sessionHandle = null } = {}) {
  return upsertJob(cwd, {
    id,
    status: "done",
    phase: "done",
    pid: null,
    result,
    resultReady: true,
    sessionHandle,
  })
}

export function markError(cwd, id, { errorMessage } = {}) {
  return upsertJob(cwd, {
    id,
    status: "error",
    phase: "error",
    pid: null,
    errorMessage,
    resultReady: true,
  })
}

export function markCancelled(cwd, id) {
  return upsertJob(cwd, { id, status: "cancelled", phase: "cancelled", pid: null })
}

export function isJobActive(job) {
  return job.status === "queued" || job.status === "running"
}
