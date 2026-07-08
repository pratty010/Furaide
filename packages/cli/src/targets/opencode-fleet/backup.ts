// packages/cli/src/targets/opencode-fleet/backup.ts
//
// Backup root is `<targetDir>/.kura_backup/<installTimestamp>` (leading-dot
// required). On a repeat install, if the target already has an install
// receipt with a recorded backup.root, that root is REUSED instead of
// minting a new timestamped one -- otherwise the true original backup from
// an earlier run becomes orphaned. A file already present under the backup
// root is never re-backed-up: first backup wins.

import { existsSync, mkdirSync, copyFileSync, lstatSync, readlinkSync, symlinkSync, readFileSync } from "node:fs";
import { dirname, join, relative, isAbsolute } from "node:path";

export const BACKUP_DIR_NAME = ".furaide-backup";
export const RECEIPT_FILENAME = ".furaide-receipt.json";
/** Read-only fallback so installs from before this rename aren't orphaned —
 * existingReceiptBackupRoot() and receipt.ts's readReceipt() both check this
 * name if the current RECEIPT_FILENAME isn't found. Never written to. */
export const LEGACY_RECEIPT_FILENAME = ".furaide-install-receipt.json";

/** Per-install-run backup bookkeeping. Threaded explicitly (not module-level
 * global state) so this stays independently unit-testable. */
export interface BackupState {
  roots: Map<string, string>;
  created: Map<string, boolean>;
}

export function createBackupState(): BackupState {
  return { roots: new Map(), created: new Map() };
}

/** Reads a target's existing install receipt (if any) and returns its
 * recorded backup.root, or null. Deliberately does NOT use receipt.ts's
 * schema-validated readReceipt() -- a receipt with an otherwise malformed
 * shape should still let backup-root reuse work for this one field. */
export function existingReceiptBackupRoot(targetDir: string): string | null {
  let receiptPath = join(targetDir, RECEIPT_FILENAME);
  if (!existsSync(receiptPath)) {
    const legacyPath = join(targetDir, LEGACY_RECEIPT_FILENAME);
    if (!existsSync(legacyPath)) return null;
    receiptPath = legacyPath;
  }
  try {
    const raw = readFileSync(receiptPath, "utf8");
    const parsed = JSON.parse(raw) as { backup?: { root?: string | null } };
    const root = parsed?.backup?.root;
    return typeof root === "string" && root.length > 0 ? root : null;
  } catch {
    return null;
  }
}

/** Returns the backup root for targetDir, minting it on first use within
 * this BackupState, or reusing a prior run's recorded receipt root. */
export function ensureBackupRoot(targetDir: string, installTimestamp: string, state: BackupState): string {
  const existing = state.roots.get(targetDir);
  if (existing) return existing;
  const fromReceipt = existingReceiptBackupRoot(targetDir);
  const root = fromReceipt ?? join(targetDir, BACKUP_DIR_NAME, installTimestamp);
  state.roots.set(targetDir, root);
  return root;
}

function pathExistsOrIsSymlink(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** If `dst` exists and no backup for that relative path exists yet under
 * this target's backup root, copies it there (preserving symlinks) before
 * the installer overwrites it. No-op if `dst` doesn't exist, is outside
 * `targetDir`, or already has a backup entry. */
export function backupExistingFile(
  dst: string,
  targetDir: string,
  installTimestamp: string,
  state: BackupState,
  options: { dryRun?: boolean } = {}
): { backedUp: boolean; backupPath: string | null } {
  if (!pathExistsOrIsSymlink(dst)) return { backedUp: false, backupPath: null };

  const rel = relative(targetDir, dst);
  if (rel.startsWith("..") || isAbsolute(rel)) return { backedUp: false, backupPath: null };

  const root = ensureBackupRoot(targetDir, installTimestamp, state);
  const backupPath = join(root, rel);
  if (pathExistsOrIsSymlink(backupPath)) return { backedUp: false, backupPath };

  if (options.dryRun) {
    state.created.set(targetDir, true);
    return { backedUp: true, backupPath };
  }

  mkdirSync(dirname(backupPath), { recursive: true });
  const srcStat = lstatSync(dst);
  if (srcStat.isSymbolicLink()) symlinkSync(readlinkSync(dst), backupPath);
  else copyFileSync(dst, backupPath);
  state.created.set(targetDir, true);
  return { backedUp: true, backupPath };
}

/** Whether ensureBackupRoot/backupExistingFile created at least one backup
 * for targetDir during THIS BackupState's lifetime. Callers preserving a
 * prior run's `backup.created: true` across a no-op repeat install must OR
 * this with the previous receipt's value themselves. */
export function wasBackupCreated(targetDir: string, state: BackupState): boolean {
  return state.created.get(targetDir) ?? false;
}
