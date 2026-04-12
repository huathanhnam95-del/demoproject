function readAscii(view, offset, length) {
    let out = '';
    for (let i = 0; i < length; i += 1) {
        out += String.fromCharCode(view.getUint8(offset + i));
    }
    return out;
}

function parseWavMetadata(buffer) {
    try {
        if (!Buffer.isBuffer(buffer) || buffer.length < 44) {
            return { ok: false, reason: 'decode_failed' };
        }

        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
            return { ok: false, reason: 'decode_failed' };
        }

        let offset = 12;
        let formatChunk = null;
        let dataChunkBytes = 0;

        while (offset + 8 <= view.byteLength) {
            const chunkId = readAscii(view, offset, 4);
            const chunkSize = view.getUint32(offset + 4, true);
            const chunkStart = offset + 8;
            const chunkEnd = chunkStart + chunkSize;
            if (chunkEnd > view.byteLength) {
                return { ok: false, reason: 'decode_failed' };
            }

            if (chunkId === 'fmt ') {
                if (chunkSize < 16) {
                    return { ok: false, reason: 'decode_failed' };
                }
                formatChunk = {
                    audioFormat: view.getUint16(chunkStart, true),
                    channelCount: view.getUint16(chunkStart + 2, true),
                    sampleRate: view.getUint32(chunkStart + 4, true),
                    byteRate: view.getUint32(chunkStart + 8, true),
                    blockAlign: view.getUint16(chunkStart + 12, true),
                    bitsPerSample: view.getUint16(chunkStart + 14, true)
                };
            } else if (chunkId === 'data') {
                dataChunkBytes += chunkSize;
            }

            offset = chunkEnd + (chunkSize % 2);
        }

        if (!formatChunk || !dataChunkBytes) {
            return { ok: false, reason: 'decode_failed' };
        }

        if (formatChunk.audioFormat !== 1) {
            return { ok: false, reason: 'decode_failed' };
        }

        let bytesPerSecond = Number(formatChunk.byteRate || 0);
        if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
            const sampleRate = Number(formatChunk.sampleRate || 0);
            const blockAlign = Number(formatChunk.blockAlign || 0);
            bytesPerSecond = sampleRate > 0 && blockAlign > 0 ? sampleRate * blockAlign : 0;
        }
        if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
            return { ok: false, reason: 'decode_failed' };
        }

        const durationMs = Math.round((dataChunkBytes / bytesPerSecond) * 1000);
        if (!Number.isFinite(durationMs) || durationMs <= 0) {
            return { ok: false, reason: 'decode_failed' };
        }

        return {
            ok: true,
            durationMs,
            dataChunkBytes,
            audioFormat: formatChunk.audioFormat,
            channelCount: formatChunk.channelCount,
            sampleRate: formatChunk.sampleRate,
            byteRate: formatChunk.byteRate,
            blockAlign: formatChunk.blockAlign,
            bitsPerSample: formatChunk.bitsPerSample
        };
    } catch (_) {
        return { ok: false, reason: 'decode_failed' };
    }
}

module.exports = {
    parseWavMetadata
};

