'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const sharp = require(require.resolve('sharp', { paths: [path.join(__dirname, '../../../functions')] }));
const { normalizeImage, IMAGE_LIMITS } = require('../../../functions/src/crm/data-input/image-validation');
const image = () => sharp({ create: { width: 3, height: 2, channels: 3, background: { r: 22, g: 66, b: 99 } } });

test('real PNG JPEG and WebP decode into bounded metadata-free PNG with source provenance', async () => {
    for (const format of ['png', 'jpeg', 'webp']) {
        const source = await image().toFormat(format).toBuffer();
        const result = await normalizeImage({ bytes: source, mimeType: `image/${format}` });
        assert.equal(result.mimeType, 'image/png'); assert.equal(result.width, 3); assert.equal(result.height, 2);
        assert.match(result.sourceSha256, /^[a-f0-9]{64}$/); assert.match(result.sha256, /^[a-f0-9]{64}$/);
        const metadata = await sharp(result.bytes).metadata();
        assert.equal(metadata.format, 'png'); assert.equal(metadata.exif, undefined); assert.equal(metadata.icc, undefined);
    }
});
test('image decoding honors EXIF orientation while removing source metadata', async () => {
    const bytes = await image().jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const result = await normalizeImage({ bytes, mimeType: 'image/jpeg' });
    assert.equal(result.width, 2); assert.equal(result.height, 3);
    assert.equal((await sharp(result.bytes).metadata()).orientation, undefined);
});
test('wrong MIME, unsupported active formats, corrupt pixels and excess bytes are rejected', async () => {
    const bytes = await image().png().toBuffer();
    for (const input of [{ bytes, mimeType: 'image/jpeg' }, { bytes: Buffer.from('<svg/>'), mimeType: 'image/svg+xml' }, { bytes: bytes.subarray(0, 40), mimeType: 'image/png' }]) {
        await assert.rejects(normalizeImage(input), error => ['INVALID_IMAGE', 'IMAGE_TYPE'].includes(error.code));
    }
    await assert.rejects(normalizeImage({ bytes: Buffer.alloc(IMAGE_LIMITS.inputBytes + 1), mimeType: 'image/png' }), error => error.code === 'IMAGE_SIZE');
});
test('compressed oversized images and PNG animation declarations cannot bypass limits', async () => {
    const large = await sharp({ create: { width: 5000, height: 4000, channels: 3, background: 'white' } }).png().toBuffer();
    await assert.rejects(normalizeImage({ bytes: large, mimeType: 'image/png' }), error => error.code === 'INVALID_IMAGE');
    const bytes = await image().png().toBuffer();
    const animation = Buffer.alloc(20); animation.writeUInt32BE(8); animation.write('acTL', 4); animation.writeUInt32BE(2, 8);
    await assert.rejects(normalizeImage({ bytes: Buffer.concat([bytes.subarray(0, 33), animation, bytes.subarray(33)]), mimeType: 'image/png' }), error => error.code === 'IMAGE_FRAMES');
});
