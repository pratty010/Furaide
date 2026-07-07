import { readdirSync, existsSync, statSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import type { SessionAdapter } from './base.js'
import type { CheckpointMap } from '../store/checkpoint.js'
import { getCheckpoint, saveCheckpoint, computePrefixHash, shouldRescan } from '../store/checkpoint.js'
import { makeTypedEvent, type EventEnvelope, type CapabilityInvokedPayload } from '../types/events.js'

const DEFAULT_TRANSCRIPTS = join(homedir(), '.claude', 'projects')

export class ClaudeCodeAdapter implements SessionAdapter {
  readonly harness = 'claude_code' as const

  constructor(private readonly transcriptsDir: string = DEFAULT_TRANSCRIPTS) {}

  async *scan(checkpoints: CheckpointMap): AsyncGenerator<EventEnvelope> {
    if (!existsSync(this.transcriptsDir)) return

    for (const slug of readdirSync(this.transcriptsDir)) {
      const projDir = join(this.transcriptsDir, slug)
      const stat = statSync(projDir)
      if (!stat.isDirectory()) continue

      for (const file of readdirSync(projDir).filter(f => f.endsWith('.jsonl'))) {
        const transcriptPath = join(projDir, file)
        const sessionId = basename(file, '.jsonl')
        const sourceId = `cc:${slug}/${sessionId}`
        const fstat = statSync(transcriptPath)
        const ck = getCheckpoint(checkpoints, sourceId)

        if (!shouldRescan(ck, fstat.ino, fstat.size, fstat.mtimeMs)) continue

        const content = readFileSync(transcriptPath, 'utf8')
        const lines = content.split('\n')
        const startOffset = ck?.last_complete_line_offset ?? 0
        let byteOffset = 0
        let lastCompleteOffset = startOffset

        for (const line of lines) {
          const lineByteLen = Buffer.byteLength(line, 'utf8') + 1
          if (byteOffset < startOffset) { byteOffset += lineByteLen; continue }
          if (!line.trim()) { byteOffset += lineByteLen; lastCompleteOffset = byteOffset; continue }

          let parsed: Record<string, unknown>
          try {
            parsed = JSON.parse(line)
          } catch {
            console.warn(`[idisu/cc] skipped malformed line at offset ${byteOffset} in ${transcriptPath}`)
            byteOffset += lineByteLen
            continue
          }

          yield* this.emitFromLine(parsed, sourceId, byteOffset, sessionId)
          byteOffset += lineByteLen
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
    }
  }

  private *emitFromLine(
    parsed: Record<string, unknown>,
    sourceId: string,
    offset: number,
    sessionId: string,
  ): Generator<EventEnvelope> {
    if (parsed.type !== 'assistant') return

    const msg = parsed.message as Record<string, unknown> | undefined
    const content = (msg?.content as unknown[]) ?? []
    const turnIndex = typeof parsed.turnIndex === 'number' ? parsed.turnIndex : offset

    for (const [index, block] of content.entries()) {
      const b = block as Record<string, unknown>
      if (b.type === 'tool_use' && b.name === 'Skill') {
        const input = b.input as Record<string, unknown> | undefined
        const skillName = input?.skill as string | undefined
        if (!skillName) continue
        const toolUseId = b.id as string | undefined
        const eventSourceId = toolUseId ? `cc-hook:${sessionId}` : sourceId
        const sourcePosition = toolUseId ? `skill.invoke:${toolUseId}` : `${offset}:${index}`

        yield makeTypedEvent('capability.invoked', eventSourceId, sourcePosition, 'claude_code', {
          session_id: sessionId,
          turn_index: turnIndex,
          capability_id: skillName,
          capability_type: 'skill',
          harness: 'claude_code',
          trigger: 'model',
          tool_use_id: toolUseId,
          observability_level: 'observed',
          confidence: 1.0,
        } satisfies CapabilityInvokedPayload)
      }
    }
  }
}
