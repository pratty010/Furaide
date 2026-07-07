#!/usr/bin/env node
import { parseArgs } from "./lib/args.mjs"
import { BACKEND_NAMES, createBackend } from "./lib/backend.mjs"
import { collectDiffPatch, collectDiffShortstat, resolveReviewTarget } from "./lib/git.mjs"
import {
  createJob,
  isJobActive,
  markCancelled,
  markDone,
  markError,
  markRunning,
} from "./lib/job.mjs"
import {
  V1_PROVIDERS,
  enrichWithBaseLlm,
  loadModelIndex,
  mergeBackendListings,
  saveModelIndex,
} from "./lib/models.mjs"
import { binaryAvailable } from "./lib/process.mjs"
import { renderResult, renderStatusTable } from "./lib/render.mjs"
import {
  findLastResumableJob,
  generateJobId,
  getConfig,
  listJobs,
  setConfig,
} from "./lib/state.mjs"

const [, , subcommand, ...rest] = process.argv
const cwd = process.cwd()

async function fetchBaseLlmEnrichment() {
  try {
    const response = await fetch("https://basellm.github.io/llm-metadata/api/newapi/models.json")
    if (!response.ok) return []
    const body = await response.json()
    return Array.isArray(body?.data) ? body.data : []
  } catch {
    return []
  }
}

async function runSetup(args) {
  const { options } = parseArgs(args, {
    valueOptions: ["default-backend", "default-model"],
    booleanOptions: [],
  })

  const opencodeBin = binaryAvailable("opencode")
  const piBin = binaryAvailable("pi")

  const opencodeBackend = createBackend("opencode")
  const piBackend = createBackend("pi")
  const opencodeAuth = opencodeBin.available
    ? await opencodeBackend.getAuthStatuses()
    : { available: false, raw: "opencode not installed" }
  const piAuth = piBin.available
    ? await piBackend.getAuthStatuses()
    : { available: false, raw: "pi not installed" }

  let opencodeModels = []
  let piModels = []
  try {
    if (opencodeBin.available)
      opencodeModels = await opencodeBackend.listModels(undefined, { refresh: true })
  } catch {
    /* leave empty on failure; setup should not hard-fail */
  }
  try {
    if (piBin.available) piModels = await piBackend.listModels()
  } catch {
    /* leave empty on failure */
  }

  let merged = mergeBackendListings({ opencodeModels, piModels })
  const enrichmentSource = await fetchBaseLlmEnrichment()
  if (enrichmentSource.length > 0) {
    merged = enrichWithBaseLlm(merged, enrichmentSource)
  }
  saveModelIndex(cwd, merged)

  if (options["default-backend"]) {
    if (!BACKEND_NAMES.includes(options["default-backend"])) {
      console.error(`Invalid --default-backend. Expected one of: ${BACKEND_NAMES.join(", ")}`)
      process.exitCode = 1
      return
    }
    setConfig(cwd, "defaultBackend", options["default-backend"])
  }
  if (options["default-model"]) {
    setConfig(cwd, "defaultModel", options["default-model"])
  }

  console.log(`opencode binary: ${opencodeBin.available ? "found" : "NOT FOUND"}`)
  console.log(`pi binary: ${piBin.available ? "found" : "NOT FOUND"}`)
  console.log(`opencode auth: ${opencodeAuth.available ? "ready" : "not ready"}`)
  console.log(`pi auth (OPENCODE_API_KEY): ${piAuth.available ? "ready" : "not ready"}`)
  if (opencodeBin.available) {
    const ollamaCloudCount = merged.filter((e) => e.provider === "ollama-cloud").length
    console.log(
      ollamaCloudCount > 0
        ? `ollama-cloud: configured (${ollamaCloudCount} model(s) available)`
        : "ollama-cloud: NOT CONFIGURED (opencode returned no ollama-cloud models — configure Ollama, then re-run /rejion:setup)"
    )
  } else {
    console.log("ollama-cloud: unknown (opencode binary not found)")
  }
  console.log(`model index refreshed: ${merged.length} models across ${V1_PROVIDERS.join(", ")}`)
  console.log(getConfig(cwd))
}

function runModels() {
  const { entries } = loadModelIndex(cwd)
  if (entries.length === 0) {
    console.log("No model index cached yet. Run `/rejion:setup` first.")
    return
  }
  const header = ["model", "provider", "backend", "capabilities", "context", "status"]
  const rows = entries.map((e) => [
    e.model,
    e.provider,
    e.backend,
    e.capabilities ?? "-",
    e.context ?? "-",
    e.status,
  ])
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)))
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join("  ")
  console.log(line(header))
  console.log(widths.map((w) => "-".repeat(w)).join("  "))
  for (const row of rows) console.log(line(row))
}

function runStatus(args) {
  const jobId = args.find((a) => !a.startsWith("-"))
  const jobs = listJobs(cwd)
  if (jobId) {
    const job = jobs.find((j) => j.id === jobId)
    if (!job) {
      console.error(`No job found with id ${jobId}`)
      process.exitCode = 1
      return
    }
    console.log(renderResult(job))
    return
  }
  console.log(renderStatusTable(jobs))
}

