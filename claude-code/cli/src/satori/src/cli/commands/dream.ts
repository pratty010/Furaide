import { runDream } from '../../dream/dream.js'

export async function cmdDream(args: string[]): Promise<void> {
  const force = args.includes('--force')
  console.log('[satori] Starting dream pass...')
  const result = await runDream({ force })
  console.log(`[satori] Dream complete in ${result.durationMs}ms`)
  console.log(`  Events ingested:   ${result.eventsIngested}`)
  console.log(`  Capabilities:      ${result.metricsComputed}`)
  console.log(`  Intent clusters:   ${result.clustersFound}`)
}
