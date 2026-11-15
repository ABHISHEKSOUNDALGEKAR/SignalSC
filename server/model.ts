// Minimal client for any OpenAI-compatible chat completions endpoint.
// Works with Replit AI Integrations (AI_INTEGRATIONS_OPENAI_*), OpenAI, or Gemini's OpenAI-compatible endpoint.
import { ModelBudget, ModelCapacityError, readModelLimit } from './model-budget';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createStore } from './store';
import { SharedModelBudget, type ModelAdmission } from './shared-model-budget';

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type ChatMessage = { role: 'system' | 'user'; content: string | ContentPart[] };

const apiKey = process.env.MODEL_API_KEY?.trim() || process.env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim() || '';
const baseUrl = (process.env.MODEL_BASE_URL ?? process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
const modelName = process.env.MODEL_NAME ?? 'gpt-4o-mini';
const TIMEOUT_MS = 45_000;

export const modelConfigured = Boolean(apiKey);

export class ModelUnavailableError extends Error {}

export class ModelLimitError extends ModelUnavailableError {}

const limits = [
  readModelLimit('MODEL_REQUEST_BUDGET', 120, 0),
  readModelLimit('MODEL_BUDGET_WINDOW_MS', 3_600_000, 1),
  readModelLimit('MODEL_MAX_CONCURRENT', 4, 1),
] as const;
// No persistent fallback if PostgreSQL fails: no coordinated reservation means
// no paid call. Only database-free development/tests use the local gate.
const budget = new ModelBudget(...limits);
const sharedBudget = process.env.DATABASE_URL ? new SharedModelBudget(createStore(), ...limits) : null;
const admissionContext = new AsyncLocalStorage<ModelAdmission>();

export async function reserveModelRetryAttempt(): Promise<void> {
  try {
    const admission = admissionContext.getStore();
    if (!admission) throw new ModelCapacityError('No active model admission.');
    await admission.recordAttempt();
  }
  catch (error) {
    if (error instanceof ModelCapacityError) throw new ModelLimitError(error.message);
    throw new ModelUnavailableError('Model admission is unavailable.');
  }
}

// Returns parsed JSON from the model. Callers must validate the shape.
export async function completeJson(
  messages: ChatMessage[], maxTokens = 1500, beforeAttempt?: () => Promise<void>,
): Promise<unknown> {
  if (!modelConfigured) throw new ModelUnavailableError('Model is not configured.');
  let admission: ModelAdmission;
  try {
    if (sharedBudget) admission = await sharedBudget.acquire();
    else {
      const release = budget.acquire();
      admission = { release: async () => release(), recordAttempt: async () => budget.recordAttempt() };
    }
  }
  catch (error) {
    if (error instanceof ModelCapacityError) throw new ModelLimitError(error.message);
    throw new ModelUnavailableError('Model admission is unavailable.');
  }
  return admissionContext.run(admission, async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    if (beforeAttempt) await beforeAttempt();
    if (controller.signal.aborted) throw new ModelUnavailableError('Model request timed out.');
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelName,
        messages,
        temperature: 0,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        // Nemotron Omni reasons by default, consuming the small JSON-only output
        // budgets before producing an answer. Its documented instruct mode
        // disables this without changing requests to other compatible models.
        ...(modelName === 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'
          ? { chat_template_kwargs: { enable_thinking: false } }
          : {}),
      }),
    });
    if (!response.ok) {
      // Provider bodies can echo credentials or flyer text. Do not put them in logs.
      throw new ModelUnavailableError(`Model request failed (HTTP ${response.status}). Check provider access, credits, and availability.`);
    }
    const body = await response.json() as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content ?? '';
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch (error) {
    if (error instanceof ModelUnavailableError) throw error;
    throw new ModelUnavailableError(controller.signal.aborted
      ? 'Model request timed out.'
      : 'Model returned an invalid response or could not be reached.');
  } finally {
    clearTimeout(timer);
    try { await admission.release(); }
    catch { console.warn('Model admission release unavailable; slot will expire.'); }
  }
  });
}
