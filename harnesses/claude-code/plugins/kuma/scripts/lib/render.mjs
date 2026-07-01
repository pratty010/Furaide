const STATUS_COLUMNS = ["id", "task kind", "provider", "model", "backend", "phase", "resumable", "result ready"];

function padColumn(value, width) {
  return String(value).padEnd(width);
}

export function renderStatusTable(jobs) {
  if (jobs.length === 0) {
    return "No jobs recorded for this workspace yet.";
  }
  const rows = jobs.map((job) => [
    job.id,
    job.kind,
    job.provider,
    job.model,
    job.backend,
    job.status,
    job.resumable ? "yes" : "no",
    job.resultReady ? "yes" : "no"
  ]);
  const widths = STATUS_COLUMNS.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => String(row[index]).length))
  );
  const headerLine = STATUS_COLUMNS.map((header, index) => padColumn(header, widths[index])).join("  ");
  const separatorLine = widths.map((width) => "-".repeat(width)).join("  ");
  const bodyLines = rows.map((row) => row.map((value, index) => padColumn(value, widths[index])).join("  "));
  return [headerLine, separatorLine, ...bodyLines].join("\n");
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
    `resumable: ${job.resumable ? "yes" : "no"}`
  ];
  return lines.join("\n");
}

function validateReviewResultShape(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "Expected a top-level JSON object.";
  }
  if (typeof data.verdict !== "string" || !data.verdict.trim()) {
    return "Missing string `verdict`.";
  }
  if (typeof data.summary !== "string" || !data.summary.trim()) {
    return "Missing string `summary`.";
  }
  if (!Array.isArray(data.findings)) {
    return "Missing array `findings`.";
  }
  if (!Array.isArray(data.next_steps)) {
    return "Missing array `next_steps`.";
  }
  return null;
}

export function renderResult(job) {
  const header = renderJobDetail(job);
  if (job.status === "error") {
    return [header, "", "Error:", job.errorMessage ?? "(no error message stored)"].join("\n");
  }
  if (job.status !== "done" || !job.result) {
    return [header, "", "No result available yet."].join("\n");
  }
  if (job.kind !== "review") {
    return [header, "", "Result:", "```text", String(job.result.rawOutput ?? job.result.text ?? ""), "```"].join("\n");
  }

  let parsed = null;
  try {
    parsed = JSON.parse(job.result.rawOutput ?? "");
  } catch {
    return [
      header,
      "",
      "Kuma did not receive valid structured JSON from the backend.",
      "",
      "Raw final message:",
      "```text",
      String(job.result.rawOutput ?? ""),
      "```"
    ].join("\n");
  }

  const validationError = validateReviewResultShape(parsed);
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
      "```"
    ].join("\n");
  }

  const findingLines = parsed.findings.map(
    (finding) => `- [${finding.severity}] ${finding.title} (${finding.file}:${finding.line_start ?? "?"})`
  );
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
    parsed.next_steps.length ? parsed.next_steps.map((step) => `- ${step}`).join("\n") : "(none)"
  ].join("\n");
}
