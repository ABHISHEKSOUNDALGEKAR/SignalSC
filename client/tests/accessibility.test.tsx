import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyState, ErrorState } from '../src/components/States';

const publicFile = (path: string) => readFileSync(new URL(`../public/${path}`, import.meta.url));

test('linked manifest declares same-origin start, scope, appearance and real PNG icons', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(index, /rel="manifest" href="\/manifest.webmanifest"/);
  const manifest = JSON.parse(publicFile('manifest.webmanifest').toString());
  assert.equal(manifest.name, 'Trojan Signal');
  assert.ok(manifest.short_name.length <= 12);
  assert.equal(manifest.start_url, '/#discover');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#990000');
  assert.equal(manifest.background_color, '#faf7f1');
  assert.ok(manifest.icons.some((icon: { sizes: string; purpose: string }) => icon.sizes === '512x512' && icon.purpose === 'maskable'));
  for (const icon of manifest.icons) {
    const bytes = publicFile(icon.src.slice(1));
    assert.equal(icon.type, 'image/png');
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
  }
});

function luminance(hex: string) {
  const rgb = hex.match(/\w\w/g)!.map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
}
function contrast(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + .05) / (dark + .05);
}
test('text palette exceeds 4.5:1 and focus/input boundaries exceed 3:1', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  for (const color of ['#28231f', '#685f55', '#990000', '#725100', '#966200', '#84796c']) assert.ok(css.includes(color));
  for (const [foreground, backgrounds] of [
    ['#28231f', ['#ffffff', '#faf7f1', '#fff2c6']],
    ['#685f55', ['#ffffff', '#faf7f1', '#fff2c6']],
    ['#990000', ['#ffffff', '#faf7f1', '#fff2c6']],
    ['#725100', ['#fff2c6']], ['#ffffff', ['#990000', '#760000']],
  ] as const) for (const background of backgrounds) assert.ok(contrast(foreground, background) >= 4.5, `${foreground} on ${background}`);
  for (const color of ['#966200', '#84796c']) for (const background of ['#ffffff', '#faf7f1', '#fff2c6']) assert.ok(contrast(color, background) >= 3);
});

test('standalone detail states use a second-level heading and retain recovery semantics', () => {
  assert.match(renderToStaticMarkup(<EmptyState headingLevel={2} title="Unavailable">Return to browsing</EmptyState>), /<h2>Unavailable<\/h2>/);
  const html = renderToStaticMarkup(<ErrorState headingLevel={2} error={new Error()} onRetry={() => {}} />);
  assert.match(html, /role="alert"><h2>/);
  assert.match(html, />Try again<\/button>/);
});
