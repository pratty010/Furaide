#!/usr/bin/env node
import { parseArgs } from "./lib/args.mjs";
import { binaryAvailable } from "./lib/process.mjs";
import { createBackend, BACKEND_NAMES } from "./lib/backend.mjs";
import { setConfig, getConfig } from "./lib/state.mjs";
import { mergeBackendListings, enrichWithBaseLlm, saveModelIndex, loadModelIndex, V1_PROVIDERS } from "./lib/models.mjs";
import { renderStatusTable, renderResult } from "./lib/render.mjs";
import { listJobs } from "./lib/state.mjs";
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
    case "task":
      console.error(`"${subcommand}" is implemented in Task 4.2`);
      process.exitCode = 1;
      break;
    default:
      console.error("Usage: kuma-companion.mjs <setup|models|review|task|status|result|cancel> [...args]");
      process.exitCode = 1;
  }
}

main();
