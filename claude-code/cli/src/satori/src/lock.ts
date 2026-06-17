import { openSync, closeSync } from 'fs'
import { mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { DREAM_LOCK_FILE } from './paths.js'

export class DreamLock {
  private fd: number | null = null

  acquire(): void {
    const dir = dirname(DREAM_LOCK_FILE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.fd = openSync(DREAM_LOCK_FILE, 'w')
    // Primary lock is held by the stop.sh bash hook via `flock -x -n`.
    // This class provides a belt-and-suspenders in-process guard only.
  }

  release(): void {
    if (this.fd !== null) {
      closeSync(this.fd)
      this.fd = null
    }
  }

  withLock<T>(fn: () => Promise<T>): Promise<T> {
    this.acquire()
    return fn().finally(() => this.release())
  }
}

export const dreamLock = new DreamLock()
