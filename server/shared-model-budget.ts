import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CoordinationStore } from './store';
import { ModelCapacityError } from './model-budget';
import { recordModelOperation } from './model-operations';

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
    let expiredSlotsObserved = 0;
    let expiredSlotsReported = false;
    const reportExpiredSlots = () => {
      if (!expiredSlotsObserved || expiredSlotsReported) return;
      recordModelOperation('admission_slot_expired', expiredSlotsObserved);
      expiredSlotsReported = true;
    };
    try {
      // Bounded optimistic contention retries, never a waiting queue for capacity.
      for (let attempt = 0; attempt < 16; attempt++) {
        const snapshot = await this.store.getMetaSnapshot(KEY);
        const now = snapshot.now;
        const state = snapshot.value === null
          ? { used: 0, resetAt: now + this.windowMs, requests: this.requests,
            windowMs: this.windowMs, concurrency: this.concurrency, active: [] }
          : stateSchema.parse(JSON.parse(snapshot.value));
        const retainedSlots = state.active.filter(slot => slot.until > now);
        const expiredSlots = state.active.length - retainedSlots.length;
        expiredSlotsObserved = Math.max(expiredSlotsObserved, expiredSlots);
        state.active = retainedSlots;
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
          throw new ModelCapacityError('Model limit settings differ across servers.', 'replica_settings_mismatch');
        }
        action(state, now);
        if (await this.store.compareMeta(KEY, snapshot.value, JSON.stringify(state), now + 1000)) {
          reportExpiredSlots();
          return;
        }
      }
      throw new ModelCapacityError('Model admission is busy.', 'coordination_contention');
    } catch (error) {
      reportExpiredSlots();
      if (error instanceof ModelCapacityError) {
        // Filtering an expired token already reported the same slot above.
        if (error.reason === 'slot_expired' && expiredSlotsObserved) throw error;
        const event = {
          request_budget_exhausted: 'admission_request_budget_exhausted',
          concurrency_limit_reached: 'admission_concurrency_limit_reached',
          replica_settings_mismatch: 'admission_replica_settings_mismatch',
          coordination_contention: 'admission_coordination_contention',
          slot_expired: 'admission_slot_expired',
          no_active_admission: 'admission_coordination_unavailable',
        } as const;
        recordModelOperation(event[error.reason]);
      } else {
        // Error messages may include infrastructure details; emit no exception data.
        recordModelOperation('admission_coordination_unavailable');
      }
      throw error;
    }
  }

  async acquire(): Promise<ModelAdmission> {
    const token = randomUUID();
    await this.change((state, now) => {
      if (state.used >= this.requests) {
        throw new ModelCapacityError('Model request budget is exhausted.', 'request_budget_exhausted');
      }
      if (state.active.length >= this.concurrency) {
        throw new ModelCapacityError('Model concurrency limit is reached.', 'concurrency_limit_reached');
      }
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
          if (released || !slot) {
            throw new ModelCapacityError('Model admission has expired.', 'slot_expired');
          }
          if (state.used >= this.requests) {
            throw new ModelCapacityError('Model request budget is exhausted.', 'request_budget_exhausted');
          }
          state.used++;
          slot.until = now + MODEL_SLOT_MS;
        });
      },
    };
  }
}
