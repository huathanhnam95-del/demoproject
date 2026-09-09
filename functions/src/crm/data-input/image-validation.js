'use strict';
const { createHash } = require('node:crypto');
const IMAGE_LIMITS = Object.freeze({ inputBytes: 4 * 1024 * 1024, outputBytes: 8 * 1024 * 1024, pixels: 16000000, dimension: 8192, seconds: 5 });
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function fail(code, message) { throw Object.assign(new Error(message), { code, status: 400 }); }
function formatOf(bytes) {
    if (bytes.subarray(0, 8).equals(pngSignature)) return 'png';
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
    if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
    return null;
}
function rejectAnimatedPng(bytes) {
    // libvips can decode only the first APNG frame. Reject animation explicitly
    // instead of silently dropping evidence contained in subsequent frames.
    let offset = 8;
    while (offset + 12 <= bytes.length) {
        const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
        if (length > bytes.length - offset - 12) fail('INVALID_IMAGE', 'Image data is incomplete.');
        if (type === 'acTL') fail('IMAGE_FRAMES', 'Use a single still image.');
        offset += length + 12;
        if (type === 'IEND') return;
    }
    fail('INVALID_IMAGE', 'Image data is incomplete.');
}
/** Decode only memory buffers. No paths, remote URLs or metadata are retained. */
async function normalizeImage({ bytes, mimeType }) {
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > IMAGE_LIMITS.inputBytes) fail('IMAGE_SIZE', 'Choose an image of at most 4 MiB.');
    const format = formatOf(bytes);
    if (!format || mimeType !== `image/${format}`) fail('IMAGE_TYPE', 'Choose a PNG, JPEG or WebP image matching its declared type.');
    if (format === 'png') rejectAnimatedPng(bytes);
    try {
        const sharp = require('sharp');
        const decoder = sharp(bytes, { failOn: 'warning', limitInputPixels: IMAGE_LIMITS.pixels, limitInputChannels: 4 });
        const metadata = await decoder.metadata();
        if (metadata.format !== format || !Number.isInteger(metadata.width) || !Number.isInteger(metadata.height)
            || metadata.width < 1 || metadata.height < 1 || metadata.width > IMAGE_LIMITS.dimension || metadata.height > IMAGE_LIMITS.dimension
            || metadata.width * metadata.height > IMAGE_LIMITS.pixels) fail('INVALID_IMAGE', 'Image dimensions exceed the supported limits.');
        if ((metadata.pages || 1) !== 1) fail('IMAGE_FRAMES', 'Use a single still image.');
        // Re-encoding validates pixels and strips EXIF/ICC/text metadata. Lossless
        // PNG preserves document text; auto-orientation preserves the intended view.
        const { data, info } = await decoder.rotate().png({ compressionLevel: 6 }).timeout({ seconds: IMAGE_LIMITS.seconds }).toBuffer({ resolveWithObject: true });
        if (data.length > IMAGE_LIMITS.outputBytes) fail('IMAGE_SIZE', 'Decoded image is too large. Crop to the relevant information.');
        const hash = value => createHash('sha256').update(value).digest('hex');
        return { bytes: data, mimeType: 'image/png', width: info.width, height: info.height, sourceMimeType: mimeType, sourceSha256: hash(bytes), sha256: hash(data) };
    } catch (error) {
        if (['IMAGE_SIZE', 'IMAGE_FRAMES', 'INVALID_IMAGE'].includes(error.code)) throw error;
        fail('INVALID_IMAGE', 'The image could not be decoded safely. Choose another image.');
    }
}
module.exports = { normalizeImage, IMAGE_LIMITS };
