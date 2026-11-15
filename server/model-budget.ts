// Database-free development/test gate. PostgreSQL deployments use SharedModelBudget.
export type ModelCapacityReason =
  | 'request_budget_exhausted'
  | 'concurrency_limit_reached'
  | 'replica_settings_mismatch'
  | 'coordination_contention'
  | 'slot_expired'
  | 'no_active_admission';

export class ModelCapacityError extends Error {
  constructor(message: string, readonly reason: ModelCapacityReason) {
    super(message);
  }
}

export function readModelLimit(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}.`);
  }
  return Number(raw);
}

export class ModelBudget {
  private used = 0;
  private active = 0;
  private resetAt: number;

  constructor(
    private readonly requests: number,
    private readonly windowMs: number,
    private readonly concurrency: number,
    private readonly clock = Date.now,
  ) {
    this.resetAt = clock() + windowMs;
  }

  private resetWindow(now: number) {
    if (now >= this.resetAt) {
      this.used = 0;
      this.resetAt = now + this.windowMs;
    }
  }

  private reserveRequest(now: number) {
    this.resetWindow(now);
    if (this.used >= this.requests) {
      throw new ModelCapacityError('Model request budget is exhausted.', 'request_budget_exhausted');
    }
    this.used++;
  }

  acquire(): () => void {
    const now = this.clock();
    this.resetWindow(now);
    if (this.used >= this.requests) {
      throw new ModelCapacityError('Model request budget is exhausted.', 'request_budget_exhausted');
    }
    if (this.active >= this.concurrency) {
      throw new ModelCapacityError('Model concurrency limit is reached.', 'concurrency_limit_reached');
    }
    // Reserve synchronously, before fetch can yield. Failed provider attempts
    // still count: they may have incurred charges. Rejected admissions do not.
    this.used++;
    this.active++;
    let released = false;
    return () => {
      if (!released) { this.active--; released = true; }
    };
  }

  // Reserve another outbound attempt within an already-admitted logical call.
  // It consumes request budget but shares that call's concurrency slot.
  recordAttempt(): void {
    this.reserveRequest(this.clock());
  }
}
