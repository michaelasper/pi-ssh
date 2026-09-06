/*
 * Adapted from @earendil-works/pi-coding-agent v0.85.1, src/utils/mime.ts:
 * https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/utils/mime.ts
 * MIT License — Copyright (c) 2025 Mario Zechner
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const SNIFF_BYTES = 4100;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Match pi's public file detector without filesystem I/O or decoding the image. */
export function detectImageMimeType(buffer: Buffer): string | null {
  buffer = buffer.subarray(0, SNIFF_BYTES);
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return buffer[3] === 0xf7 ? null : 'image/jpeg';
  }
  if (buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return buffer.length >= 16 && buffer.readUInt32BE(8) === 13 && hasAscii(buffer, 12, 'IHDR')
      && !isAnimatedPng(buffer) ? 'image/png' : null;
  }
  if (hasAscii(buffer, 0, 'GIF')) return 'image/gif';
  if (hasAscii(buffer, 0, 'RIFF') && hasAscii(buffer, 8, 'WEBP')) return 'image/webp';
  if (hasAscii(buffer, 0, 'BM') && isBmp(buffer)) return 'image/bmp';
  return null;
}

function isAnimatedPng(buffer: Buffer): boolean {
  let offset = PNG_SIGNATURE.length;
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    if (hasAscii(buffer, offset + 4, 'acTL')) return true;
    if (hasAscii(buffer, offset + 4, 'IDAT')) return false;
    const nextOffset = offset + 12 + chunkLength;
    if (nextOffset <= offset || nextOffset > buffer.length) return false;
    offset = nextOffset;
  }
  return false;
}

function isBmp(buffer: Buffer): boolean {
  if (buffer.length < 26) return false;
  const declaredFileSize = buffer.readUInt32LE(2);
  const pixelDataOffset = buffer.readUInt32LE(10);
  const dibHeaderSize = buffer.readUInt32LE(14);
  if (declaredFileSize !== 0 && declaredFileSize < 26) return false;
  if (pixelDataOffset < 14 + dibHeaderSize) return false;
  if (declaredFileSize !== 0 && pixelDataOffset >= declaredFileSize) return false;

  let planesOffset: number;
  if (dibHeaderSize === 12) {
    planesOffset = 22;
  } else if (dibHeaderSize >= 40 && dibHeaderSize <= 124) {
    if (buffer.length < 30) return false;
    planesOffset = 26;
  } else {
    return false;
  }
  return buffer.readUInt16LE(planesOffset) === 1
    && [1, 4, 8, 16, 24, 32].includes(buffer.readUInt16LE(planesOffset + 2));
}

function hasAscii(buffer: Buffer, offset: number, text: string): boolean {
  if (buffer.length < offset + text.length) return false;
  for (let index = 0; index < text.length; index++) {
    if (buffer[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}
