const { inflateSync, crc32 } = require('node:zlib');
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// Validate bounded single-frame PNG bytes before accepting provider output.
// This is format validation, not a content-safety or intellectual-property review.
function validatePng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 57 || bytes.length > 10 * 1024 * 1024 || !bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('Invalid PNG');
  let offset = 8, header, palette = false, ended = false, imageEnded = false;
  const compressed = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('Truncated PNG chunk');
    const length = bytes.readUInt32BE(offset);
    const end = offset + length + 12;
    if (end > bytes.length) throw new Error('Truncated PNG data');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, end - 4);
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw new Error('Invalid PNG checksum');
    if (!header && type !== 'IHDR') throw new Error('PNG header missing');
    if (type === 'IHDR') {
      if (header || length !== 13) throw new Error('Invalid PNG header');
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colour: data[9], interlace: data[12] };
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!header.width || !header.height || header.width > 4096 || header.height > 4096 || !depths[header.colour]?.includes(header.depth) || data[10] !== 0 || data[11] !== 0 || header.interlace > 1) throw new Error('Unsupported PNG dimensions or encoding');
    } else if (type === 'PLTE') {
      if (palette || compressed.length || !length || length > 768 || length % 3) throw new Error('Invalid PNG palette');
      palette = true;
    } else if (type === 'IDAT') {
      if (imageEnded) throw new Error('Non-contiguous PNG image data');
      compressed.push(data);
    } else if (type === 'IEND') {
      if (length || !compressed.length || end !== bytes.length) throw new Error('Invalid PNG end');
      ended = true;
    } else {
      if (type === 'acTL' || type[0] === type[0].toUpperCase()) throw new Error('Unsupported PNG chunk');
      if (compressed.length) imageEnded = true;
    }
    offset = end;
  }
  if (!ended || (header.colour === 3 && !palette)) throw new Error('Incomplete PNG');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.colour];
  const passes = header.interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  const rows = [];
  let expected = 0;
  for (const [x, y, dx, dy] of passes) {
    const width = Math.max(0, Math.ceil((header.width - x) / dx));
    const height = Math.max(0, Math.ceil((header.height - y) / dy));
    if (!width || !height) continue;
    const stride = Math.ceil(width * channels * header.depth / 8) + 1;
    expected += stride * height;
    rows.push({ stride, height });
  }
  if (expected > 64 * 1024 * 1024) throw new Error('Decoded PNG is too large');
  const pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected + 1 });
  if (pixels.length !== expected) throw new Error('PNG pixel data has incorrect length');
  let row = 0;
  for (const { stride, height } of rows) for (let i = 0; i < height; i++, row += stride) if (pixels[row] > 4) throw new Error('Invalid PNG filter');
  return { width: header.width, height: header.height };
}

module.exports = { validatePng };
