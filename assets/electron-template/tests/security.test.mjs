import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  authorizePetEvent,
  denySessionPermissions,
  hardenWebContents,
  isTrustedLocalUrl,
  trustedFileUrl
} = require('../src/security');

test('trusted URL validation accepts only the expected local file', () => {
  const expected = path.join(root, 'src', 'renderer', 'index.html');
  assert.equal(isTrustedLocalUrl(trustedFileUrl(expected), expected), true);
  assert.equal(isTrustedLocalUrl(`${trustedFileUrl(expected)}?id=person-9`, expected), true);
  assert.equal(isTrustedLocalUrl('https://example.com/index.html', expected), false);
  assert.equal(isTrustedLocalUrl('data:text/html,hello', expected), false);
  assert.equal(isTrustedLocalUrl('javascript:alert(1)', expected), false);
  assert.equal(isTrustedLocalUrl(trustedFileUrl(path.join(root, 'src', 'renderer', 'effect.html')), expected), false);
});

test('pet authorization binds identity to trusted main-frame WebContents', () => {
  const expected = path.join(root, 'src', 'renderer', 'index.html');
  const sender = { id: 12 };
  sender.mainFrame = { url: trustedFileUrl(expected) };
  const win = { webContents: sender, isDestroyed: () => false };
  const windows = new Map([['person-2', { win, interactive: false }]]);
  const event = { sender, senderFrame: sender.mainFrame };
  assert.equal(authorizePetEvent(event, windows, expected).id, 'person-2');
  assert.equal(authorizePetEvent({ sender, senderFrame: { url: sender.mainFrame.url } }, windows, expected), null);
  sender.mainFrame.url = 'https://example.com/';
  assert.equal(authorizePetEvent(event, windows, expected), null);
  sender.mainFrame.url = trustedFileUrl(expected);
  assert.equal(authorizePetEvent(event, new Map(), expected), null);
});

test('window hardening denies popups and unexpected navigation', () => {
  const expected = path.join(root, 'src', 'renderer', 'index.html');
  const webContents = new EventEmitter();
  let openHandler;
  webContents.setWindowOpenHandler = (handler) => { openHandler = handler; };
  hardenWebContents(webContents, expected);
  assert.deepEqual(openHandler({ url: 'https://example.com' }), { action: 'deny' });

  let prevented = false;
  webContents.emit('will-navigate', { preventDefault: () => { prevented = true; } }, 'https://example.com');
  assert.equal(prevented, true);
  prevented = false;
  webContents.emit('will-frame-navigate', { preventDefault: () => { prevented = true; } }, trustedFileUrl(expected));
  assert.equal(prevented, false);
});

test('session permission handlers deny every request', () => {
  let checkHandler;
  let requestHandler;
  const targetSession = {
    setPermissionCheckHandler: (handler) => { checkHandler = handler; },
    setPermissionRequestHandler: (handler) => { requestHandler = handler; }
  };
  denySessionPermissions(targetSession);
  assert.equal(checkHandler(null, 'camera'), false);
  let granted = true;
  requestHandler(null, 'notifications', (value) => { granted = value; });
  assert.equal(granted, false);
});

test('renderer pages use restrictive CSP and effect code is external', () => {
  const index = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const effect = fs.readFileSync(path.join(root, 'src', 'renderer', 'effect.html'), 'utf8');
  assert.match(index, /Content-Security-Policy/);
  assert.match(effect, /Content-Security-Policy/);
  assert.match(effect, /effect\.js/);
  assert.doesNotMatch(effect, /<script>[^<]/);
});
