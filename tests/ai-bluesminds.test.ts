import assert from 'node:assert/strict';
import { test } from 'node:test';

// Isolated adapter check, not a live-provider test.
process.env.MODEL_API_KEY = 'test-only-not-a-credential';
process.env.MODEL_BASE_URL = 'https://model.test/v1';
process.env.MODEL_NAME = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
const { completeJson } = await import('../server/model');

test('Nemotron Omni uses documented instruct mode within JSON output budgets', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
      assert.equal(body.max_tokens, 400);
      assert.deepEqual(body.response_format, { type: 'json_object' });
      return Response.json({ choices: [{ message: { content: '{"status":"ok"}' } }] });
    };
    assert.deepEqual(await completeJson([{ role: 'user', content: 'Return status as JSON.' }], 400), { status: 'ok' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
