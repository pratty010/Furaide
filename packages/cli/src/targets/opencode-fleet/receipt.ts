// packages/cli/src/targets/opencode-fleet/receipt.ts
//
// Read/write for the v2 install receipt, schema-validated against
// InstallReceiptV2Schema. A malformed or pre-v2 receipt fails loud on read
// -- a thrown Error with the zod issue list -- rather than being silently
// misparsed as v2 shape.

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { InstallReceiptV2Schema, type InstallReceiptV2 } from "./manifest-schema.ts";
import { RECEIPT_FILENAME, LEGACY_RECEIPT_FILENAME } from "./backup.ts";

export { RECEIPT_FILENAME };

export function receiptPath(targetDir: string): string {
  return join(targetDir, RECEIPT_FILENAME);
}

/** Returns null if no receipt exists (a legitimate "not installed" state).
 * Throws a descriptive Error if the file exists but is not valid JSON or
 * does not match InstallReceiptV2Schema. Callers must NOT treat a thrown
 * error as "not installed" -- that would silently proceed over an existing,
 * differently-shaped install. */
export function readReceipt(targetDir: string): InstallReceiptV2 | null {
  let path = receiptPath(targetDir);
  if (!existsSync(path)) {
    const legacyPath = join(targetDir, LEGACY_RECEIPT_FILENAME);
    if (!existsSync(legacyPath)) return null;
    path = legacyPath;
    process.stderr.write(
      `[furaide] note: reading receipt from legacy filename ${LEGACY_RECEIPT_FILENAME}. ` +
        `The next install/uninstall at this target will migrate it to ${RECEIPT_FILENAME}.\n`
    );
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(`receipt.ts: failed to read ${path}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`receipt.ts: ${path} is not valid JSON: ${(err as Error).message}`);
  }

  const result = InstallReceiptV2Schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n");
    const versionHint =
      typeof parsed === "object" && parsed !== null && "version" in (parsed as Record<string, unknown>)
        ? ` (found version=${JSON.stringify((parsed as { version?: unknown }).version)})`
        : " (no 'version' field -- likely a pre-v2 receipt from install-fleet.sh)";
    throw new Error(
      `receipt.ts: ${path} does not match the v2 install receipt schema${versionHint}. Remove it manually (after ` +
        `confirming what it points at) or run the matching legacy uninstaller first. Validation errors:\n${issues}`
    );
  }
  return result.data;
}

/** Validates `receipt` and writes it atomically (tmp file + rename). */
export function writeReceipt(targetDir: string, receipt: InstallReceiptV2): void {
  const validated = InstallReceiptV2Schema.parse(receipt);
  const path = receiptPath(targetDir);
  mkdirSync(dirname(path), { recursive: true });
  const out = JSON.stringify(validated, null, 2) + "\n";
  const tmpFile = join(tmpdir(), `furaide-receipt-${Date.now()}-${process.pid}.json`);
  writeFileSync(tmpFile, out, "utf8");
  try {
    renameSync(tmpFile, path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EXDEV") {
      copyFileSync(tmpFile, path);
      unlinkSync(tmpFile);
    } else {
      throw err;
    }
  }
}

/** No-op if there is no receipt at targetDir. */
export function deleteReceipt(targetDir: string): void {
  const path = receiptPath(targetDir);
  if (existsSync(path)) unlinkSync(path);
  const legacyPath = join(targetDir, LEGACY_RECEIPT_FILENAME);
  if (existsSync(legacyPath)) unlinkSync(legacyPath);
}
