import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { CACHE_DIR, IDISU_DB } from '../../paths.js'
import { writeReport } from '../../report/html.js'
import { buildMetricProjections } from '../../dream/consolidate.js'
import { openDb } from '../../store/db.js'
import { readAllEvents } from '../../store/repo.js'

// Phase 5 (Task 5.4): reads events from `idisu.db` (the `events` table) now
// that Gather writes exclusively there — this used to iterate date-partitioned
// JSONL files under `EVENTS_DIR` via `store/event-log.ts#readEvents`, which is
// deleted as of this task. There was never a `--date`/date-range CLI flag on
// `idisu report`; the old loop over `readdirSync(EVENTS_DIR)` just replayed
// every date partition unconditionally, so reading the full `events` table
// here (via the same `readAllEvents` helper `dream/dream.ts` effectively
// duplicates) preserves identical behavior, not a simplification of a real
// filtering feature.
export async function cmdReport(args: string[]): Promise<void> {
  const serve = args.includes('--serve')
  const outPath = join(CACHE_DIR, 'report.html')

  const db = openDb(IDISU_DB)
  let allEvents
  try {
    allEvents = readAllEvents(db)
  } finally {
    db.close()
  }

  const metrics = buildMetricProjections(allEvents, 1)
  writeReport(metrics, outPath)
  console.log(`[idisu] Report written to ${outPath}`)

  if (serve) {
    const proc = spawn('python3', ['-m', 'http.server', '8787', '--directory', CACHE_DIR], { stdio: 'inherit' })
    console.log('[idisu] Serving at http://localhost:8787/report.html — Ctrl+C to stop')
    await new Promise<void>(resolve => proc.on('close', () => resolve()))
  }
}
