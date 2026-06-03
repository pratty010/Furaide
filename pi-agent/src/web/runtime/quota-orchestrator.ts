import { loadQuotaSnapshot, saveQuotaSnapshot, shouldPreserveStaleWindows, type ProviderRateLimits } from "./quota-probe.ts";

const PERSIST_DEBOUNCE_MS = 10_000;

export type Prober = () => Promise<ProviderRateLimits>;

export interface OrchestratorOpts {
  cooldownMs: number;
  persistPath: string;     // ":none" disables persistence
  probers: Record<string, Prober>;
}

export class QuotaOrchestrator {
  private snapshots: Record<string, ProviderRateLimits> = {};
  private lastProbe: Record<string, number> = {};
  private inFlight = new Set<string>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: OrchestratorOpts) {
    if (opts.persistPath !== ":none") this.snapshots = loadQuotaSnapshot(opts.persistPath);
  }

  getSnapshot(provider: string): ProviderRateLimits | undefined { return this.snapshots[provider]; }
  getAllSnapshots(): Record<string, ProviderRateLimits> { return { ...this.snapshots }; }

  async probe(provider: string, opts: { force?: boolean } = {}): Promise<void> {
    const now = Date.now();
    const last = this.lastProbe[provider] ?? 0;
    if (!opts.force && now - last < this.opts.cooldownMs) return;
    if (this.inFlight.has(provider)) return;
    const prober = this.opts.probers[provider];
    if (!prober) return;

    this.inFlight.add(provider);
    try {
      const fresh = await prober();
      const prev = this.snapshots[provider];
      if (shouldPreserveStaleWindows(prev, fresh)) {
        fresh.windows = prev!.windows.map((w) => ({ ...w }));
        fresh.note = fresh.note ? `${fresh.note} Showing last known values.` : "Showing last known values.";
      }
      this.snapshots[provider] = fresh;
      this.lastProbe[provider] = Date.now();
      this.scheduleSave();
    } catch (err) {
      this.snapshots[provider] = {
        provider, plan: null, account: null, windows: [], apiCostTotal: null, credits: null,
        probedAt: Date.now(), note: null,
        error: err instanceof Error ? err.message : String(err),
      };
      this.lastProbe[provider] = Date.now();
    } finally {
      this.inFlight.delete(provider);
    }
  }

  async probeAll(opts: { force?: boolean } = {}): Promise<void> {
    await Promise.all(Object.keys(this.opts.probers).map((p) => this.probe(p, opts)));
  }

  clearCooldowns(): void { this.lastProbe = {}; }

  private scheduleSave(): void {
    if (this.opts.persistPath === ":none") return;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      saveQuotaSnapshot(this.opts.persistPath, this.snapshots);
    }, PERSIST_DEBOUNCE_MS);
    this.saveTimer.unref?.();
  }

  flushPending(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.opts.persistPath !== ":none") saveQuotaSnapshot(this.opts.persistPath, this.snapshots);
  }
}
