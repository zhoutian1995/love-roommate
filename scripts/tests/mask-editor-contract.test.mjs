import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);

async function readAsset(name) {
  return readFile(new URL(`assets/mask-editor/${name}`, root), 'utf8');
}

test('蒙版编辑器是无远程依赖的纯本地静态页面', async () => {
  const files = await Promise.all([
    readAsset('index.html'),
    readAsset('editor.css'),
    readAsset('editor.js')
  ]);
  const bundle = files.join('\n');

  assert.doesNotMatch(bundle, /https?:\/\//i);
  assert.doesNotMatch(bundle, /\b(?:cdn|localStorage|serviceWorker)\b/i);
  assert.doesNotMatch(files[0], /<script[^>]+src=["'](?!\.\/editor\.js)/i);
  assert.doesNotMatch(files[0], /<link[^>]+href=["'](?!\.\/editor\.css)/i);
});

test('中文界面暴露完整编辑、导航和结束操作', async () => {
  const html = await readAsset('index.html');

  for (const text of [
    '擦除背景', '恢复人物', '撤销', '重做', '重置', '保存并关闭', '取消'
  ]) assert.match(html, new RegExp(text));

  for (const contract of [
    'data-mode="erase"', 'data-mode="restore"', 'id="zoom"',
    'id="undo"', 'id="redo"', 'id="reset"', 'id="save"', 'id="cancel"',
    'id="editor-canvas"', 'id="status"', 'id="confirm-dialog"'
  ]) assert.ok(html.includes(contract), `缺少 ${contract}`);

  for (const zoom of ['100', '200', '400', '800']) {
    assert.match(html, new RegExp(`<option value="${zoom}"`));
  }
});

test('编辑器使用 Pointer Events、连续笔画插值和本地 API', async () => {
  const js = await readAsset('editor.js');

  for (const eventName of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    assert.match(js, new RegExp(eventName));
  }
  assert.match(js, /function\s+interpolateStroke\s*\(/);
  assert.match(js, /\/api\/session/);
  assert.match(js, /\/api\/image\//);
  assert.match(js, /\/api\/save/);
  assert.match(js, /\/api\/cancel/);
  assert.match(js, /edits\s*:/);
  assert.match(js, /strokeCounts\s*:/);
  assert.match(js, /key\s*:/);
  assert.match(js, /attempt\s*:/);
  assert.doesNotMatch(js, /toDataURL|toBlob|imageData\s*:/i,
    '保存负载不得包含源图像像素');
});

test('画布支持空格或中键拖动并提供可访问状态', async () => {
  const [html, js] = await Promise.all([readAsset('index.html'), readAsset('editor.js')]);
  assert.match(js, /event\.button\s*===\s*1/);
  assert.match(js, /event\.code\s*===\s*['"]Space['"]/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-label="透明蒙版编辑画布"/);
});
