#!/usr/bin/env node
import { parseArgs } from "./lib/args.mjs";
import { binaryAvailable } from "./lib/process.mjs";
import { createBackend, BACKEND_NAMES } from "./lib/backend.mjs";
import { setConfig, getConfig, findLastResumableJob, listJobs, generateJobId } from "./lib/state.mjs";
import { mergeBackendListings, enrichWithBaseLlm, saveModelIndex, loadModelIndex, V1_PROVIDERS } from "./lib/models.mjs";
import { renderStatusTable, renderResult } from "./lib/render.mjs";
import { createJob, markRunning, markDone, markError, markCancelled, isJobActive } from "./lib/job.mjs";
import { resolveReviewTarget, collectDiffShortstat } from "./lib/git.mjs";

const [, , subcommand, ...rest] = process.argv;
const cwd = process.cwd();

async function fetchBaseLlmEnrichment() {
  try {
    const response = await fetch("https://basellm.github.io/llm-metadata/api/newapi/models.json");
    if (!response.ok) return [];
    const body = await response.json();
    return Array.isArray(body?.data) ? body.data : [];
  } catch {
    return [];
  }
}

async function runSetup(args) {
  const { options } = parseArgs(args, {
    valueOptions: ["default-backend", "default-model"],
    booleanOptions: []
  });

  const opencodeBin = binaryAvailable("opencode");
  const piBin = binaryAvailable("pi");

  const opencodeBackend = createBackend("opencode");
  const piBackend = createBackend("pi");
  const opencodeAuth = opencodeBin.available ? await opencodeBackend.getAuthStatuses() : { available: false, raw: "opencode not installed" };
  const piAuth = piBin.available ? await piBackend.getAuthStatuses() : { available: false, raw: "pi not installed" };

  let opencodeModels = [];
  let piModels = [];
  try {
    if (opencodeBin.available) opencodeModels = await opencodeBackend.listModels();
  } catch { /* leave empty on failure; setup should not hard-fail */ }
  try {
    if (piBin.available) piModels = await piBackend.listModels();
  } catch { /* leave empty on failure */ }

  let merged = mergeBackendListings({ opencodeModels, piModels });
  const enrichmentSource = await fetchBaseLlmEnrichment();
  if (enrichmentSource.length > 0) {
    merged = enrichWithBaseLlm(merged, enrichmentSource);
  }
  saveModelIndex(cwd, merged);

  if (options["default-backend"]) {
    if (!BACKEND_NAMES.includes(options["default-backend"])) {
      console.error(`Invalid --default-backend. Expected one of: ${BACKEND_NAMES.join(", ")}`);
      process.exitCode = 1;
      return;
    }
    setConfig(cwd, "defaultBackend", options["default-backend"]);
  }
  if (options["default-model"]) {
    setConfig(cwd, "defaultModel", options["default-model"]);
  }

  console.log(`opencode binary: ${opencodeBin.available ? "found" : "NOT FOUND"}`);
  console.log(`pi binary: ${piBin.available ? "found" : "NOT FOUND"}`);
  console.log(`opencode auth: ${opencodeAuth.available ? "ready" : "not ready"}`);
  console.log(`pi auth (OPENCODE_API_KEY): ${piAuth.available ? "ready" : "not ready"}`);
  console.log(`model index refreshed: ${merged.length} models across ${V1_PROVIDERS.join(", ")}`);
  console.log(getConfig(cwd));
}

