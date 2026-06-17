import type { EventEnvelope } from '../types/events.js'
import type { CheckpointMap } from '../store/checkpoint.js'

export interface SessionAdapter {
  harness: 'claude_code' | 'codex' | 'opencode'
  scan(checkpoints: CheckpointMap): AsyncGenerator<EventEnvelope>
}
