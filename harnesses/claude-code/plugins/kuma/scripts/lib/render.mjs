import { normalizeOpencodeEvent, normalizePiEvent, parseJsonLines } from "./events.mjs"

const STATUS_COLUMNS = [
  "id",
  "task kind",
  "provider",
  "model",
  "backend",
  "status",
  "phase",
  "resumable",
  "result ready",
]

function padColumn(value, width) {
  return String(value).padEnd(width)
}

export function renderStatusTable(jobs) {
  if (jobs.length === 0) {
    return "No jobs recorded for this workspace yet."
  }
  const rows = jobs.map((job) => [
    job.id,
    job.kind,
    job.provider,
    job.model,
    job.backend,
    job.status,
    job.phase ?? "-",
    job.resumable ? "yes" : "no",
    job.resultReady ? "yes" : "no",
  ])
  const widths = STATUS_COLUMNS.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => String(row[index]).length))
  )
  const headerLine = STATUS_COLUMNS.map((header, index) => padColumn(header, widths[index])).join(
    "  "
  )
  const separatorLine = widths.map((width) => "-".repeat(width)).join("  ")
  const bodyLines = rows.map((row) =>
    row.map((value, index) => padColumn(value, widths[index])).join("  ")
  )
  return [headerLine, separatorLine, ...bodyLines].join("\n")
}

export function renderJobDetail(job) {
  const lines = [
    `id: ${job.id}`,
    `kind: ${job.kind}`,
    `provider: ${job.provider}`,
    `model: ${job.model}`,
    `backend: ${job.backend}`,
    `status: ${job.status}`,
    `phase (hint, non-authoritative): ${job.phase ?? "(none)"}`,
    `resumable: ${job.resumable ? "yes" : "no"}`,
  ]
  return lines.join("\n")
}

function validateReviewResultShape(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "Expected a top-level JSON object."
  }
  if (!["approve", "needs-attention"].includes(data.verdict)) {
    return "Missing valid `verdict` (`approve` or `needs-attention`)."
  }
  if (typeof data.summary !== "string" || !data.summary.trim()) {
    return "Missing string `summary`."
  }
  if (!Array.isArray(data.findings)) {
    return "Missing array `findings`."
  }
  for (const [index, finding] of data.findings.entries()) {
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
      return `Finding ${index + 1} must be an object.`
    }
    if (!["critical", "high", "medium", "low"].includes(finding.severity)) {
      return `Finding ${index + 1} has invalid \`severity\`.`
    }
    for (const key of ["title", "body", "file", "recommendation"]) {
      if (typeof finding[key] !== "string" || !finding[key].trim()) {
        return `Finding ${index + 1} missing string \`${key}\`.`
      }
    }
    for (const key of ["line_start", "line_end"]) {
      if (!Number.isInteger(finding[key]) || finding[key] < 1) {
        return `Finding ${index + 1} missing positive integer \`${key}\`.`
      }
    }
    if (
      typeof finding.confidence !== "number" ||
      finding.confidence < 0 ||
      finding.confidence > 1
    ) {
      return `Finding ${index + 1} missing confidence between 0 and 1.`
    }
  }
  if (!Array.isArray(data.next_steps)) {
    return "Missing array `next_steps`."
  }
  if (data.next_steps.some((step) => typeof step !== "string" || !step.trim())) {
    return "`next_steps` must contain non-empty strings."
  }
  return null
}

function parseJsonCandidate(candidate) {
  if (typeof candidate !== "string") return null
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

function findReviewShape(value, visited = new Set()) {
  if (!value || typeof value !== "object") return null
  if (visited.has(value)) return null
  visited.add(value)

  if (!validateReviewResultShape(value)) {
    return value
  }

  for (const key of ["text", "content", "message", "output", "response"]) {
    const parsed = parseJsonCandidate(value[key])
    const match = parsed ? findReviewShape(parsed, visited) : null
    if (match) return match
  }

  for (const nested of Object.values(value)) {
    if (typeof nested === "string") {
      const parsed = parseJsonCandidate(nested)
      const match = parsed ? findReviewShape(parsed, visited) : null
      if (match) return match
      continue
    }
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const match = findReviewShape(item, visited)
        if (match) return match
      }
      continue
    }
    const match = findReviewShape(nested, visited)
    if (match) return match
  }

  return null
}

function extractReviewPayload(job) {
  const rawOutput = String(job.result?.rawOutput ?? "")
  const direct = parseJsonCandidate(rawOutput)
  const directMatch = direct ? findReviewShape(direct) : null
  if (directMatch) return directMatch

  const lines = parseJsonLines(rawOutput)
  if (lines.length === 0) return null

  const normalizeEvent = job.backend === "pi" ? normalizePiEvent : normalizeOpencodeEvent
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let normalized = null
    try {
      normalized = normalizeEvent(lines[index])
    } catch {
      normalized = null
    }
    if (normalized?.message) {
      const parsed = parseJsonCandidate(normalized.message)
      const match = parsed ? findReviewShape(parsed) : null
      if (match) return match
    }
    if (normalized?.payload && typeof normalized.payload === "object") {
      const match = findReviewShape(normalized.payload)
      if (match) return match
    }

    const rawMatch = findReviewShape(lines[index])
    if (rawMatch) return rawMatch
  }

  return null
}

export function renderResult(job) {
  const header = renderJobDetail(job)
  if (job.status === "error") {
    return [header, "", "Error:", job.errorMessage ?? "(no error message stored)"].join("\n")
  }
  if (job.status !== "done" || !job.result) {
    return [header, "", "No result available yet."].join("\n")
  }
  if (job.kind !== "review") {
    return [
      header,
      "",
      "Result:",
      "```text",
      String(job.result.rawOutput ?? job.result.text ?? ""),
      "```",
    ].join("\n")
  }

  const parsed = extractReviewPayload(job)
  if (!parsed) {
    return [
      header,
      "",
      "Kuma did not receive valid structured JSON from the backend.",
      "",
      "Raw final message:",
      "```text",
      String(job.result.rawOutput ?? ""),
      "```",
    ].join("\n")
  }

  const validationError = validateReviewResultShape(parsed)
  if (validationError) {
    return [
      header,
      "",
      "Backend returned JSON with an unexpected review shape.",
      `- Validation error: ${validationError}`,
      "",
      "Raw final message:",
      "```text",
      String(job.result.rawOutput ?? ""),
      "```",
    ].join("\n")
  }

  const findingLines = parsed.findings.map(
    (finding) =>
      `- [${finding.severity}] ${finding.title} (${finding.file}:${finding.line_start ?? "?"})`
  )
  return [
    header,
    "",
    `Verdict: ${parsed.verdict}`,
    `Summary: ${parsed.summary}`,
    "",
    "Findings:",
    findingLines.length ? findingLines.join("\n") : "(none)",
    "",
    "Next steps:",
    parsed.next_steps.length ? parsed.next_steps.map((step) => `- ${step}`).join("\n") : "(none)",
  ].join("\n")
}
