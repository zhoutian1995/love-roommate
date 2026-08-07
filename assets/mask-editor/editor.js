(() => {
  'use strict';

  const canvas = document.querySelector('#editor-canvas');
  const viewport = document.querySelector('#viewport');
  const context = canvas.getContext('2d', { willReadFrequently: false });
  const restoreBrush = document.createElement('canvas');
  const restoreContext = restoreBrush.getContext('2d');
  const status = document.querySelector('#status');
  const loading = document.querySelector('#loading');
  const strokeSummary = document.querySelector('#stroke-summary');
  const undoButton = document.querySelector('#undo');
  const redoButton = document.querySelector('#redo');
  const resetButton = document.querySelector('#reset');
  const zoomSelect = document.querySelector('#zoom');
  const radiusInput = document.querySelector('#radius');
  const hardnessInput = document.querySelector('#hardness');
  const dialog = document.querySelector('#confirm-dialog');
  const dialogTitle = document.querySelector('#confirm-title');
  const dialogMessage = document.querySelector('#confirm-message');
  const confirmAction = document.querySelector('#confirm-action');

  const state = {
    session: null,
    source: null,
    candidate: null,
    edits: [],
    redoStack: [],
    activeStroke: null,
    mode: 'erase',
    radius: 28,
    hardness: 1,
    zoom: 1,
    pan: { x: 0, y: 0 },
    pointer: null,
    panning: false,
    spacePressed: false,
    busy: false
  };

  function apiUrl(path) {
    const url = new URL(path, window.location.href);
    const token = new URL(window.location.href).searchParams.get('token');
    if (token) url.searchParams.set('token', token);
    return url;
  }

  async function request(path, options = {}) {
    const response = await fetch(apiUrl(path), {
      cache: 'no-store',
      credentials: 'same-origin',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    if (!response.ok) throw new Error(`本地服务返回 ${response.status}`);
    return response;
  }

  function loadImage(path) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('无法加载本地图像'));
      image.src = apiUrl(path).toString();
    });
  }

  function interpolateStroke(from, to, spacing = 2) {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, spacing)));
    return Array.from({ length: steps + 1 }, (_, index) => ({
      x: from.x + ((to.x - from.x) * index) / steps,
      y: from.y + ((to.y - from.y) * index) / steps
    }));
  }

  function applyTransform() {
    canvas.style.transform = `translate(-50%, -50%) translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
  }

  function drawBrushPoint(point, stroke) {
    const radius = Math.max(1, stroke.radius);
    const gradient = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    const solidEdge = Math.max(0, Math.min(.99, stroke.hardness));
    gradient.addColorStop(0, '#000');
    gradient.addColorStop(solidEdge, '#000');
    gradient.addColorStop(1, '#0000');

    context.save();
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    if (stroke.mode === 'erase') {
      context.globalCompositeOperation = 'destination-out';
      context.fill();
    } else {
      const size = Math.max(2, Math.ceil(radius * 2));
      if (restoreBrush.width !== size || restoreBrush.height !== size) {
        restoreBrush.width = size;
        restoreBrush.height = size;
      } else {
        restoreContext.clearRect(0, 0, size, size);
      }
      restoreContext.globalCompositeOperation = 'source-over';
      restoreContext.drawImage(
        state.source,
        point.x - radius, point.y - radius, radius * 2, radius * 2,
        0, 0, size, size
      );
      const restoreGradient = restoreContext.createRadialGradient(
        size / 2, size / 2, 0, size / 2, size / 2, size / 2
      );
      restoreGradient.addColorStop(0, '#000');
      restoreGradient.addColorStop(solidEdge, '#000');
      restoreGradient.addColorStop(1, '#0000');
      restoreContext.globalCompositeOperation = 'destination-in';
      restoreContext.fillStyle = restoreGradient;
      restoreContext.fillRect(0, 0, size, size);
      context.globalCompositeOperation = 'source-over';
      context.drawImage(restoreBrush, point.x - radius, point.y - radius, radius * 2, radius * 2);
    }
    context.restore();
  }

  function drawStroke(stroke) {
    if (!stroke.points.length) return;
    drawBrushPoint(stroke.points[0], stroke);
    for (let index = 1; index < stroke.points.length; index += 1) {
      const spacing = Math.max(1, stroke.radius * .2);
      const points = interpolateStroke(stroke.points[index - 1], stroke.points[index], spacing);
      for (const point of points.slice(1)) drawBrushPoint(point, stroke);
    }
  }

  function redraw() {
    if (!state.candidate) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = 'source-over';
    context.drawImage(state.candidate, 0, 0);
    for (const stroke of state.edits) drawStroke(stroke);
    if (state.activeStroke) drawStroke(state.activeStroke);
  }

  function updateControls() {
    undoButton.disabled = state.edits.length === 0 || state.busy;
    redoButton.disabled = state.redoStack.length === 0 || state.busy;
    resetButton.disabled = state.edits.length === 0 || state.busy;
    const counts = state.edits.reduce((result, stroke) => {
      result[stroke.mode] += 1;
      return result;
    }, { erase: 0, restore: 0 });
    strokeSummary.textContent = `擦除 ${counts.erase} 笔 · 恢复 ${counts.restore} 笔`;
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width - 1, (event.clientX - rect.left) * canvas.width / rect.width)),
      y: Math.max(0, Math.min(canvas.height - 1, (event.clientY - rect.top) * canvas.height / rect.height))
    };
  }

  function beginPointer(event) {
    if (!state.candidate || state.busy) return;
    const wantsPan = event.button === 1 || state.spacePressed;
    state.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    viewport.setPointerCapture(event.pointerId);
    if (wantsPan) {
      state.panning = true;
      viewport.classList.add('panning');
      return;
    }
    if (event.button !== 0) return;
    state.activeStroke = {
      mode: state.mode,
      radius: state.radius,
      hardness: state.hardness,
      points: [canvasPoint(event)]
    };
    redraw();
  }

  function movePointer(event) {
    if (!state.pointer || event.pointerId !== state.pointer.id) return;
    if (state.panning) {
      state.pan.x += event.clientX - state.pointer.x;
      state.pan.y += event.clientY - state.pointer.y;
      state.pointer.x = event.clientX;
      state.pointer.y = event.clientY;
      applyTransform();
      return;
    }
    if (!state.activeStroke) return;
    state.activeStroke.points.push(canvasPoint(event));
    redraw();
  }

  function endPointer(event) {
    if (!state.pointer || event.pointerId !== state.pointer.id) return;
    if (state.activeStroke) {
      state.edits.push(state.activeStroke);
      state.activeStroke = null;
      state.redoStack.length = 0;
      status.textContent = '修改尚未保存';
      redraw();
      updateControls();
    }
    state.pointer = null;
    state.panning = false;
    viewport.classList.remove('panning');
  }

  function undo() {
    const stroke = state.edits.pop();
    if (stroke) state.redoStack.push(stroke);
    redraw();
    updateControls();
  }

  function redo() {
    const stroke = state.redoStack.pop();
    if (stroke) state.edits.push(stroke);
    redraw();
    updateControls();
  }

  function confirm(title, message, actionLabel) {
    dialogTitle.textContent = title;
    dialogMessage.textContent = message;
    confirmAction.textContent = actionLabel;
    dialog.showModal();
    return new Promise(resolve => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    });
  }

  async function reset() {
    if (!await confirm('重置全部修改？', '所有尚未保存的擦除和恢复笔画都会清除。', '确认重置')) return;
    state.edits.length = 0;
    state.redoStack.length = 0;
    redraw();
    updateControls();
    status.textContent = '已重置到自动去背结果';
  }

  async function save() {
    if (state.busy) return;
    state.busy = true;
    updateControls();
    status.textContent = '正在保存本地修正…';
    const strokeCounts = state.edits.reduce((result, stroke) => {
      result[stroke.mode] += 1;
      return result;
    }, { erase: 0, restore: 0 });
    const edits = state.edits.flatMap(stroke => {
      const points = stroke.points.length ? [stroke.points[0]] : [];
      for (let index = 1; index < stroke.points.length; index += 1) {
        const spacing = Math.max(1, stroke.radius * .2);
        points.push(...interpolateStroke(stroke.points[index - 1], stroke.points[index], spacing).slice(1));
      }
      return points.map(point => ({
        mode: stroke.mode,
        x: point.x,
        y: point.y,
        radius: stroke.radius,
        hardness: stroke.hardness
      }));
    });
    try {
      await request('/api/save', {
        method: 'POST',
        body: JSON.stringify({
          edits: edits,
          strokeCounts: strokeCounts,
          key: state.session.key,
          attempt: state.session.attempt
        })
      });
      status.textContent = '保存成功，可以关闭此页面';
    } catch (error) {
      state.busy = false;
      status.textContent = `保存失败：${error.message}`;
      updateControls();
    }
  }

  async function cancel() {
    if (state.edits.length && !await confirm('取消修正？', '未保存的修改会丢失，原图不会改变。', '确认取消')) return;
    state.busy = true;
    updateControls();
    try {
      await request('/api/cancel', { method: 'POST', body: '{}' });
      status.textContent = '已取消，可以关闭此页面';
    } catch (error) {
      state.busy = false;
      status.textContent = `取消失败：${error.message}`;
      updateControls();
    }
  }

  async function initialize() {
    try {
      const response = await request('/api/session');
      state.session = await response.json();
      [state.source, state.candidate] = await Promise.all([
        loadImage('/api/image/source'),
        loadImage('/api/image/candidate')
      ]);
      canvas.width = state.candidate.naturalWidth;
      canvas.height = state.candidate.naturalHeight;
      redraw();
      applyTransform();
      loading.classList.add('hidden');
      status.textContent = `已加载 ${canvas.width} × ${canvas.height}，所有操作仅在本机进行`;
    } catch (error) {
      loading.textContent = `加载失败：${error.message}`;
      status.textContent = '无法连接本地修正服务';
    }
  }

  document.querySelectorAll('[data-mode]').forEach(button => {
    button.addEventListener('click', () => {
      state.mode = button.dataset.mode;
      document.querySelectorAll('[data-mode]').forEach(item => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      status.textContent = state.mode === 'erase' ? '画笔：擦除背景' : '画笔：恢复人物';
    });
  });
  radiusInput.addEventListener('input', () => {
    state.radius = Number(radiusInput.value);
    document.querySelector('#radius-value').textContent = String(state.radius);
  });
  hardnessInput.addEventListener('input', () => {
    state.hardness = Number(hardnessInput.value) / 100;
    document.querySelector('#hardness-value').textContent = `${hardnessInput.value}%`;
  });
  zoomSelect.addEventListener('change', () => {
    state.zoom = Number(zoomSelect.value) / 100;
    applyTransform();
    status.textContent = `缩放 ${zoomSelect.value}%`;
  });
  viewport.addEventListener('pointerdown', beginPointer);
  viewport.addEventListener('pointermove', movePointer);
  viewport.addEventListener('pointerup', endPointer);
  viewport.addEventListener('pointercancel', endPointer);
  viewport.addEventListener('contextmenu', event => event.preventDefault());
  undoButton.addEventListener('click', undo);
  redoButton.addEventListener('click', redo);
  resetButton.addEventListener('click', reset);
  document.querySelector('#save').addEventListener('click', save);
  document.querySelector('#cancel').addEventListener('click', cancel);
  window.addEventListener('keydown', event => {
    if (event.code === 'Space') {
      state.spacePressed = true;
      event.preventDefault();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    }
  });
  window.addEventListener('keyup', event => {
    if (event.code === 'Space') state.spacePressed = false;
  });

  updateControls();
  initialize();
})();
