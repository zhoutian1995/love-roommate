'use strict';

function fitCaptureToLogicalBounds(image, bounds) {
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  const current = image.getSize();
  if (current.width === width && current.height === height) return image;
  return image.resize({ width, height, quality: 'best' });
}

module.exports = { fitCaptureToLogicalBounds };
