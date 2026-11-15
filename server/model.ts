// Minimal client for any OpenAI-compatible chat completions endpoint.
// Works with Replit AI Integrations (AI_INTEGRATIONS_OPENAI_*), OpenAI, or Gemini's OpenAI-compatible endpoint.

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type ChatMessage = { role: 'system' | 'user'; content: string | ContentPart[] };

const apiKey = process.env.MODEL_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? '';
const baseUrl = (process.env.MODEL_BASE_URL ?? process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
const modelName = process.env.MODEL_NAME ?? 'gpt-4o-mini';
const TIMEOUT_MS = 45_000;

export const modelConfigured = Boolean(apiKey);

export class ModelUnavailableError extends Error {}

// Returns parsed JSON from the model. Callers must validate the shape.
export async function completeJson(messages: ChatMessage[], maxTokens = 1500): Promise<unknown> {
  if (!modelConfigured) throw new ModelUnavailableError('Model is not configured.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
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
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new ModelUnavailableError(`Model request failed (${response.status}): ${detail}`);
    }
    const body = await response.json() as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content ?? '';
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch (error) {
    if (error instanceof ModelUnavailableError) throw error;
    throw new ModelUnavailableError(error instanceof Error ? error.message : 'Model request failed.');
  } finally {
    clearTimeout(timer);
  }
}
