export const MODEL_OPERATION_EVENTS = [
  'admission_request_budget_exhausted',
  'admission_concurrency_limit_reached',
  'admission_replica_settings_mismatch',
  'admission_coordination_contention',
  'admission_coordination_unavailable',
  'admission_slot_expired',
  'model_unconfigured',
  'model_admission_rejected',
  'model_admission_unavailable',
  'model_provider_http_failure',
  'model_provider_timeout',
  'model_response_invalid_or_unreachable',
  'model_request_failed',
  'model_slot_release_unavailable',
] as const;

export type ModelOperationEvent = typeof MODEL_OPERATION_EVENTS[number];

const counters: Record<ModelOperationEvent, number> = Object.fromEntries(
  MODEL_OPERATION_EVENTS.map(event => [event, 0]),
) as Record<ModelOperationEvent, number>;

// Events contain only fixed labels. Never pass request, provider, or exception data here.
export function recordModelOperation(event: ModelOperationEvent, count = 1): void {
  counters[event] += count;
  console.warn(JSON.stringify({ type: 'model_operational', event }));
}

// Internal server diagnostics only; no route or public response exposes this snapshot.
export function getModelOperationCounters(): Readonly<Record<ModelOperationEvent, number>> {
  return { ...counters };
}
