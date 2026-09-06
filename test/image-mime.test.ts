import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { detectSupportedImageMimeTypeFromFile } from '@earendil-works/pi-coding-agent';
import { detectImageMimeType } from '../src/image-mime.ts';

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const JPEG_HEADER = Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const WEBP = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');

// Structural fixtures intentionally omit CRC calculation: pi sniffs headers,
// not image decodability, payload integrity, dimensions, or filename extensions.
function chunk(type: string, length = 0): Buffer {
  const buffer = Buffer.alloc(length + 12);
  buffer.writeUInt32BE(length, 0);
  buffer.write(type, 4, 'latin1');
  return buffer;
}

const PNG_HEADER = Buffer.concat([PNG_SIGNATURE, chunk('IHDR', 13)]);
const APNG = Buffer.concat([PNG_HEADER, chunk('acTL', 8), chunk('IDAT')]);

function bmp(dibHeaderSize = 40, bitsPerPixel = 24): Buffer {
  const pixelOffset = 14 + dibHeaderSize;
  const buffer = Buffer.alloc(pixelOffset + 4);
  buffer.write('BM');
  buffer.writeUInt32LE(buffer.length, 2);
  buffer.writeUInt32LE(pixelOffset, 10);
  buffer.writeUInt32LE(dibHeaderSize, 14);
  if (dibHeaderSize === 12) {
    buffer.writeUInt16LE(1, 18); // width
    buffer.writeUInt16LE(1, 20); // height
  } else {
    buffer.writeUInt32LE(1, 18);
    buffer.writeUInt32LE(1, 22);
  }
  const planesOffset = dibHeaderSize === 12 ? 22 : 26;
  buffer.writeUInt16LE(1, planesOffset);
  buffer.writeUInt16LE(bitsPerPixel, planesOffset + 2);
  return buffer;
}

function uint32(buffer: Buffer, offset: number, value: number, bigEndian = false): Buffer {
  const changed = Buffer.from(buffer);
  if (bigEndian) changed.writeUInt32BE(value, offset);
  else changed.writeUInt32LE(value, offset);
  return changed;
}

async function differential(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'pi-ssh-image-mime-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let id = 0;
  return async (label: string, buffer: Buffer, expected?: string | null, extension = 'bin') => {
    const file = join(dir, `${id++}.${extension}`);
    await writeFile(file, buffer);
    const snapshot = Buffer.from(buffer);
    const actual = detectImageMimeType(buffer);
    const native = await detectSupportedImageMimeTypeFromFile(file);
    assert.equal(actual, native, `${label}: public detector compatibility`);
    if (expected !== undefined) assert.equal(actual, expected, label);
    assert.deepEqual(buffer, snapshot, `${label}: input must not be mutated`);
  };
}

test('supported image signatures are detected independently of filename extensions', async t => {
  const check = await differential(t);
  const formats: Array<[string, Buffer, string]> = [
    ['jpg', JPEG_HEADER, 'image/jpeg'],
    ['png', PNG, 'image/png'],
    ['gif', GIF, 'image/gif'],
    ['webp', WEBP, 'image/webp'],
    ['bmp', bmp(), 'image/bmp'],
  ];
  for (const [extension, buffer, mime] of formats) {
    await check(extension, buffer, mime, extension);
    await check(`${extension} mislabeled as text`, buffer, mime, 'txt');
    await check(`${extension} mislabeled as another image`, buffer, mime, extension === 'png' ? 'jpg' : 'png');
    await check(`text mislabeled as ${extension}`, Buffer.from('not an image'), null, extension);
  }
  await check('JPEG signature alone is sufficient', JPEG_HEADER.subarray(0, 3), 'image/jpeg');
  await check('GIF signature alone is sufficient', Buffer.from('GIF'), 'image/gif');
  await check('GIF version is not validated', Buffer.from('GIFxxx'), 'image/gif');
  await check('PNG IHDR body need not be present', PNG_HEADER.subarray(0, 16), 'image/png');
  await check('WebP RIFF size and payload are not validated', Buffer.from('RIFFxxxxWEBP'), 'image/webp');
});

test('invalid and unsupported image headers match the public detector', async t => {
  const check = await differential(t);
  const invalid: Array<[string, Buffer]> = [
    ['empty', Buffer.alloc(0)],
    ['JSON', Buffer.from('{"format":"png"}')],
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['PDF', Buffer.from('%PDF-1.7')],
    ['TIFF', Buffer.from('49492a0008000000', 'hex')],
    ['AVIF', Buffer.from('00000020667479706176696600000000', 'hex')],
    ['JPEG-LS', Buffer.from('ffd8fff700104a464946', 'hex')],
    ['incorrect JPEG marker', Buffer.from('ffd7ff', 'hex')],
    ['PNG signature only', PNG_SIGNATURE],
    ['PNG wrong IHDR length', uint32(PNG_HEADER, 8, 12, true)],
    ['PNG huge IHDR length', uint32(PNG_HEADER, 8, 0xffffffff, true)],
    ['PNG without IHDR first', Buffer.concat([PNG_SIGNATURE, chunk('IDAT', 13)])],
    ['lowercase GIF', Buffer.from('gif89a')],
    ['high-bit GIF lookalike', Buffer.from([0xc7, 0x49, 0x46])],
    ['WebP without RIFF', Buffer.from('NOPExxxxWEBP')],
    ['RIFF without WebP', Buffer.from('RIFFxxxxWAVE')],
    ['WebP at wrong offset', Buffer.from('RIFFxxxWEBP')],
    ['high-bit WebP lookalike', Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0xd7, 0x45, 0x42, 0x50])],
    ['BMP signature only', Buffer.from('BM')],
    ['BMP zero header', Buffer.concat([Buffer.from('BM'), Buffer.alloc(100)])],
  ];
  for (const [label, buffer] of invalid) await check(label, buffer, null, 'png');
  for (let byte = 0; byte < PNG_SIGNATURE.length; byte++) {
    const changed = Buffer.from(PNG);
    changed[byte] ^= 0x01;
    await check(`PNG corrupted signature byte ${byte}`, changed, null);
  }
});