function runResult(args) {
  const jobId = args[0]
  if (!jobId) {
    console.error("Usage: rejion-companion.mjs result <job-id>")
    process.exitCode = 1
    return
  }
  const job = listJobs(cwd).find((j) => j.id === jobId)
  if (!job) {
    console.error(`No job found with id ${jobId}`)
    process.exitCode = 1
    return
  }
  console.log(renderResult(job))
}

async function runCancel(args) {
  const jobId = args[0]
  if (!jobId) {
    console.error("Usage: rejion-companion.mjs cancel <job-id>")
    process.exitCode = 1
    return
  }
  const job = listJobs(cwd).find((j) => j.id === jobId)
  if (!job) {
    console.error(`No job found with id ${jobId}`)
    process.exitCode = 1
    return
  }
  if (!isJobActive(job)) {
    console.log(`Job ${jobId} is already ${job.status}; nothing to cancel.`)
    return
  }
  const backend = createBackend(job.backend === "both" ? "opencode" : job.backend)
  const termination = await backend.cancel(job.pid)
  if (!termination.delivered) {
    console.error(
      Number.isFinite(job.pid)
        ? `Unable to deliver cancellation to job ${jobId}; backend process may have already exited.`
        : `Job ${jobId} has no backend pid yet; retry cancellation in a moment.`
    )
    process.exitCode = 1
    return
  }
  markCancelled(cwd, jobId)
  console.log(`Job ${jobId} cancelled.`)
}

function getActiveJob() {
  return listJobs(cwd).find((job) => isJobActive(job)) ?? null
}

function ensureNoActiveJobOrFail() {
  const existingActive = getActiveJob()
  if (!existingActive) return true

  console.error(
    `A ${existingActive.kind} job (${existingActive.id}) is already active for this workspace. Use \`/rejion:cancel ${existingActive.id}\` or wait for it to finish before starting another.`
  )
  process.exitCode = 1
  return false
}

function validateBackendProviderCompatibility(backend, provider) {
  if (backend === "pi" && provider === "ollama-cloud") {
    return "The pi backend cannot reach ollama-cloud models. Use --backend opencode or choose a different provider."
  }
  return null
}

function resolveDefaultsOrFail(options) {
  const config = getConfig(cwd)
  const backend = options.backend ?? config.defaultBackend
  const model = options.model ?? config.defaultModel
  if (!backend || !model) {
    console.error(
      "Missing --backend/--model and no defaults configured. Run `/rejion:setup` first."
    )
    process.exitCode = 1
    return null
  }
  return { backend, model }
}

function resolveProviderForModel(model) {
  // If model contains a slash, split on the first one: provider/model → { provider, model }
  const slashIndex = model.indexOf("/")
  if (slashIndex !== -1) {
    const provider = model.slice(0, slashIndex)
    const bareModel = model.slice(slashIndex + 1)
    return { provider, model: bareModel }
  }

  // Otherwise, look it up in the cached model index
  const { entries } = loadModelIndex(cwd)
  const match = entries.find((e) => e.model === model)
  const provider = match?.provider ?? "opencode-go"
  return { provider, model }
}

function getStoredJob(jobId) {
  return listJobs(cwd).find((job) => job.id === jobId) ?? null
}

async function waitForCancelledJob(jobId, attempts = 10, delayMs = 25) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (getStoredJob(jobId)?.status === "cancelled") {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  return getStoredJob(jobId)?.status === "cancelled"
}

