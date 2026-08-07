import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_DIMENSION = 4096;
const DEFAULT_EDITOR_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'mask-editor');
const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'none'; img-src 'self' blob:; script-src 'self'; style-src 'self'; connect-src 'self'",
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
});

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function assertRegularFileWithin(rootReal, filePath, label) {
  const requestedStats = await lstat(filePath);
  if (requestedStats.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link`);
  const resolved = await realpath(filePath);
  if (!isWithin(rootReal, resolved)) throw new Error(`${label} must stay within the output root`);
  const stats = await lstat(resolved);
  if (!stats.isFile()) throw new Error(`${label} must be an existing regular file`);
  return resolved;
}

async function nearestExistingAncestor(filePath) {
  let current = path.resolve(filePath);
  while (true) {
    try {
      return { requested: current, real: await realpath(current) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

async function assertNewCorrectionPath(correctionsRequested, correctionsReal, filePath, inputs, label) {
  const resolved = path.resolve(filePath);
  if (inputs.some((input) => input === resolved)) throw new Error(`${label} must not equal an input`);
  if (!isWithin(correctionsRequested, resolved)) {
    throw new Error(`${label} must be inside preview${path.sep}corrections`);
  }
  try {
    await lstat(resolved);
    throw new Error(`${label} must not already exist`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const ancestor = await nearestExistingAncestor(resolved);
  if (!isWithin(correctionsReal, ancestor.real)) {
    throw new Error(`${label} symbolic link or junction escape is not allowed`);
  }
}

async function validateOptions(options) {
  if (typeof options?.composeCorrection !== 'function') throw new Error('composeCorrection callback is required');
  const rootRequested = path.resolve(options.root);
  const rootReal = await realpath(rootRequested);
  const inputReal = await assertRegularFileWithin(rootReal, options.input, 'input');
  const candidateReal = await assertRegularFileWithin(rootReal, options.candidate, 'candidate');
  const correctionsRequested = path.join(rootRequested, 'preview', 'corrections');
  const correctionsReal = await realpath(correctionsRequested);
  const inputs = [path.resolve(options.input), path.resolve(options.candidate), inputReal, candidateReal];
  const outputPaths = [options.out, options.mask, options.report].map((file) => path.resolve(file));
  if (new Set(outputPaths.map((file) => process.platform === 'win32' ? file.toLowerCase() : file)).size !== outputPaths.length) {
    throw new Error('out, mask, and report must be distinct paths');
  }
  for (const [label, filePath] of [['out', options.out], ['mask', options.mask], ['report', options.report]]) {
    await assertNewCorrectionPath(correctionsRequested, correctionsReal, filePath, inputs, label);
  }
  if (options.width != null && (!Number.isInteger(options.width) || options.width < 1 || options.width > MAX_DIMENSION)) {
    throw new Error(`width must be an integer from 1 to ${MAX_DIMENSION}`);
  }
  if (options.height != null && (!Number.isInteger(options.height) || options.height < 1 || options.height > MAX_DIMENSION)) {
    throw new Error(`height must be an integer from 1 to ${MAX_DIMENSION}`);
  }
}

function send(response, status, body, contentType = 'application/json; charset=utf-8') {
  response.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': contentType });
  response.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function sendBytes(response, status, body, contentType) {
  response.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': contentType });
  response.end(body);
}

async function readJson(request, maxBytes) {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') return { error: 415 };
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) return { error: 413 };
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBytes) return { error: 413 };
    chunks.push(chunk);
  }
  try {
    return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { error: 400 };
  }
}

export async function startRepairServer(options) {
  await validateOptions(options);
  const token = randomBytes(16).toString('hex');
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  let expectedHost;
  let expectedOrigin;
  let idleTimer;
  let settled = false;
  let resolveCompletion;
  const completion = new Promise((resolve) => { resolveCompletion = resolve; });

  const finish = (result) => {
    if (settled) return;
    settled = true;
    clearTimeout(idleTimer);
    resolveCompletion(result);
  };

  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      finish({ status: 'timeout' });
      server.close();
    }, idleTimeoutMs);
    idleTimer.unref?.();
  };

  const server = createServer(async (request, response) => {
    resetIdleTimer();
    const requestUrl = new URL(request.url ?? '/', expectedOrigin);
    const isApi = requestUrl.pathname.startsWith('/api/');
    if (request.headers.host !== expectedHost) {
      send(response, 403, { error: 'forbidden' });
      return;
    }
    if (isApi) {
      const suppliedToken = requestUrl.searchParams.get('token') ?? request.headers['x-repair-token'];
      const originIsValid = request.headers.origin === expectedOrigin;
      const sameOriginBrowserGet = (request.method === 'GET' || request.method === 'HEAD')
        && request.headers.origin == null
        && request.headers['sec-fetch-site'] === 'same-origin';
      if (suppliedToken !== token || (!originIsValid && !sameOriginBrowserGet)) {
        send(response, 403, { error: 'forbidden' });
        return;
      }
    }

    if (request.method === 'GET' && requestUrl.pathname === '/') {
      if (requestUrl.searchParams.get('token') !== token) {
        send(response, 403, { error: 'forbidden' });
        return;
      }
      sendBytes(response, 200, await readFile(path.join(options.editorRoot ?? DEFAULT_EDITOR_ROOT, 'index.html')), 'text/html; charset=utf-8');
      return;
    }
    const editorAssets = new Map([
      ['/editor.css', ['editor.css', 'text/css; charset=utf-8']],
      ['/editor.js', ['editor.js', 'text/javascript; charset=utf-8']],
    ]);
    if (request.method === 'GET' && editorAssets.has(requestUrl.pathname)) {
      const [filename, contentType] = editorAssets.get(requestUrl.pathname);
      sendBytes(response, 200, await readFile(path.join(options.editorRoot ?? DEFAULT_EDITOR_ROOT, filename)), contentType);
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/session') {
      send(response, 200, {
        status: 'ready',
        width: options.width ?? null,
        height: options.height ?? null,
        key: options.key ?? null,
        attempt: options.attempt ?? null,
      });
      return;
    }
    if (request.method === 'GET' && (requestUrl.pathname === '/api/image/source' || requestUrl.pathname === '/api/image/candidate')) {
      const filePath = requestUrl.pathname.endsWith('/source') ? options.input : options.candidate;
      sendBytes(response, 200, await readFile(filePath), 'image/png');
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/save') {
      if (settled) {
        send(response, 409, { error: 'session_finished' });
        return;
      }
      const parsed = await readJson(request, maxBodyBytes);
      if (parsed.error) {
        send(response, parsed.error, { error: parsed.error === 415 ? 'json_required' : parsed.error === 413 ? 'body_too_large' : 'invalid_json' });
        return;
      }
      try {
        const result = await options.composeCorrection(parsed.value, options);
        send(response, 200, result ?? { status: 'saved' });
        finish({ status: 'saved', result: result ?? null });
        setImmediate(() => server.close());
      } catch {
        send(response, 422, { error: 'correction_failed' });
      }
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/cancel') {
      send(response, 200, { status: 'cancelled' });
      finish({ status: 'cancelled' });
      setImmediate(() => server.close());
      return;
    }
    send(response, 404, { error: 'not_found' });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  expectedHost = `127.0.0.1:${address.port}`;
  expectedOrigin = `http://${expectedHost}`;
  resetIdleTimer();

  const request = ({ method = 'GET', pathname = '/', headers = {}, body = '' } = {}) => new Promise((resolve) => {
    const requestStream = Readable.from(body ? [Buffer.from(body)] : []);
    requestStream.method = method;
    requestStream.url = pathname;
    requestStream.headers = Object.fromEntries(Object.entries({ host: expectedHost, ...headers }).map(([key, value]) => [key.toLowerCase(), value]));
    const response = {
      statusCode: 200,
      headers: {},
      writeHead(statusCode, responseHeaders) {
        this.statusCode = statusCode;
        this.headers = Object.fromEntries(Object.entries(responseHeaders).map(([key, value]) => [key.toLowerCase(), String(value)]));
      },
      end(responseBody = '') {
        resolve({ status: this.statusCode, headers: this.headers, body: String(responseBody) });
      },
    };
    server.emit('request', requestStream, response);
  });

  return {
    url: `${expectedOrigin}/?token=${token}`,
    completion,
    request,
    close: async () => {
      finish({ status: 'closed' });
      if (!server.listening) return;
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