test('all header truncations match pi without throwing or reading beyond a Buffer view', async t => {
  const check = await differential(t);
  const fixtures = [JPEG_HEADER, Buffer.from('ffd8fff7', 'hex'), PNG_HEADER, APNG, GIF, WEBP, bmp(12), bmp(40)];
  for (const [index, buffer] of fixtures.entries()) {
    for (let length = 0; length <= buffer.length; length++) {
      await check(`fixture ${index}, prefix ${length}`, buffer.subarray(0, length));
    }
    const backing = Buffer.concat([Buffer.alloc(7, 0xff), buffer, Buffer.alloc(8, 0xff)]);
    await check(`fixture ${index}, nonzero byteOffset`, backing.subarray(7, 7 + buffer.length));
  }
});

test('PNG animation exclusion stops at IDAT and at the 4100-byte sniff window', async t => {
  const check = await differential(t);
  await check('acTL before IDAT', APNG, null);
  await check('acTL header alone excludes PNG', APNG.subarray(0, PNG_HEADER.length + 8), null);
  await check('acTL after IDAT is not consulted', Buffer.concat([PNG_HEADER, chunk('IDAT'), chunk('acTL', 8)]), 'image/png');
  await check('acTL in chunk data is not a chunk', Buffer.concat([PNG_HEADER, chunk('tEXt', 20).fill('acTL', 8, 28)]), 'image/png');
  await check('zero-length chunks still advance', Buffer.concat([PNG_HEADER, chunk('tEXt'), chunk('acTL', 8)]), null);
  await check('unsigned oversized chunk stops scanning', Buffer.concat([
    PNG_HEADER, uint32(chunk('tEXt'), 0, 0xffffffff, true), chunk('acTL', 8),
  ]), 'image/png');

  for (const offset of [4088, 4092, 4093, 4096, 4100, 4101, 8192]) {
    const buffer = Buffer.concat([
      PNG_HEADER, chunk('tEXt', offset - PNG_HEADER.length - 12), chunk('acTL', 8), chunk('IDAT'),
    ]);
    await check(`acTL chunk starts at ${offset}`, buffer, offset + 8 <= 4100 ? null : 'image/png');
  }
  for (let length = 0; length <= 8; length++) {
    await check(`partial acTL header ${length}`, APNG.subarray(0, PNG_HEADER.length + length), length === 8 ? null : 'image/png');
  }
});

test('BMP file header, DIB range, planes and bit depths match pi', async t => {
  const check = await differential(t);
  for (const dib of [12, 40, 41, 52, 56, 108, 124]) {
    for (const bpp of [0, 1, 2, 4, 8, 15, 16, 24, 32, 64, 0xffff]) {
      await check(`DIB ${dib}, bpp ${bpp}`, bmp(dib, bpp), [1, 4, 8, 16, 24, 32].includes(bpp) ? 'image/bmp' : null);
    }
    for (const planes of [0, 2, 0xffff]) {
      const buffer = bmp(dib);
      buffer.writeUInt16LE(planes, dib === 12 ? 22 : 26);
      await check(`DIB ${dib}, planes ${planes}`, buffer, null);
    }
  }
  for (const dib of [0, 11, 13, 39, 125, 0xffffffff]) {
    await check(`unsupported DIB ${dib}`, uint32(bmp(), 14, dib), null);
  }
  await check('unspecified file size', uint32(bmp(), 2, 0), 'image/bmp');
  await check('undersized declared file size', uint32(bmp(), 2, 25), null);
  await check('pixel offset inside header', uint32(bmp(), 10, 53), null);
  await check('pixel offset equals declared size', uint32(bmp(), 10, 58), null);
  await check('pixel offset exceeds declared size', uint32(bmp(), 10, 59), null);
  await check('unsigned file size and offset', uint32(uint32(bmp(), 2, 0xffffffff), 10, 0x80000000), 'image/bmp');
  await check('core header minimum size', bmp(12).subarray(0, 26), 'image/bmp');
  await check('info header minimum size', bmp().subarray(0, 30), 'image/bmp');
});

test('deterministic header mutations remain compatible with the public detector', async t => {
  const check = await differential(t);
  // Mutate every byte near a recognized header, including chunk lengths and
  // unsigned BMP fields. This also guards against out-of-bounds integer reads.
  for (const [index, fixture] of [JPEG_HEADER, PNG_HEADER, APNG, GIF, WEBP, bmp(12), bmp()].entries()) {
    for (let offset = 0; offset < fixture.length; offset++) {
      const changed = Buffer.from(fixture);
      changed[offset] ^= 0xff;
      await check(`fixture ${index}, flipped byte ${offset}`, changed);
    }
  }
});
