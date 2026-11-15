import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

// Each import happens in a fresh process with an allowlisted environment.
// Never inherit real credentials or connect to the application database.
function run(source: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 15_000,
    env: { PATH: process.env.PATH, NODE_ENV: 'test', ...env },
  });
}

const authImport = "await import('./server/auth.ts')";
const codes = 'Private Test A=fixture-code-a;Private Test B=fixture-code-b';
const production = { NODE_ENV: 'production', ORGANIZER_ACCESS_CODES: codes, SESSION_SECRET: 'isolated-production-test-secret' };

test('missing development codes disable sign-in, including former demos', () => {
  const result = run(`
    import assert from 'node:assert/strict';
    const { findOrganizationByCode } = await import('./server/auth.ts');
    for (const code of ['demo-a', 'demo-b', 'fixture-code-a']) assert.equal(findOrganizationByCode(code), null);
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /sign-in is disabled/);
});

test('production requires organizer codes under both production indicators', () => {
  for (const env of [
    { NODE_ENV: 'production' },
    { NODE_ENV: 'development', REPLIT_DEPLOYMENT: '1' },
  ]) {
    for (const value of [undefined, '', '   ', '; ;']) {
      const result = run(authImport, {
        ...env, SESSION_SECRET: 'isolated-test-secret',
        ...(value === undefined ? {} : { ORGANIZER_ACCESS_CODES: value }),
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /ORGANIZER_ACCESS_CODES/);
    }
  }
});

test('invalid, demo, duplicate code, and colliding organization settings fail without leaking values', () => {
  for (const value of [
    'malformed-private-value', '=private-value', 'Name=', 'Name=' + 'x'.repeat(201),
    'Name=demo-a', 'Name=demo-b',
    'Alpha=private-value;Beta=private-value',
    'Alpha Beta=private-value;Alpha-Beta=other-private-value',
    'Valid=private-value;malformed',
  ]) {
    const result = run(authImport, { ...production, ORGANIZER_ACCESS_CODES: value });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stderr, /private-value|malformed-private-value/);
  }
});

test('production requires a session secret and persistent storage', () => {
  const missingSecret = run(authImport, { NODE_ENV: 'production', ORGANIZER_ACCESS_CODES: codes });
  assert.notEqual(missingSecret.status, 0);
  assert.match(missingSecret.stderr, /SESSION_SECRET is required in production/);
  for (const env of [{ NODE_ENV: 'production' }, { REPLIT_DEPLOYMENT: '1' }]) {
    const missingDatabase = run("const { createStore } = await import('./server/store.ts'); createStore();", env);
    assert.notEqual(missingDatabase.status, 0);
    assert.match(missingDatabase.stderr, /DATABASE_URL is required in production/);
  }
});

test('configured production codes issue secure signed cookies and reject a forged organization', () => {
  const result = run(`
    import assert from 'node:assert/strict';
    const { findOrganizationByCode, setSessionCookie, getSession } = await import('./server/auth.ts');
    const org = findOrganizationByCode('fixture-code-a');
    assert.equal(org.id, 'private-test-a');
    assert.equal(findOrganizationByCode('fixture-code-b').id, 'private-test-b');
    assert.equal(findOrganizationByCode('demo-a'), null);
    assert.equal(findOrganizationByCode('wrong'), null);
    let cookie;
    setSessionCookie({ cookie(name, value, options) {
      assert.equal(options.secure, true);
      assert.equal(options.httpOnly, true);
      assert.equal(options.sameSite, 'lax');
      cookie = name + '=' + value;
    } }, org);
    assert.deepEqual(getSession({ headers: { cookie } }), {
      organizationId: 'private-test-a', organizationName: 'Private Test A',
    });
    assert.equal(getSession({ headers: { cookie: cookie.replace('private-test-a', 'private-test-b') } }), null);
  `, production);
  assert.equal(result.status, 0, result.stderr);
});
