import { mkdirSync, existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DREAM_LOCK_FILE } from './paths.js'

export class DreamLock {
  private locked = false
  private readonly lockDir = `${DREAM_LOCK_FILE}.d`
  private readonly metadataFile = join(this.lockDir, 'owner.json')

  acquire(timeoutMs = 5_000, staleMs = 60 * 60 * 1000): void {
    const dir = dirname(DREAM_LOCK_FILE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const deadline = Date.now() + timeoutMs
    while (true) {
      try {
        mkdirSync(this.lockDir)
        writeFileSync(this.metadataFile, JSON.stringify({ pid: process.pid, acquired_at: Date.now() }))
        this.locked = true
        return
      } catch {
        if (this.isStale(staleMs)) {
          rmSync(this.lockDir, { recursive: true, force: true })
          continue
        }
        if (Date.now() >= deadline) {
          throw new Error('satori dream already running')
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
      }
    }
  }

  release(): void {
    if (this.locked) {
      rmSync(this.lockDir, { recursive: true, force: true })
      this.locked = false
    }
  }

  private isStale(staleMs: number): boolean {
    try {
      const metadata = JSON.parse(readFileSync(this.metadataFile, 'utf8')) as { acquired_at?: number }
      return typeof metadata.acquired_at === 'number' && Date.now() - metadata.acquired_at > staleMs
    } catch {
      return false
    }
  }

  withLock<T>(fn: () => Promise<T>): Promise<T> {
    this.acquire()
    return fn().finally(() => this.release())
  }
}

export const dreamLock = new DreamLock()
