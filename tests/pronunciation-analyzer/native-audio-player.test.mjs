import assert from 'node:assert/strict';
import { NativeAudioPlayer } from '../../public/pronunciation-analyzer/native-audio-player.js';

async function testBufferedPlaybackUsesExactSegment() {
    const starts = [];
    const audioContext = {
        state: 'running',
        destination: { id: 'destination' },
        async decodeAudioData() {
            return { duration: 1.0 };
        },
        createBufferSource() {
            return {
                buffer: null,
                connect() {},
                disconnect() {},
                start(when, offset, duration) {
                    starts.push({ when, offset, duration });
                },
                stop() {}
            };
        }
    };

    let fetchCalls = 0;
    const player = new NativeAudioPlayer(audioContext, null, async () => {
        fetchCalls += 1;
        return {
            ok: true,
            async arrayBuffer() {
                return new ArrayBuffer(8);
            }
        };
    });

    const played = await player.playSegment('https://example.com/native.mp3', 0.30, 0.46);

    assert.equal(played, true);
    assert.equal(fetchCalls, 1);
    assert.equal(starts.length, 1);
    assert.equal(starts[0].when, 0);
    assert(Math.abs(starts[0].offset - 0.30) < 0.000001);
    assert(Math.abs(starts[0].duration - 0.16) < 0.000001);
}

async function testHtmlAudioFallbackDoesNotPadBoundaries() {
    const htmlAudioSeeks = [];
    const audioElement = {
        src: 'https://example.com/native.mp3',
        pauseCalls: 0,
        playCalls: 0,
        pause() {
            this.pauseCalls += 1;
        },
        play() {
            this.playCalls += 1;
            return Promise.resolve();
        },
        get currentTime() {
            return this._currentTime || 0;
        },
        set currentTime(value) {
            this._currentTime = value;
            htmlAudioSeeks.push(value);
        }
    };

    const audioContext = {
        state: 'running',
        destination: { id: 'destination' },
        async decodeAudioData() {
            throw new Error('decode failed');
        }
    };

    const player = new NativeAudioPlayer(audioContext, audioElement, async () => ({
        ok: true,
        async arrayBuffer() {
            return new ArrayBuffer(8);
        }
    }));

    const played = await player.playSegment('https://example.com/native.mp3', 0.30, 0.46);

    assert.equal(played, true);
    assert.deepEqual(htmlAudioSeeks, [0.30]);
    assert.equal(audioElement.playCalls, 1);
}

await testBufferedPlaybackUsesExactSegment();
await testHtmlAudioFallbackDoesNotPadBoundaries();
