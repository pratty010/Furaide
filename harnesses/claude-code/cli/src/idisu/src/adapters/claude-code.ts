import { readdirSync, existsSync, statSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import type { SessionAdapter } from './base.js'
import type { CheckpointMap } from '../store/checkpoint.js'
import { getCheckpoint, saveCheckpoint, computePrefixHash, shouldRescan } from '../store/checkpoint.js'
import {
  makeTypedEvent,
  type EventEnvelope,
  type CapabilityInvokedPayload,
  type ToolCalledPayload,
  type TurnObservedPayload,
} from '../types/events.js'

const DEFAULT_TRANSCRIPTS = join(homedir(), '.claude', 'projects')

/**
 * Deep-read record shapes (v0.2). Ground truth: docs/superpowers/specs/2026-07-05-claude-code-v2-spec.md §1.
 *
 * - `assistant`: message.content tool_use blocks (all tools) + optional top-level
 *   `attributionSkill` (native skill-usage attribution, no judge needed) + message.usage.
 * - `user`: message.content tool_result blocks — used to detect exit-code / error signals.
 * - `system` with `subtype === 'turn_duration'`: durationMs/messageCount/sessionKind.
 * - `pr-link`: a distinct top-level record type marking a session merged into a PR.
 */
interface ToolUseBlock {
  type: 'tool_use'
  id?: string
  name?: string
  input?: Record<string, unknown>
}

interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id?: string
  is_error?: boolean
  content?: unknown
}

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
    switch (parsed.type) {
      case 'assistant':
        yield* this.emitFromAssistant(parsed, sourceId, offset, sessionId)
        return
      case 'user':
        yield* this.emitFromUser(parsed, sourceId, offset, sessionId)
        return
      case 'system':
        yield* this.emitFromSystem(parsed, sourceId, offset, sessionId)
        return
      case 'pr-link':
        yield* this.emitFromPrLink(parsed, sourceId, offset, sessionId)
        return
      default:
        return
    }
  }

  private *emitFromAssistant(
    parsed: Record<string, unknown>,
    sourceId: string,
    offset: number,
    sessionId: string,
  ): Generator<EventEnvelope> {
    const msg = parsed.message as Record<string, unknown> | undefined
    const rawContent = msg?.content
    const content = Array.isArray(rawContent) ? rawContent : []
    const turnIndex = typeof parsed.turnIndex === 'number' ? parsed.turnIndex : offset
    const ts = typeof parsed.ts === 'string' ? parsed.ts : new Date().toISOString()
    const attributionSkill = typeof parsed.attributionSkill === 'string' ? parsed.attributionSkill : undefined

    for (const [index, block] of content.entries()) {
      const b = block as ToolUseBlock
      if (b.type !== 'tool_use') continue

      const toolName = b.name
      const toolUseId = b.id
      if (!toolName) continue

      // tool.called — emitted for every tool_use block, not just Skill.
      if (toolUseId) {
        yield makeTypedEvent('tool.called', sourceId, `${offset}:${index}`, 'claude_code', {
          session_id: sessionId,
          turn_index: turnIndex,
          tool_name: toolName,
          tool_use_id: toolUseId,
          parent_capability_id: attributionSkill,
          args_present: !!b.input && Object.keys(b.input).length > 0,
          ts,
        } satisfies ToolCalledPayload)
      }

      // Existing behavior: an explicit Skill tool_use is itself a model-triggered
      // capability invocation.
      if (toolName === 'Skill') {
        const input = b.input
        const skillName = input?.skill as string | undefined
        if (!skillName) continue
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

    // capability.invoked — native attributionSkill, no judge needed (confidence 1.0).
    if (attributionSkill) {
      yield makeTypedEvent('capability.invoked', sourceId, `${offset}:attribution`, 'claude_code', {
        session_id: sessionId,
        turn_index: turnIndex,
        capability_id: attributionSkill,
        capability_type: 'skill',
        harness: 'claude_code',
        trigger: 'chain',
        observability_level: 'observed',
        confidence: 1.0,
      } satisfies CapabilityInvokedPayload)
    }
  }

  private *emitFromUser(
    parsed: Record<string, unknown>,
    sourceId: string,
    offset: number,
    sessionId: string,
  ): Generator<EventEnvelope> {
    const msg = parsed.message as Record<string, unknown> | undefined
    const rawContent = msg?.content
    const content = Array.isArray(rawContent) ? rawContent : []

    for (const [index, block] of content.entries()) {
      const b = block as ToolResultBlock
      if (b.type !== 'tool_result' || !b.tool_use_id) continue

      const text = typeof b.content === 'string'
        ? b.content
        : Array.isArray(b.content)
          ? b.content.map(c => (typeof c === 'object' && c && 'text' in c ? (c as { text: unknown }).text : '')).join('\n')
          : ''
      const exitCodeMatch = /exit code[:\s]+(-?\d+)/i.exec(text)
      const exitCode = exitCodeMatch ? Number(exitCodeMatch[1]) : undefined
      const isError = b.is_error === true || (exitCode !== undefined && exitCode !== 0)

      // No signal to report — this tool_result carries no error/exit-code evidence.
      if (!isError && exitCode === undefined) continue

      yield makeTypedEvent('outcome.observed', sourceId, `${offset}:${index}`, 'claude_code', {
        tool_use_id: b.tool_use_id,
        session_id: sessionId,
        status: isError ? 'failure' : 'success',
        exit_code: exitCode,
        used_downstream: false,
        attribution: {},
      })
    }
  }

  private *emitFromSystem(
    parsed: Record<string, unknown>,
    sourceId: string,
    offset: number,
    sessionId: string,
  ): Generator<EventEnvelope> {
    if (parsed.subtype !== 'turn_duration') return

    const turnIndex = typeof parsed.turnIndex === 'number' ? parsed.turnIndex : offset
    const ts = typeof parsed.ts === 'string' ? parsed.ts : new Date().toISOString()

    yield makeTypedEvent('turn.observed', sourceId, `${offset}:turn_duration`, 'claude_code', {
      session_id: sessionId,
      turn_index: turnIndex,
      role: 'assistant',
      ts,
      is_sidechain: false,
      is_meta: false,
      duration_ms: typeof parsed.durationMs === 'number' ? parsed.durationMs : undefined,
      message_count: typeof parsed.messageCount === 'number' ? parsed.messageCount : undefined,
      session_kind: typeof parsed.sessionKind === 'string' ? parsed.sessionKind : undefined,
    } satisfies TurnObservedPayload & {
      duration_ms?: number
      message_count?: number
      session_kind?: string
    })
  }

  private *emitFromPrLink(
    parsed: Record<string, unknown>,
    sourceId: string,
    offset: number,
    sessionId: string,
  ): Generator<EventEnvelope> {
    const merged = parsed.merged === true
    const prNumber = parsed.pr_number as string | number | undefined
    const toolUseId = `pr-link:${prNumber ?? offset}`

    yield makeTypedEvent('outcome.observed', sourceId, `${offset}:pr-link`, 'claude_code', {
      kind: 'pr-link',
      tool_use_id: toolUseId,
      session_id: sessionId,
      status: merged ? 'success' : 'failure',
      used_downstream: merged,
      attribution: {},
      pr_number: prNumber,
      pr_url: parsed.pr_url,
    })
  }
}
