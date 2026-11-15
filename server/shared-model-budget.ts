import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CoordinationStore } from './store';
import { ModelCapacityError } from './model-budget';

// Longer than the interactive provider deadline. Crashed processes relinquish
// concurrency, never their spent attempts. This is not a provider billing cap.
export const MODEL_SLOT_MS = 60_000;
const KEY = 'model-admission:v1';
const stateSchema = z.object({
  used: z.number().int().nonnegative(),
  resetAt: z.number(),
  requests: z.number().int().nonnegative(),
  windowMs: z.number().positive(),
  concurrency: z.number().int().positive(),
  active: z.array(z.object({ token: z.string(), until: z.number() })),
});
type State = z.infer<typeof stateSchema>;
export interface ModelAdmission {
  release(): Promise<void>;
  recordAttempt(): Promise<void>;
}

export class SharedModelBudget {
  constructor(
    private readonly store: CoordinationStore,
    private readonly requests: number,
    private readonly windowMs: number,
    private readonly concurrency: number,
  ) {}

  private async change(action: (state: State, now: number) => void): Promise<void> {
    // Bounded optimistic contention retries, never a waiting queue for capacity.
    for (let attempt = 0; attempt < 16; attempt++) {
      const snapshot = await this.store.getMetaSnapshot(KEY);
      const now = snapshot.now;
      const state = snapshot.value === null
        ? { used: 0, resetAt: now + this.windowMs, requests: this.requests,
          windowMs: this.windowMs, concurrency: this.concurrency, active: [] }
        : stateSchema.parse(JSON.parse(snapshot.value));
      state.active = state.active.filter(slot => slot.until > now);
      if (now >= state.resetAt) {
        state.used = 0;
        state.resetAt = now + this.windowMs;
        state.requests = this.requests;
        state.windowMs = this.windowMs;
        state.concurrency = this.concurrency;
      }
      // Rolling replicas must not silently establish independent limits.
      if (state.requests !== this.requests || state.windowMs !== this.windowMs ||
          state.concurrency !== this.concurrency) {
        throw new ModelCapacityError('Model limit settings differ across servers.');
      }
      action(state, now);
      if (await this.store.compareMeta(KEY, snapshot.value, JSON.stringify(state), now + 1000)) return;
    }
    throw new ModelCapacityError('Model admission is busy.');
  }

  async acquire(): Promise<ModelAdmission> {
    const token = randomUUID();
    await this.change((state, now) => {
      if (state.used >= this.requests) throw new ModelCapacityError('Model request budget is exhausted.');
      if (state.active.length >= this.concurrency) throw new ModelCapacityError('Model concurrency limit is reached.');
      state.used++;
      state.active.push({ token, until: now + MODEL_SLOT_MS });
    });
    let released = false;
    return {
      release: async () => {
        if (released) return;
        await this.change(state => { state.active = state.active.filter(slot => slot.token !== token); });
        released = true;
      },
      recordAttempt: async () => {
        await this.change((state, now) => {
          const slot = state.active.find(slot => slot.token === token);
          if (released || !slot) throw new ModelCapacityError('Model admission has expired.');
          if (state.used >= this.requests) throw new ModelCapacityError('Model request budget is exhausted.');
          state.used++;
          slot.until = now + MODEL_SLOT_MS;
        });
      },
    };
  }
}
