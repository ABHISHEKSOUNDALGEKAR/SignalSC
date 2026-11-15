import assert from 'node:assert/strict';
import { test } from 'node:test';
delete process.env.MODEL_API_KEY;
delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const {completeJson, modelConfigured, ModelUnavailableError} = await import('../server/model');
const {extractDraft} = await import('../server/extract');
const {search} = await import('../server/search');

test('without credentials, extraction is explicitly manual and direct model calls fail', async () => {
  assert.equal(modelConfigured, false);
  globalThis.fetch = async () => { throw new Error('Must not call a provider'); };
  await assert.rejects(completeJson([]), ModelUnavailableError);
  const result = await extractDraft({text:'Original announcement'});
  assert.equal(result.extractedBy, 'manual');
  assert.equal(result.draft.description, 'Original announcement');
  assert.equal(result.draft.startsAt, null);
  assert.match(result.draft.uncertainties.join(' '), /not available/);
});

test('unconfigured search uses rules and returns truthful empty results', async () => {
  const result = await search('free beginner events with food tonight after 5', [], new Date('2026-11-14T18:00:00Z'));
  assert.equal(result.interpretedBy, 'rules');
  assert.equal(result.constraints.freeOnly, true);
  assert.equal(result.constraints.foodAdvertisedOnly, true);
  assert.equal(result.constraints.beginnerOnly, true);
  assert.equal(result.constraints.afterMinutes, 1020);
  assert.equal(result.noMatch, true);
});
