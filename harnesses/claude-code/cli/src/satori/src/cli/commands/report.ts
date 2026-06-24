import { spawn } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { CACHE_DIR, EVENTS_DIR } from '../../paths.js'
import { writeReport } from '../../report/html.js'
import { buildMetricProjections } from '../../dream/consolidate.js'
import { readEvents } from '../../store/event-log.js'

export async function cmdReport(args: string[]): Promise<void> {
  const serve = args.includes('--serve')
  const outPath = join(CACHE_DIR, 'report.html')

  const allEvents = []
  if (existsSync(EVENTS_DIR)) {
    for (const date of readdirSync(EVENTS_DIR).sort()) {
      allEvents.push(...readEvents(date))
    }
  }
  const metrics = buildMetricProjections(allEvents, 1)
  writeReport(metrics, outPath)
  console.log(`[satori] Report written to ${outPath}`)

  if (serve) {
    const proc = spawn('python3', ['-m', 'http.server', '8787', '--directory', CACHE_DIR], { stdio: 'inherit' })
    console.log('[satori] Serving at http://localhost:8787/report.html — Ctrl+C to stop')
    await new Promise<void>(resolve => proc.on('close', () => resolve()))
  }
}
