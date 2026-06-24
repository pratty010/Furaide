import { readdirSync, existsSync, statSync, readFileSync } from 'node:fs'
import { join, basename, relative } from 'node:path'
import { homedir } from 'node:os'
import type { SessionAdapter } from './base.js'
import type { CheckpointMap } from '../store/checkpoint.js'
import { getCheckpoint, saveCheckpoint, computePrefixHash, shouldRescan } from '../store/checkpoint.js'
import { makeTypedEvent, type EventEnvelope } from '../types/events.js'

const DEFAULT_SESSIONS_DIR = join(homedir(), '.codex', 'sessions')
const DEFAULT_SKILLS_DIR = join(homedir(), '.codex', 'skills')

export class CodexAdapter implements SessionAdapter {
  readonly harness = 'codex' as const

  constructor(
    private readonly sessionsDir: string = DEFAULT_SESSIONS_DIR,
    private readonly skillsDir: string = DEFAULT_SKILLS_DIR,
  ) {}

  async *scan(checkpoints: CheckpointMap): AsyncGenerator<EventEnvelope> {
    if (!existsSync(this.sessionsDir)) return

    for (const year of readdirSync(this.sessionsDir)) {
      const yearDir = join(this.sessionsDir, year)
      if (!statSync(yearDir).isDirectory()) continue
      for (const month of readdirSync(yearDir)) {
        const monthDir = join(yearDir, month)
        if (!statSync(monthDir).isDirectory()) continue
        for (const day of readdirSync(monthDir)) {
          const dayDir = join(monthDir, day)
          if (!statSync(dayDir).isDirectory()) continue
          for (const file of readdirSync(dayDir).filter(f => f.endsWith('.jsonl'))) {
            yield* this.scanFile(join(dayDir, file), checkpoints)
          }
        }
      }
    }
  }

  private *scanFile(filePath: string, checkpoints: CheckpointMap): Generator<EventEnvelope> {
    const sourceId = `codex:${relative(this.sessionsDir, filePath)}`
    const fstat = statSync(filePath)
    const ck = getCheckpoint(checkpoints, sourceId)
    if (!shouldRescan(ck, fstat.ino, fstat.size, fstat.mtimeMs)) return

    const content = readFileSync(filePath, 'utf8')
    const lines = content.split('\n')
    let byteOffset = 0
    let lastCompleteOffset = ck?.last_complete_line_offset ?? 0
    const startOffset = lastCompleteOffset

    for (const line of lines) {
      const lineLen = Buffer.byteLength(line, 'utf8') + 1
      if (byteOffset < startOffset) { byteOffset += lineLen; continue }
      if (!line.trim()) { byteOffset += lineLen; lastCompleteOffset = byteOffset; continue }

      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(line)
      } catch {
        byteOffset += lineLen
        continue
      }

      yield* this.emitFromLine(parsed, sourceId, byteOffset)
      byteOffset += lineLen
      lastCompleteOffset = byteOffset
    }

    saveCheckpoint(checkpoints, {
      source_id: sourceId,
      inode: fstat.ino,
      size: fstat.size,
      mtime: fstat.mtimeMs,
      prefix_hash: computePrefixHash(content.slice(0, 4096)),
      last_complete_line_offset: lastCompleteOffset,
      last_scanned_at: new Date().toISOString(),
    })
  }

  private *emitFromLine(
    parsed: Record<string, unknown>,
    sourceId: string,
    offset: number,
  ): Generator<EventEnvelope> {
    if (parsed.type !== 'response_item') return
    const payload = parsed.payload as Record<string, unknown> | undefined
    if (payload?.type !== 'function_call') return

    const argsStr = payload.arguments as string | undefined
    if (!argsStr) return

    let args: Record<string, unknown>
    try {
      args = JSON.parse(argsStr)
    } catch {
      return
    }

    const command = args.command as string | undefined
    if (!command) return

    const escapedSkillsDir = this.skillsDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const skillMatch = command.match(new RegExp(`${escapedSkillsDir}/([^/\\s]+)/SKILL\\.md`))
    if (!skillMatch) return

    const skillName = skillMatch[1]
    if (!skillName) return

    yield makeTypedEvent('capability.invoked', sourceId, offset, 'codex', {
      session_id: basename(sourceId).replace('.jsonl', ''),
      turn_index: offset,
      capability_id: skillName,
      capability_type: 'skill',
      harness: 'codex',
      trigger: 'model',
      observability_level: 'inferred',
      confidence: 0.7,
    })
  }
}
