'use strict';

const sprite = document.getElementById('sprite');
const bubble = document.getElementById('bubble');
const effect = document.getElementById('effect');
const canvas = document.getElementById('hit-canvas');
const context = canvas.getContext('2d', { willReadFrequently: true });

let bootstrap;
let currentState;
let currentFramePath = '';
let interactive = false;
let dragging = false;
let suppressContextMenuUntil = 0;
const hitSlopPx = 6;

function assetUrl(path) {
  return new URL(`../assets/${path}`, window.location.href).href;
}

function chooseFrame(state) {
  const frames = bootstrap.sprite.frames[state.action] || bootstrap.sprite.frames.idle_right;
  return frames[Math.floor(state.frame) % frames.length];
}

function redrawHitCanvas() {
  if (!sprite.naturalWidth || !sprite.naturalHeight) return;
  canvas.width = sprite.naturalWidth;
  canvas.height = sprite.naturalHeight;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(sprite, 0, 0, canvas.width, canvas.height);
}

function updateState(state) {
  currentState = state;
  const path = chooseFrame(state);
  if (path !== currentFramePath) {
    currentFramePath = path;
    sprite.src = assetUrl(`sprites/${path}`);
    sprite.classList.toggle('placeholder-left', path.endsWith('placeholder.svg') && state.direction === 'left');
  }
  bubble.textContent = state.phrase || '';
  bubble.classList.toggle('visible', Boolean(state.phrase));
  document.documentElement.style.setProperty('--effect-size', `${state.effectSize || bootstrap.config.render.effectSize}px`);
  if (state.effect) {
    effect.src = assetUrl(`effects/${state.effect}.svg`);
    effect.classList.add('visible');
  } else {
    effect.classList.remove('visible');
  }
}

function isOpaqueAt(clientX, clientY) {
  const rect = sprite.getBoundingClientRect();
  if (
    clientX < rect.left - hitSlopPx || clientX > rect.right + hitSlopPx ||
    clientY < rect.top - hitSlopPx || clientY > rect.bottom + hitSlopPx
  ) return false;
  if (!canvas.width || !canvas.height) return true;
  const x = Math.max(0, Math.min(canvas.width - 1, Math.floor((clientX - rect.left) / rect.width * canvas.width)));
  const y = Math.max(0, Math.min(canvas.height - 1, Math.floor((clientY - rect.top) / rect.height * canvas.height)));
  const radiusX = Math.max(1, Math.ceil(hitSlopPx / rect.width * canvas.width));
  const radiusY = Math.max(1, Math.ceil(hitSlopPx / rect.height * canvas.height));
  const left = Math.max(0, x - radiusX);
  const top = Math.max(0, y - radiusY);
  const width = Math.min(canvas.width - left, radiusX * 2 + 1);
  const height = Math.min(canvas.height - top, radiusY * 2 + 1);
  const pixels = context.getImageData(left, top, width, height).data;
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 28) return true;
  return false;
}

function setInteractive(next) {
  if (interactive === next) return;
  interactive = next;
  window.petApi.setInteractive(next);
}

sprite.addEventListener('load', redrawHitCanvas);
window.addEventListener('mousemove', (event) => setInteractive(dragging || isOpaqueAt(event.clientX, event.clientY)));
window.addEventListener('mouseleave', () => setInteractive(dragging));
window.addEventListener('blur', () => {
  dragging = false;
  window.petApi.endDrag();
  setInteractive(false);
});
window.addEventListener('pointerdown', (event) => {
  if (!isOpaqueAt(event.clientX, event.clientY)) return;
  if (event.button === 2) {
    suppressContextMenuUntil = performance.now() + 500;
    window.petApi.openContextMenu();
    event.preventDefault();
    return;
  }
  if (event.button !== 0) return;
  dragging = true;
  sprite.setPointerCapture?.(event.pointerId);
  window.petApi.startDrag();
  event.preventDefault();
});
window.addEventListener('pointerup', (event) => {
  if (!dragging) return;
  dragging = false;
  sprite.releasePointerCapture?.(event.pointerId);
  window.petApi.endDrag();
  setInteractive(isOpaqueAt(event.clientX, event.clientY));
});
window.addEventListener('contextmenu', (event) => {
  if (performance.now() < suppressContextMenuUntil) {
    event.preventDefault();
    return;
  }
  if (!isOpaqueAt(event.clientX, event.clientY)) return;
  event.preventDefault();
  window.petApi.openContextMenu();
});

(async () => {
  bootstrap = await window.petApi.getBootstrap();
  document.documentElement.style.setProperty('--sprite-size', `${bootstrap.config.render.spriteSize}px`);
  document.documentElement.style.setProperty('--effect-size', `${bootstrap.config.render.effectSize}px`);
  document.documentElement.style.setProperty('--hue-rotate', `${bootstrap.character.hueRotate || 0}deg`);
  window.petApi.onState(updateState);
})();