function runModels() {
  const { entries } = loadModelIndex(cwd);
  if (entries.length === 0) {
    console.log("No model index cached yet. Run `/kuma:setup` first.");
    return;
  }
  const header = ["model", "provider", "backend", "capabilities", "context", "status"];
  const rows = entries.map((e) => [e.model, e.provider, e.backend, e.capabilities ?? "-", e.context ?? "-", e.status]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");
  console.log(line(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(line(row));
}

function runStatus(args) {
  const jobId = args.find((a) => !a.startsWith("-"));
  const jobs = listJobs(cwd);
  if (jobId) {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) {
      console.error(`No job found with id ${jobId}`);
      process.exitCode = 1;
      return;
    }
    console.log(renderResult(job));
    return;
  }
  console.log(renderStatusTable(jobs));
}

function runResult(args) {
  const jobId = args[0];
  if (!jobId) {
    console.error("Usage: kuma-companion.mjs result <job-id>");
    process.exitCode = 1;
    return;
  }
  const job = listJobs(cwd).find((j) => j.id === jobId);
  if (!job) {
    console.error(`No job found with id ${jobId}`);
    process.exitCode = 1;
    return;
  }
  console.log(renderResult(job));
}

async function runCancel(args) {
  const jobId = args[0];
  if (!jobId) {
    console.error("Usage: kuma-companion.mjs cancel <job-id>");
    process.exitCode = 1;
    return;
  }
  const job = listJobs(cwd).find((j) => j.id === jobId);
  if (!job) {
    console.error(`No job found with id ${jobId}`);
    process.exitCode = 1;
    return;
  }
  if (!isJobActive(job)) {
    console.log(`Job ${jobId} is already ${job.status}; nothing to cancel.`);
    return;
  }
  const backend = createBackend(job.backend === "both" ? "opencode" : job.backend);
  await backend.cancel(job.pid);
  markCancelled(cwd, jobId);
  console.log(`Job ${jobId} cancelled.`);
}

function resolveDefaultsOrFail(options) {
  const config = getConfig(cwd);
  const backend = options.backend ?? config.defaultBackend;
  const model = options.model ?? config.defaultModel;
  if (!backend || !model) {
    console.error("Missing --backend/--model and no defaults configured. Run `/kuma:setup` first.");
    process.exitCode = 1;
    return null;
  }
  return { backend, model };
}

function resolveProviderForModel(model) {
  const { entries } = loadModelIndex(cwd);
  const match = entries.find((e) => e.model === model);
  return match?.provider ?? "opencode-go";
}

async function runReview(args) {
  const { options } = parseArgs(args, {
    valueOptions: ["backend", "model", "base", "scope", "mode"],
    booleanOptions: ["wait", "background"]
  });

  const resolved = resolveDefaultsOrFail(options);
  if (!resolved) return;
  const { backend: backendName, model } = resolved;
  const provider = resolveProviderForModel(model);

  const target = resolveReviewTarget(cwd, { scope: options.scope, base: options.base });
  const stat = collectDiffShortstat(cwd, target);

  const promptPrefix = options.mode === "adversarial"
    ? "Perform an adversarial code review. Assume the diff is trying to hide a bug. "
    : "Perform a code review. ";
  const prompt = `${promptPrefix}Target: ${target.label}. ${JSON.stringify(stat)}. Respond with the review-output JSON schema (verdict, summary, findings, next_steps).`;

  const job = createJob(cwd, { kind: "review", provider, model, backend: backendName, resumable: false });
  const backend = createBackend(backendName);
  markRunning(cwd, job.id, { pid: null });
  try {
    const execution = await backend.sendPrompt({
      provider,
      model,
      prompt,
      onSpawn: (pid) => markRunning(cwd, job.id, { pid })
    });
    markDone(cwd, job.id, { result: { rawOutput: execution.rawOutput } });
    console.log(renderResult({ ...job, status: "done", result: { rawOutput: execution.rawOutput } }));
  } catch (error) {
    markError(cwd, job.id, { errorMessage: error.message });
    console.error(`Review failed: ${error.message}`);
    process.exitCode = 1;
  }
}

async function runTask(args) {
  const { options, positionals } = parseArgs(args, {
    valueOptions: ["backend", "model"],
    booleanOptions: ["wait", "background", "resume", "fresh"]
  });

  const resolved = resolveDefaultsOrFail(options);
  if (!resolved) return;
  const { backend: backendName, model } = resolved;
  const provider = resolveProviderForModel(model);
  const prompt = positionals.join(" ");

  if (!options.fresh) {
    const existingActive = listJobs(cwd).find((j) => isJobActive(j) && j.kind === "task");
    if (existingActive) {
      console.error(
        `A task job (${existingActive.id}) is already active for this workspace. Use \`/kuma:cancel ${existingActive.id}\` or wait for it to finish before starting another.`
      );
      process.exitCode = 1;
      return;
    }
  }

  // Kuma owns the session handle rather than waiting for the backend to hand one back:
  // neither adapter's `sendPrompt` returns a generated session id (opencode/pi don't surface
  // one in a way we can parse reliably), so Kuma pre-generates a handle and always passes it
  // via `--session <handle>`, making resume deterministic instead of best-effort.
  let sessionHandle = null;
  if (options.resume) {
    const lastResumable = findLastResumableJob(cwd);
    sessionHandle = lastResumable?.sessionHandle ?? null;
  }
  if (!sessionHandle) {
    sessionHandle = generateJobId("session");
  }

  const job = createJob(cwd, { kind: "task", provider, model, backend: backendName, resumable: true });
  const backend = createBackend(backendName);
  markRunning(cwd, job.id, { pid: null });
  try {
    const execution = await backend.sendPrompt({
      provider,
      model,
      prompt,
      sessionHandle,
      onSpawn: (pid) => markRunning(cwd, job.id, { pid })
    });
    markDone(cwd, job.id, {
      result: { rawOutput: execution.rawOutput },
      sessionHandle
    });
    console.log(execution.rawOutput);
  } catch (error) {
    markError(cwd, job.id, { errorMessage: error.message });
    console.error(`Task failed: ${error.message}`);
    process.exitCode = 1;
  }
}

async function main() {
  switch (subcommand) {
    case "setup":
      await runSetup(rest);
      break;
    case "models":
      runModels();
      break;
    case "status":
      runStatus(rest);
      break;
    case "result":
      runResult(rest);
      break;
    case "cancel":
      await runCancel(rest);
      break;
    case "review":
      await runReview(rest);
      break;
    case "task":
      await runTask(rest);
      break;
    default:
      console.error("Usage: kuma-companion.mjs <setup|models|review|task|status|result|cancel> [...args]");
      process.exitCode = 1;
  }
}

main();
