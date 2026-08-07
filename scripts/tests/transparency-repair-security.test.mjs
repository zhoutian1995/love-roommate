import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { startRepairServer } from '../lib/transparency-repair-server.mjs';

async function fixtureOptions(overrides = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'love-roommate-repair-'));
  const input = path.join(root, 'preview', 'source.png');
  const candidate = path.join(root, 'preview', 'candidate.png');
  const out = path.join(root, 'preview', 'corrections', 'corrected.png');
  const mask = path.join(root, 'preview', 'corrections', 'mask.png');
  const report = path.join(root, 'preview', 'corrections', 'report.json');
  await mkdir(path.dirname(input), { recursive: true });
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(input, 'source');
  await writeFile(candidate, 'candidate');
  return {
    root,
    input,
    candidate,
    out,
    mask,
    report,
    idleTimeoutMs: 5_000,
    composeCorrection: async () => ({ status: 'saved' }),
    ...overrides,
  };
}

function auth(server, pathname = '/api/session', init = {}) {
  const base = new URL(server.url);
  const url = new URL(pathname, base);
  url.searchParams.set('token', base.searchParams.get('token'));
  return server.request({
    method: init.method,
    pathname: `${url.pathname}${url.search}`,
    body: init.body,
    headers: {
      origin: base.origin,
      ...(init.headers ?? {}),
    },
  });
}

test('server binds loopback, emits security headers, and rejects unauthenticated API calls', async (t) => {
  const server = await startRepairServer(await fixtureOptions());
  t.after(server.close);
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/\?token=[a-f0-9]{32}$/);

  const response = await server.request({ method: 'POST', pathname: '/api/save' });
  assert.equal(response.status, 403);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.equal(response.headers['content-security-policy'], "default-src 'none'; img-src 'self' blob:; script-src 'self'; style-src 'self'; connect-src 'self'");
});

test('server rejects a forged Host and cross-origin request', async (t) => {
  const server = await startRepairServer(await fixtureOptions());
  t.after(server.close);
  const base = new URL(server.url);
  const token = base.searchParams.get('token');

  const badHost = await server.request({
    pathname: `/api/session?token=${token}`,
    headers: { host: 'localhost:1', origin: base.origin },
  });
  assert.equal(badHost.status, 403);

  const badOrigin = await server.request({
    pathname: `/api/session?token=${token}`,
    headers: { origin: 'http://evil.invalid' },
  });
  assert.equal(badOrigin.status, 403);

  const browserGet = await server.request({
    pathname: `/api/session?token=${token}`,
    headers: { 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(browserGet.status, 200);

  const missingBrowserProof = await server.request({ pathname: `/api/session?token=${token}` });
  assert.equal(missingBrowserProof.status, 403);
});

test('save requires JSON and enforces the configured request body limit', async (t) => {
  const server = await startRepairServer(await fixtureOptions({ maxBodyBytes: 32 }));
  t.after(server.close);

  const wrongType = await auth(server, '/api/save', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{}',
  });
  assert.equal(wrongType.status, 415);

  const tooLarge = await auth(server, '/api/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ edits: ['x'.repeat(64)] }),
  });
  assert.equal(tooLarge.status, 413);
});

test('authenticated image routes expose only the configured source and candidate', async (t) => {
  const server = await startRepairServer(await fixtureOptions());
  t.after(server.close);
  const source = await auth(server, '/api/image/source');
  const candidate = await auth(server, '/api/image/candidate');
  const unknown = await auth(server, '/api/image/other');
  assert.equal(source.status, 200);
  assert.equal(source.body, 'source');
  assert.equal(source.headers['content-type'], 'image/png');
  assert.equal(candidate.status, 200);
  assert.equal(candidate.body, 'candidate');
  assert.equal(unknown.status, 404);
});

test('editor shell requires the session token and serves only fixed local assets', async (t) => {
  const server = await startRepairServer(await fixtureOptions());
  t.after(server.close);
  const base = new URL(server.url);
  const denied = await server.request({ pathname: '/' });
  const page = await server.request({ pathname: `/?token=${base.searchParams.get('token')}` });
  const script = await server.request({ pathname: '/editor.js' });
  const traversal = await server.request({ pathname: '/../../SKILL.md' });
  assert.equal(denied.status, 403);
  assert.equal(page.status, 200);
  assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(page.body, /editor\.js/);
  assert.equal(script.status, 200);
  assert.equal(script.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(traversal.status, 404);
});

test('authenticated save delegates composition once and resolves completion', async () => {
  const calls = [];
  const server = await startRepairServer(await fixtureOptions({
    composeCorrection: async (payload) => {
      calls.push(payload);
      return { status: 'saved', output: 'preview/corrections/corrected.png' };
    },
  }));
  const payload = { edits: [{ mode: 'erase', x: 1, y: 2, radius: 3, hardness: 1 }] };
  const response = await auth(server, '/api/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [payload]);
  assert.deepEqual(await server.completion, {
    status: 'saved',
    result: { status: 'saved', output: 'preview/corrections/corrected.png' },
  });
  const duplicate = await auth(server, '/api/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(duplicate.status, 409);
  assert.equal(calls.length, 1);
});

test('startup rejects output traversal, an existing output, and an input/output collision', async () => {
  const base = await fixtureOptions();
  await assert.rejects(
    startRepairServer({ ...base, out: path.join(base.root, 'outside.png') }),
    /preview[\\/]corrections/,
  );
  await writeFile(base.out, 'occupied');
  await assert.rejects(startRepairServer(base), /must not already exist/);
  await assert.rejects(
    startRepairServer({ ...base, out: base.input }),
    /must not equal an input/,
  );
  const distinct = await fixtureOptions();
  await assert.rejects(
    startRepairServer({ ...distinct, mask: distinct.out }),
    /must be distinct/,
  );
});

test('startup rejects symbolic-link escape paths', async (t) => {
  const base = await fixtureOptions();
  const outside = await mkdtemp(path.join(tmpdir(), 'love-roommate-outside-'));
  const link = path.join(base.root, 'preview', 'corrections', 'linked');
  try {
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('当前环境不允许创建符号链接或目录联接');
      return;
    }
    throw error;
  }
  await assert.rejects(
    startRepairServer({ ...base, out: path.join(link, 'escaped.png') }),
    /symbolic link|junction|escape/i,
  );
});

test('startup rejects a symbolic-link input even when its target stays inside the root', async (t) => {
  const base = await fixtureOptions();
  const linkedInput = path.join(base.root, 'preview', 'linked-source.png');
  try {
    await symlink(base.input, linkedInput, 'file');
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('当前环境不允许创建文件符号链接');
      return;
    }
    throw error;
  }
  await assert.rejects(
    startRepairServer({ ...base, input: linkedInput }),
    /symbolic link/i,
  );
});

test('idle timeout closes the server and resolves completion', async () => {
  const server = await startRepairServer(await fixtureOptions({ idleTimeoutMs: 25 }));
  const completion = await server.completion;
  assert.deepEqual(completion, { status: 'timeout' });
});
