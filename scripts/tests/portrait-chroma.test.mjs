import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPortraitChromaEdges, preparePortraitAlpha } from '../lib/sprite-processing.mjs';

const pixel = (buffer, width, x, y) => [...buffer.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];

test('portrait edge cleanup removes magenta fringe without changing skin or orange clothing', () => {
  const width = 7;
  const height = 7;
  const data = Buffer.alloc(width * height * 4);
  const set = (x, y, rgba) => data.set(rgba, (y * width + x) * 4);
  for (let x = 0; x < width; x += 1) set(x, 0, [240, 8, 220, 0]);

  for (let y = 1; y <= 5; y += 1) {
    for (let x = 1; x <= 5; x += 1) set(x, y, [201, 146, 119, 255]);
  }
  set(1, 2, [246, 36, 222, 255]); // contaminated hair/skin boundary
  set(1, 4, [232, 91, 34, 255]); // legitimate orange jacket boundary
  set(3, 3, [201, 146, 119, 255]); // interior skin

  const cleaned = cleanPortraitChromaEdges(data, width, height, [240, 8, 220]);

  assert.deepEqual(pixel(cleaned, width, 3, 3), [201, 146, 119, 255]);
  assert.deepEqual(pixel(cleaned, width, 1, 4), [232, 91, 34, 255]);
  const fringe = pixel(cleaned, width, 1, 2);
  assert.ok(fringe[2] < 170, `blue fringe remained: ${fringe}`);
  assert.ok(Math.abs(fringe[0] - 201) < 30, `edge no longer matches nearby subject: ${fringe}`);
  assert.deepEqual(pixel(cleaned, width, 0, 0), [0, 0, 0, 0]);
});

test('portrait edge cleanup removes dark antialiased magenta fringe at transparent boundaries', () => {
  const width = 7;
  const height = 7;
  const data = Buffer.alloc(width * height * 4);
  const set = (x, y, rgba) => data.set(rgba, (y * width + x) * 4);
  for (let y = 1; y <= 5; y += 1) {
    for (let x = 1; x <= 5; x += 1) set(x, y, [24, 28, 45, 255]);
  }
  set(1, 2, [100, 4, 117, 255]);

  const cleaned = cleanPortraitChromaEdges(data, width, height, [243, 8, 220]);

  const fringe = pixel(cleaned, width, 1, 2);
  assert.ok(fringe[0] < 50 && fringe[2] < 70, `dark magenta fringe remained: ${fringe}`);
  assert.deepEqual(pixel(cleaned, width, 3, 3), [24, 28, 45, 255]);
});

test('portrait edge cleanup removes green fringe without changing blue denim or skin', () => {
  const width = 7;
  const height = 7;
  const data = Buffer.alloc(width * height * 4);
  const set = (x, y, rgba) => data.set(rgba, (y * width + x) * 4);
  for (let x = 0; x < width; x += 1) set(x, 0, [0, 255, 0, 0]);
  for (let y = 1; y <= 5; y += 1) {
    for (let x = 1; x <= 5; x += 1) set(x, y, [45, 64, 105, 255]);
  }
  set(1, 2, [18, 238, 31, 255]);
  set(1, 4, [44, 72, 126, 255]);
  set(3, 3, [201, 146, 119, 255]);

  const cleaned = cleanPortraitChromaEdges(data, width, height, [0, 255, 0]);
  assert.deepEqual(pixel(cleaned, width, 3, 3), [201, 146, 119, 255]);
  assert.deepEqual(pixel(cleaned, width, 1, 4), [44, 72, 126, 255]);
  const fringe = pixel(cleaned, width, 1, 2);
  assert.ok(fringe[1] < 130, `green fringe remained: ${fringe}`);
  assert.deepEqual(pixel(cleaned, width, 0, 0), [0, 0, 0, 0]);
});

test('already transparent portraits bypass destructive global chroma removal', () => {
  const width = 3;
  const height = 2;
  const data = Buffer.from([
    255, 0, 255, 0, 201, 146, 119, 255, 255, 0, 255, 0,
    0, 0, 0, 0, 35, 24, 20, 255, 0, 0, 0, 0
  ]);

  const cleaned = preparePortraitAlpha(data, width, height, [255, 0, 255]);

  assert.deepEqual(pixel(cleaned, width, 1, 0), [201, 146, 119, 255]);
  assert.deepEqual(pixel(cleaned, width, 1, 1), [35, 24, 20, 255]);
  assert.deepEqual(pixel(cleaned, width, 0, 0), [0, 0, 0, 0]);
});
