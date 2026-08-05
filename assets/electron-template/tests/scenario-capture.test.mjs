import assert from 'node:assert/strict';
import test from 'node:test';

import captureHelpers from '../src/scenario-capture.js';

const { fitCaptureToLogicalBounds } = captureHelpers;

test('scenario capture scales device-pixel images to BrowserWindow logical bounds', () => {
  const resized = [];
  const image = {
    getSize: () => ({ width: 270, height: 270 }),
    resize: (size) => {
      resized.push(size);
      return { getSize: () => size, marker: 'logical' };
    }
  };

  const result = fitCaptureToLogicalBounds(image, { width: 180, height: 181 });

  assert.deepEqual(resized, [{ width: 180, height: 181, quality: 'best' }]);
  assert.equal(result.marker, 'logical');
});

test('scenario capture keeps an image already matching logical bounds', () => {
  const image = {
    getSize: () => ({ width: 180, height: 181 }),
    resize: () => assert.fail('resize should not run')
  };

  assert.equal(fitCaptureToLogicalBounds(image, { width: 180, height: 181 }), image);
});
