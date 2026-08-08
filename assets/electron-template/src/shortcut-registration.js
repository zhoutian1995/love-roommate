'use strict';

function registerShortcutWithFallback({ primary, fallback, callback, register, warn = () => {} }) {
  if (primary && fallback && primary === fallback) throw new Error('Shortcut fallback must be distinct from the primary accelerator.');
  if (typeof callback !== 'function') throw new Error('Shortcut callback must be a function.');
  if (typeof register !== 'function') throw new Error('Shortcut register must be a function.');

  if (primary && register(primary, callback)) return primary;
  if (fallback && register(fallback, callback)) {
    warn(`Global shortcut unavailable: ${primary || '(none)'}; using fallback: ${fallback}`);
    return fallback;
  }
  warn(`Global shortcuts unavailable: ${[primary, fallback].filter(Boolean).join(', ') || '(none)'}`);
  return null;
}

module.exports = { registerShortcutWithFallback };