async function runReview(args) {
  const { options } = parseArgs(args, {
    valueOptions: ["backend", "model", "base", "scope", "mode"],
    booleanOptions: ["wait", "background"],
  })

  const resolved = resolveDefaultsOrFail(options)
  if (!resolved) return
  if (!ensureNoActiveJobOrFail()) return
  const { backend: backendName, model } = resolved
  const { provider, model: resolvedModel } = resolveProviderForModel(model)
  const compatibilityError = validateBackendProviderCompatibility(backendName, provider)
  if (compatibilityError) {
    console.error(compatibilityError)
    process.exitCode = 1
    return
  }

  const target = resolveReviewTarget(cwd, { scope: options.scope, base: options.base })
  const stat = collectDiffShortstat(cwd, target)
  const { patch, truncated } = collectDiffPatch(cwd, target)

  const promptPrefix =
    options.mode === "adversarial"
      ? "Perform an adversarial code review. Assume the diff is trying to hide a bug. "
      : "Perform a code review. "
  const diffSection = patch.trim()
    ? `Diff:\n\`\`\`diff\n${patch}\n\`\`\`${truncated ? "\n\n(Note: diff was truncated due to size.)" : ""}`
    : "No diff content available."
  const prompt = `${promptPrefix}Target: ${target.label}. ${JSON.stringify(stat)}.\n\n${diffSection}\n\nRespond with the review-output JSON schema (verdict, summary, findings, next_steps).`

  const job = createJob(cwd, {
    kind: "review",
    provider,
    model: resolvedModel,
    backend: backendName,
    resumable: false,
  })
  const backend = createBackend(backendName)
  markRunning(cwd, job.id, { pid: null })
  try {
    const execution = await backend.sendPrompt({
      provider,
      model: resolvedModel,
      prompt,
      onSpawn: (pid) => markRunning(cwd, job.id, { pid }),
    })
    if (await waitForCancelledJob(job.id, 1, 0)) {
      console.log(`Job ${job.id} was cancelled.`)
      return
    }
    if (execution.exitCode !== 0) {
      if (await waitForCancelledJob(job.id)) {
        console.log(`Job ${job.id} was cancelled.`)
        return
      }
      markError(cwd, job.id, {
        errorMessage: `Backend exited with code ${execution.exitCode}: ${execution.stderr || execution.rawOutput || "no output"}`,
      })
      console.error(`Review failed: backend exited with code ${execution.exitCode}`)
      process.exitCode = 1
      return
    }
    markDone(cwd, job.id, { result: { rawOutput: execution.rawOutput } })
    console.log(
      renderResult({ ...job, status: "done", result: { rawOutput: execution.rawOutput } })
    )
  } catch (error) {
    if (await waitForCancelledJob(job.id)) {
      console.log(`Job ${job.id} was cancelled.`)
      return
    }
    markError(cwd, job.id, { errorMessage: error.message })
    console.error(`Review failed: ${error.message}`)
    process.exitCode = 1
  }
}

async function runTask(args) {
  const { options, positionals } = parseArgs(args, {
    valueOptions: ["backend", "model"],
    booleanOptions: ["wait", "background", "resume", "fresh"],
  })

  const resolved = resolveDefaultsOrFail(options)
  if (!resolved) return
  if (!ensureNoActiveJobOrFail()) return
  const { backend: backendName, model } = resolved
  const { provider, model: resolvedModel } = resolveProviderForModel(model)
  const compatibilityError = validateBackendProviderCompatibility(backendName, provider)
  if (compatibilityError) {
    console.error(compatibilityError)
    process.exitCode = 1
    return
  }
  const prompt = positionals.join(" ")

  // Rejion owns the session handle rather than waiting for the backend to hand one back:
  // neither adapter's `sendPrompt` returns a generated session id (opencode/pi don't surface
  // one in a way we can parse reliably), so Rejion pre-generates a handle and always passes it
  // via `--session <handle>`, making resume deterministic instead of best-effort.
  let sessionHandle = null
  if (options.resume) {
    const lastResumable = findLastResumableJob(cwd, { backend: backendName, provider })
    sessionHandle = lastResumable?.sessionHandle ?? null
  }
  if (!sessionHandle) {
    sessionHandle = generateJobId("session")
  }

  const job = createJob(cwd, {
    kind: "task",
    provider,
    model: resolvedModel,
    backend: backendName,
    resumable: true,
  })
  const backend = createBackend(backendName)
  markRunning(cwd, job.id, { pid: null })
  try {
    const execution = await backend.sendPrompt({
      provider,
      model: resolvedModel,
      prompt,
      sessionHandle,
      onSpawn: (pid) => markRunning(cwd, job.id, { pid }),
    })
    if (await waitForCancelledJob(job.id, 1, 0)) {
      console.log(`Job ${job.id} was cancelled.`)
      return
    }
    if (execution.exitCode !== 0) {
      if (await waitForCancelledJob(job.id)) {
        console.log(`Job ${job.id} was cancelled.`)
        return
      }
      markError(cwd, job.id, {
        errorMessage: `Backend exited with code ${execution.exitCode}: ${execution.stderr || execution.rawOutput || "no output"}`,
      })
      console.error(`Task failed: backend exited with code ${execution.exitCode}`)
      process.exitCode = 1
      return
    }
    markDone(cwd, job.id, {
      result: { rawOutput: execution.rawOutput },
      sessionHandle,
    })
    console.log(execution.rawOutput)
  } catch (error) {
    if (await waitForCancelledJob(job.id)) {
      console.log(`Job ${job.id} was cancelled.`)
      return
    }
    markError(cwd, job.id, { errorMessage: error.message })
    console.error(`Task failed: ${error.message}`)
    process.exitCode = 1
  }
}

async function main() {
  switch (subcommand) {
    case "setup":
      await runSetup(rest)
      break
    case "models":
      runModels()
      break
    case "status":
      runStatus(rest)
      break
    case "result":
      runResult(rest)
      break
    case "cancel":
      await runCancel(rest)
      break
    case "review":
      await runReview(rest)
      break
    case "task":
      await runTask(rest)
      break
    default:
      console.error(
        "Usage: rejion-companion.mjs <setup|models|review|task|status|result|cancel> [...args]"
      )
      process.exitCode = 1
  }
}

main()
