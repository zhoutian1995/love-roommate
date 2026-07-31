'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

function trustedFileUrl(file) {
  return pathToFileURL(path.resolve(file)).href;
}

function isTrustedLocalUrl(actualUrl, expectedFile) {
  if (typeof actualUrl !== 'string' || !actualUrl) return false;
  try {
    const actual = new URL(actualUrl);
    actual.search = '';
    actual.hash = '';
    return actual.protocol === 'file:' && actual.href === trustedFileUrl(expectedFile);
  } catch {
    return false;
  }
}

function authorizePetEvent(event, petWindows, expectedFile) {
  if (!event?.sender || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) return null;
  if (!isTrustedLocalUrl(event.senderFrame.url, expectedFile)) return null;
  for (const [id, entry] of petWindows) {
    if (entry?.win?.webContents === event.sender && !entry.win.isDestroyed()) return { id, entry };
  }
  return null;
}

function hardenWebContents(webContents, expectedFile) {
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const blockUnexpectedNavigation = (event, url) => {
    if (!isTrustedLocalUrl(url, expectedFile)) event.preventDefault();
  };
  webContents.on('will-navigate', blockUnexpectedNavigation);
  webContents.on('will-frame-navigate', blockUnexpectedNavigation);
}

function denySessionPermissions(targetSession) {
  targetSession.setPermissionCheckHandler(() => false);
  targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
}

module.exports = {
  authorizePetEvent,
  denySessionPermissions,
  hardenWebContents,
  isTrustedLocalUrl,
  trustedFileUrl
};
