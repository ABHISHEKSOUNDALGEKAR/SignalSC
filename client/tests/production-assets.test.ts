/** Run after build + PORT=3002 npm start. Deliberately outside the unit-test glob. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:3002';

test('npm start serves the manifest, PNG icons and hashed client resources with correct types', async () => {
  const page = await fetch(base);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/);
  const response = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /application\/manifest\+json/);
  const manifest = await response.json();
  for (const icon of [...manifest.icons, { src: '/icons/apple-touch-icon.png', sizes: '180x180' }]) {
    const image = await fetch(base + icon.src);
    assert.equal(image.status, 200);
    assert.match(image.headers.get('content-type')!, /image\/png/);
    const bytes = Buffer.from(await image.arrayBuffer());
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
  }
  for (const asset of html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)) {
    const result = await fetch(base + asset[1]);
    assert.equal(result.status, 200);
    assert.match(result.headers.get('content-type')!, asset[1].endsWith('.css') ? /text\/css/ : /(?:application|text)\/javascript/);
  }
  const start = await fetch(base + manifest.start_url);
  assert.equal(start.status, 200);
  assert.match(await start.text(), /id="root"/);
});
