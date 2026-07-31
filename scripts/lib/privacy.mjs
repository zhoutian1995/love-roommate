import fs from 'node:fs';
import path from 'node:path';

export const RASTER_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff',
  '.avif', '.heic', '.heif', '.jxl', '.ico'
]);

export function isRasterFile(file) {
  if (RASTER_EXTENSIONS.has(path.extname(file).toLowerCase())) return true;
  let header;
  try {
    const descriptor = fs.openSync(file, 'r');
    try {
      header = Buffer.alloc(32);
      const length = fs.readSync(descriptor, header, 0, header.length, 0);
      header = header.subarray(0, length);
    } finally {
      fs.closeSync(descriptor);
    }
  } catch {
    return false;
  }
  if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return true;
  if (header.subarray(0, 6).toString('ascii') === 'GIF87a' || header.subarray(0, 6).toString('ascii') === 'GIF89a') return true;
  if (header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP') return true;
  if (header.subarray(0, 2).toString('ascii') === 'BM') return true;
  if (header.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || header.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))) return true;
  if (header.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00])) || header.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x02, 0x00]))) return true;
  if (header.subarray(0, 2).equals(Buffer.from([0xff, 0x0a])) || header.subarray(0, 12).equals(Buffer.from([0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]))) return true;
  if (header.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brands = header.subarray(8).toString('ascii');
    if (/(?:avif|avis|heic|heix|hevc|hevx|mif1|msf1)/.test(brands)) return true;
  }
  return false;
}

export function portableRelative(root, file, label = 'path') {
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(file);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the output root.`);
  }
  return (relative || '.').replaceAll('\\', '/');
}

export function resolvePortable(root, relative, label = 'path') {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes(':')) {
    throw new Error(`${label} must be a non-empty relative path.`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} escapes the output root.`);
  }
  return resolved;
}

function sanitizeString(value, outputRoot) {
  const roots = [path.resolve(outputRoot), path.resolve(outputRoot).replaceAll('\\', '/')];
  let result = value;
  for (const root of roots) result = result.replaceAll(root, '.');
  result = result
    .replace(/(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"'`<>]*/g, '[redacted-path]')
    .replace(/\\\\[^\s"'`<>]+/g, '[redacted-path]')
    .replace(/\/(?:Users|home)\/[^\s"'`<>]*/g, '[redacted-path]');
  return result;
}

export function sanitizePersistedValue(value, outputRoot) {
  if (typeof value === 'string') {
    if (path.isAbsolute(value)) {
      try {
        return portableRelative(outputRoot, value);
      } catch {
        return '[external-path-redacted]';
      }
    }
    return sanitizeString(value, outputRoot);
  }
  if (Array.isArray(value)) return value.map((item) => sanitizePersistedValue(item, outputRoot));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizePersistedValue(item, outputRoot)]));
  }
  return value;
}

export function sensitivePathMatches(text) {
  const matches = [];
  const patterns = [
    /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"'`<>]*/g,
    /\\\\[^\s"'`<>]+/g,
    /\/(?:Users|home)\/[^\s"'`<>]*/g
  ];
  for (const pattern of patterns) matches.push(...(text.match(pattern) || []));
  return [...new Set(matches)];
}

export function auditTextFilesForSensitivePaths(root, extensions = new Set(['.json', '.md', '.txt', '.log', '.yaml', '.yml'])) {
  const errors = [];
  const stack = [path.resolve(root)];
  while (stack.length) {
    const current = stack.pop();
    if (!fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
        const text = fs.readFileSync(full, 'utf8');
        let matches = [];
        if (path.extname(entry.name).toLowerCase() === '.json') {
          try {
            const values = [];
            const collectStrings = (value) => {
              if (typeof value === 'string') values.push(value);
              else if (Array.isArray(value)) value.forEach(collectStrings);
              else if (value && typeof value === 'object') Object.values(value).forEach(collectStrings);
            };
            collectStrings(JSON.parse(text));
            matches = [...new Set(values.flatMap(sensitivePathMatches))];
          } catch {
            matches = sensitivePathMatches(text);
          }
        } else {
          matches = sensitivePathMatches(text);
        }
        if (matches.length) errors.push({ file: portableRelative(root, full), matches });
      }
    }
  }
  return errors;
}
