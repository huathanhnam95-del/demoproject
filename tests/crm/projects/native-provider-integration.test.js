'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createNativeGemini, POLICY_VERSION } = require('../../../functions/src/ai-assistance/providers/native-gemini');
const { createLedgerService } = require('../../../functions/src/ai-assistance/accounting/ledger-service');
const { createNativeVoiceProvider } = require('../../../services/crm-voice-relay/native-provider');
function fixture(response, hook = () => {}, options = {}) {
    const rows = new Map(), requests = []; let chain = Promise.resolve();
    const db = { collection: name => ({ doc: id => ({ path: name + '/' + id }) }) };
    const runTransaction = work => { const result = chain.then(async () => { let writing = false; const pending = new Map(); const tx = { get: async ref => { assert.equal(writing, false); return { exists: rows.has(ref.path), data: () => structuredClone(rows.get(ref.path)) }; }, set(ref, value) { writing = true; pending.set(ref.path, structuredClone(value)); }, create(ref, value) { assert.equal(rows.has(ref.path), false); this.set(ref, value); } }; const value = await work(tx); for (const pair of pending) rows.set(...pair); return value; }); chain = result.catch(() => {}); return result; };
    const native = createNativeGemini({ apiKey: 'test-key', ...options, fetchImpl: async (url, options) => { requests.push({ url, options }); await hook(options); return new Response(JSON.stringify(response), { status: 200 }); } });
    const ledger = createLedgerService({ db, runTransaction, now: () => new Date('2026-09-08'), nativeMode: true, nativePolicy: native.policy, pricingRegistry: native.pricingRegistry, providerAdapters: { gemini: native.accountingAdapter }, resolveAllowance: async () => ({ allowanceNano: '5000000000' }), featureAdapters: { 'crm-data-input': { models: ['gemini-3.8-flash'], normalizeContext: value => value, authorize: async (_tx, { actorUid }) => ({ uid: actorUid }) }, projects: { models: ['gemini-3.8-flash', 'gemini-3.1-flash-live-preview'], normalizeContext: value => value, authorize: async (_tx, { actorUid }) => ({ uid: actorUid }) } } });
    return { native, ledger, requests, rows };
}
const captured = { responseId: 'provider-response', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"transcript":"Confirm this preview"}' }] } }], usageMetadata: { promptTokenCount: 109, candidatesTokenCount: 15, totalTokenCount: 124, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 31 }, { modality: 'AUDIO', tokenCount: 78 }], serviceTier: 'standard' } };
const scope = { actorUid: 'staff', feature: 'projects', sessionId: 'session', epoch: 1 }, context = { projectId: 'project' };
test('native voice prompt follows displayed Projects confirmation without inventing controls or disabling other save flows', async () => {
    for (const feature of ['projects', 'crm-data-input']) {
        const f = fixture(captured); let prompt;
        const factory = createNativeVoiceProvider({ apiKey: 'test-key', native: f.native, ledger: f.ledger, connector: async options => { prompt = options.contextText; return { close() {} }; } });
        const provider = await factory({ scope: { ...scope, feature }, context: {}, sendPermit: { engineeringOnly: false, provider: 'gemini', model: 'gemini-3.1-flash-live-preview' } });
        assert.match(prompt, /Do not invent UI controls/);
        if (feature === 'projects') { assert.match(prompt, /exact confirmation instruction displayed/); assert.match(prompt, /brief processing acknowledgement/); assert.match(prompt, /Do not add manual save or apply steps/); }
        else assert.doesNotMatch(prompt, /Do not add manual save or apply steps/);
        provider.close();
    }
});
test('captured audio ASR reserves and settles real native pricing, binds exact PCM, and cannot redispatch', async () => {
    const f = fixture(captured, () => assert.equal([...f.rows.values()].filter(row => row.state === 'dispatch_intent').length, 1));
    const pcm = Buffer.alloc(3200, 1);
    const result = await f.native.transcribe({ ledger: f.ledger, scope, context, pcm });
    assert.equal(result.text, 'Confirm this preview'); assert.equal(result.accounting.settledNano, '138000');
    assert.equal(result.transcription.audioDigest, require('node:crypto').createHash('sha256').update(pcm).digest('hex'));
    const request = JSON.parse(f.requests[0].options.body), audio = Buffer.from(request.contents[0].parts[0].inlineData.data, 'base64');
    assert.deepEqual(audio.subarray(44), pcm); assert.equal(request.generationConfig.thinkingConfig.thinkingLevel, 'LOW'); assert.equal(request.store, false);
    assert.equal(f.requests[0].url.includes('test-key'), false);
    await assert.rejects(f.native.transcribe({ ledger: f.ledger, scope, context, pcm }), { code: 'RESPONSE_RECOVERY_REQUIRED' }); assert.equal(f.requests.length, 1);
    const evidence = [...f.rows.values()].find(row => row.reservationId)?.evidence[0];
    await assert.rejects(f.ledger.settle(result.accounting.reservationId, JSON.parse(JSON.stringify(evidence))), { code: 'UNTRUSTED_EVIDENCE' });
});
test('truncated ASR never authorizes text; complete expense remains settled', async () => {
    const f = fixture({ ...captured, candidates: [{ ...captured.candidates[0], finishReason: 'MAX_TOKENS' }] });
    await assert.rejects(f.native.transcribe({ ledger: f.ledger, scope, context, pcm: Buffer.alloc(3200) }), { code: 'INVALID_TRANSCRIPTION' });
    assert.equal((await f.ledger.forFeature('projects').getBudget('staff')).settledNano, '138000');
});
test('an earlier Live usage observation is not a final session snapshot', () => {
    const f = fixture(captured);
    const usageMetadata = { promptTokenCount: 0, responseTokenCount: 1, totalTokenCount: 1, responseTokensDetails: [{ modality: 'AUDIO', tokenCount: 1 }] };
    const observation = f.native.liveEvidence({ reservationId: 'reservation', usageMetadata, observations: 0 });
    assert.equal(observation.complete, false); assert.equal(observation.provenance.aggregation, 'multiple_observations');
});
test('relay cancellation reaches pending connector startup', async () => {
    const f = fixture(captured), lifetime = new AbortController(); let observed;
    const factory = createNativeVoiceProvider({ apiKey: 'test-key', native: f.native, ledger: f.ledger, connector: options => new Promise((_resolve, reject) => { observed = options.signal; options.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }); }) });
    const startup = factory({ scope, context: {}, sendPermit: { engineeringOnly: false, provider: 'gemini', model: 'gemini-3.1-flash-live-preview' }, signal: lifetime.signal });
    lifetime.abort(); await assert.rejects(startup, /aborted/); assert.equal(observed.aborted, true); assert.equal(f.requests.length, 0);
});
test('earlier complete usage stays pending at later turn end, and expanded assistant parts remain parseable', async () => {
    const f = fixture(captured), feature = f.ledger.forFeature('projects');
    const reservation = await feature.reserve('staff', { requestId: 'earlier-live', purpose: 'planning', context, model: 'gemini-3.1-flash-live-preview', boundsVersion: POLICY_VERSION, request: { kind: 'live', inputBytes: 100, audioBytes: 3200, maxOutputTokens: 512 } });
    const { sendPermit } = await feature.authorizeDispatch('staff', reservation.reservationId);
    const factory = createNativeVoiceProvider({ apiKey: 'test-key', native: f.native, ledger: f.ledger, connector: async () => ({ sendAudio: async () => {}, endInput: async () => {}, close() {} }) });
    const provider = await factory({ scope, context: { context: { project: { id: 'project' } } }, sendPermit });
    await provider.sendAudio({ bytes: Buffer.alloc(3200), sampleRate: 16000, utteranceId: 'u' });
    await provider.processMessage({ usageMetadata: { promptTokenCount: 0, responseTokenCount: 1, totalTokenCount: 1, responseTokensDetails: [{ modality: 'AUDIO', tokenCount: 1 }] } });
    const expanded = await provider.processMessage({ serverContent: { modelTurn: { parts: Array.from({ length: 32 }, () => ({ text: 'word' })) }, outputTranscription: { text: 'words' } } });
    assert.doesNotThrow(() => require('../../../services/crm-voice-relay/provider-parser').parseProviderMessage(expanded));
    await provider.endInput(); await provider.processMessage({ serverContent: { turnComplete: true } });
    const live = [...f.rows.values()].find(row => row.reservationId === reservation.reservationId);
    assert.equal(live.state, 'usage_unknown'); assert.equal(live.evidence[0].complete, false);
    assert.equal((await feature.getBudget('staff')).settledNano, '138000');
    await provider.processMessage({ serverContent: { turnComplete: true } }); assert.equal(f.requests.length, 1); provider.close();
});
test('native Live transcript is provisional until sealed audio gets a completed ASR; duplicate completion cannot repeat it', async () => {
    const f = fixture(captured), feature = f.ledger.forFeature('projects');
    const reservation = await feature.reserve('staff', { requestId: 'live', purpose: 'planning', context, model: 'gemini-3.1-flash-live-preview', boundsVersion: POLICY_VERSION, request: { kind: 'live', inputBytes: 100, audioBytes: 3200, maxOutputTokens: 512 } });
    const { sendPermit } = await feature.authorizeDispatch('staff', reservation.reservationId);
    let closes = 0, ends = 0;
    const factory = createNativeVoiceProvider({ apiKey: 'test-key', native: f.native, ledger: f.ledger, connector: async options => { assert.equal((await options.authorizeDispatch()).reservationId, reservation.reservationId); return { sendAudio: async () => {}, endInput: async () => { ends++; }, close: () => { closes++; } }; } });
    const provider = await factory({ scope, context: { summary: 'Project', context: { project: { id: 'project' } } }, sendPermit, onMessage() {}, onError() {} });
    await provider.sendAudio({ bytes: Buffer.alloc(3200), sampleRate: 16000, utteranceId: 'u' });
    const provisional = await provider.processMessage({ serverContent: { inputTranscription: { text: 'Confirm this preview', finished: true } } });
    assert.equal(provisional.userTranscription.final, false); assert.equal(f.requests.length, 0);
    await provider.endInput(); await provider.endInput(); assert.equal(ends, 1);
    const complete = await provider.processMessage({ serverContent: { turnComplete: true }, usageMetadata: { promptTokenCount: 240, responseTokenCount: 23, totalTokenCount: 263, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 139 }, { modality: 'AUDIO', tokenCount: 76 }], responseTokensDetails: [{ modality: 'AUDIO', tokenCount: 23 }] } });
    assert.equal(complete.userTranscription.final, true); assert.equal(complete.userTranscription.transcription.source, 'captured_user_audio'); assert.equal(complete.turnComplete, true); assert.equal(closes, 1);
    assert.equal((await feature.getBudget('staff')).estimatedUnknownCount, 1);
    assert.deepEqual(await provider.processMessage({ serverContent: { turnComplete: true } }), {}); assert.equal(f.requests.length, 1); provider.close();
});

test('explicit JSON generation changes only generation format; default and ASR retain their schemas', async () => {
    const schema = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] };
    for (const generationFormat of ['json', 'schema']) { const f = fixture(captured, () => {}, { generationFormat });
        await f.native.generationTransport({ permit: { engineeringOnly: false, provider: 'gemini', model: 'gemini-3.8-flash', reservationId: 'test-generation', token: 'fresh-test-token' }, request: { descriptor: { systemInstruction: 'Propose only.', input: 'Untrusted user instruction', responseSchema: schema }, maxOutputTokens: 100 } });
        const body = JSON.parse(f.requests[0].options.body); assert.equal(body.generationConfig.responseMimeType, 'application/json'); assert.equal(body.contents[0].parts[0].text, 'Untrusted user instruction');
        if (generationFormat === 'json') { assert.equal(body.generationConfig.responseJsonSchema, undefined); assert.ok(body.systemInstruction.parts[0].text.includes(JSON.stringify(schema))); } else assert.deepEqual(body.generationConfig.responseJsonSchema, schema);
        await f.native.transcribe({ ledger: f.ledger, scope, context, pcm: Buffer.alloc(3200) }); assert.ok(JSON.parse(f.requests[1].options.body).generationConfig.responseJsonSchema.properties.transcript);
    }
    assert.throws(() => createNativeGemini({ apiKey: 'test', generationFormat: 'automatic-fallback' }));
});

const { createAccountedGenerationProvider } = require('../../../functions/src/ai-assistance/providers/accounted-generation');
const { digest } = require('../../../functions/src/ai-assistance/accounting/money-pricing');
function pngImage(width = 256, height = 256) {
    const zlib = require('node:zlib'), crypto = require('node:crypto');
    function chunk(name, data) { const type = Buffer.from(name), out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); type.copy(out, 4); data.copy(out, 8); let crc = 0xffffffff; for (const byte of Buffer.concat([type, data])) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4); return out; }
    const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
    const pixels = crypto.randomBytes(height * (width * 3 + 1)); for (let row = 0; row < height; row++) pixels[row * (width * 3 + 1)] = 0;
    const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
    return { attachmentId: 'owned-attachment', sha256: crypto.createHash('sha256').update(bytes).digest('hex'), width, height, bytesLength: bytes.length, inlineData: { mimeType: 'image/png', data: bytes.toString('base64') } };
}
function imageCall(image = pngImage()) {
    const descriptor = { model: 'gemini-3.8-flash', systemInstruction: 'Draft only.', input: 'Extract the supplied data.', responseSchema: { type: 'object' }, image };
    return { actorUid: 'staff', feature: 'crm-data-input', purpose: 'draft', operationId: 'image-operation', request: { ...descriptor, requestDigest: digest(descriptor) } };
}
function imageBridge(f) { return createAccountedGenerationProvider({ ledger: { ...f.ledger, forFeature(name) { const feature = f.ledger.forFeature(name); return { ...feature, reserve(uid, input) { f.admitted = structuredClone(input.request); return feature.reserve(uid, input); } }; } }, nativeMode: true, nativeMapping: { sourceModel: 'gemini-3.8-flash', model: 'gemini-3.8-flash', boundsVersion: POLICY_VERSION, maxOutputBytes: 2048, maxOutputTokens: 128 }, transport: async args => { if (args.request.descriptor.image) assert.ok(Object.isFrozen(args.request.descriptor.image.inlineData)); return f.native.generationTransport(args); } }); }
const imageUsage = { promptTokenCount: 130, candidatesTokenCount: 2, totalTokenCount: 132, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'IMAGE', tokenCount: 100 }] };
function imageResponse(usageMetadata = imageUsage) { return { responseId: 'image-response', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }], usageMetadata }; }
test('native image bytes above 60KB stay transient; compact real ledger digest binds the full request and permits one dispatch', async () => {
    const call = imageCall(); assert.ok(call.request.image.bytesLength > 60000);
    for (const generationFormat of ['schema', 'json']) {
        const f = fixture(imageResponse(), () => { for (const row of f.rows.values()) { const wire = JSON.stringify(row); assert.ok(wire.length < 65536); assert.equal(wire.includes('inlineData'), false); assert.equal(wire.includes(call.request.image.inlineData.data), false); } }, { generationFormat });
        const bridge = imageBridge(f); assert.equal(bridge.supportsImages, true);
        const result = await bridge.generateWithAccounting(call); assert.equal(result.accounting.state, 'settled'); assert.equal(result.accounting.settledNano, '105000');
        const body = JSON.parse(f.requests[0].options.body); assert.deepEqual(body.contents[0].parts, [{ text: call.request.input }, { inlineData: call.request.image.inlineData }]); assert.match(body.systemInstruction.parts[0].text, /untrusted source data/); assert.equal(body.generationConfig.responseMimeType, 'application/json');
        assert.equal(Boolean(body.generationConfig.responseJsonSchema), generationFormat === 'schema');
        const row = [...f.rows.values()].find(value => value.reservationId); assert.equal(f.admitted.descriptorDigest, call.request.requestDigest); assert.equal(f.admitted.descriptor.image.sha256, call.request.image.sha256); assert.equal(f.admitted.descriptor.image.inlineData, undefined); assert.ok(Buffer.byteLength(JSON.stringify(f.admitted)) < 65536); assert.ok(BigInt(row.maximumQuantities.inputImage) > 0n);
        await assert.rejects(bridge.generate(call), { code: 'RESPONSE_RECOVERY_REQUIRED' });
        await assert.rejects(bridge.generate(imageCall()), { code: 'RESERVATION_CONFLICT' }); assert.equal(f.requests.length, 1);
    }
});
test('invalid image metadata and bytes, full digest mismatch, and native feature gates reject before reservation', async () => {
    const original = pngImage();
    const patches = [{ sha256: 'a'.repeat(64) }, { inlineData: { ...original.inlineData, data: original.inlineData.data + '\n' } }, { inlineData: { ...original.inlineData, mimeType: 'image/jpeg' } }, { width: 257 }, { width: 8193 }, { width: 8192, height: 8192 }, { bytesLength: 8 * 1024 * 1024 + 1 }, { bytesLength: original.bytesLength - 1 }, { extra: true }];
    const invalidBytes = Buffer.from(original.inlineData.data, 'base64'); invalidBytes[0] = 0;
    patches.push({ sha256: require('node:crypto').createHash('sha256').update(invalidBytes).digest('hex'), inlineData: { mimeType: 'image/png', data: invalidBytes.toString('base64') } });
    const f = fixture(imageResponse()), bridge = imageBridge(f);
    for (const patch of patches) await assert.rejects(bridge.generate(imageCall({ ...original, ...patch })));
    const call = imageCall(original), changed = imageCall(); changed.request.requestDigest = call.request.requestDigest;
    await assert.rejects(bridge.generate(changed), { code: 'DESCRIPTOR_DIGEST_MISMATCH' });
    await assert.rejects(bridge.generate({ ...call, request: { ...call.request, input: 'x'.repeat(60001) } }), { code: 'DESCRIPTOR_TOO_LARGE' });
    await assert.rejects(bridge.generate({ ...call, feature: 'projects', purpose: 'planning', context }), { code: 'IMAGES_UNSUPPORTED' });
    await assert.rejects(bridge.generate({ ...call, purpose: 'apply' }), { code: 'FEATURE_PURPOSE_NOT_ALLOWED' });
    const disabled = createAccountedGenerationProvider({ ledger: f.ledger }); assert.equal(disabled.supportsImages, false); await assert.rejects(disabled.generate(call), { code: 'IMAGES_UNSUPPORTED' });
    const engineering = createAccountedGenerationProvider({ ledger: f.ledger, engineeringMode: true, engineeringMapping: { sourceModel: 'gemini-3.8-flash', model: 'engineering-test', boundsVersion: 'test', maxOutputBytes: 1024 }, transport: async () => assert.fail('no dispatch') }); assert.equal(engineering.supportsImages, false); await assert.rejects(engineering.generate(call), { code: 'IMAGES_UNSUPPORTED' });
    assert.equal(f.rows.size, 0); assert.equal(f.requests.length, 0);
});
test('image incomplete split remains pending and above-estimate usage remains settled', async () => {
    for (const details of [undefined, [{ modality: 'TEXT', tokenCount: 130 }], [{ modality: 'IMAGE', tokenCount: 130 }]]) {
        const f = fixture(imageResponse({ ...imageUsage, promptTokensDetails: details })), bridge = imageBridge(f), call = imageCall();
        const result = await bridge.generateWithAccounting(call); assert.equal(result.accounting.state, 'usage_unknown'); assert.equal(result.accounting.unresolved, true); assert.ok(BigInt((await f.ledger.forFeature('crm-data-input').getBudget('staff')).pendingNano) > 0n);
        await assert.rejects(bridge.generate(call), { code: 'RESPONSE_RECOVERY_REQUIRED' }); assert.equal(f.requests.length, 1);
    }
    const f = fixture(imageResponse({ ...imageUsage, promptTokenCount: 1000030, totalTokenCount: 1000032, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'IMAGE', tokenCount: 1000000 }] }));
    const result = await imageBridge(f).generateWithAccounting(imageCall()); assert.equal(result.accounting.state, 'settled'); assert.equal(result.accounting.estimateExceeded, true); assert.equal(result.accounting.boundsViolated, false);
});
test('failed native image fetch consumes dispatch once without automatic retry', async () => {
    const f = fixture(imageResponse(), () => { throw Error('offline injected failure'); }), bridge = imageBridge(f), call = imageCall();
    await assert.rejects(bridge.generate(call), { code: 'PROVIDER_GENERATION_FAILED' }); await assert.rejects(bridge.generate(call), { code: 'RESPONSE_RECOVERY_REQUIRED' }); assert.equal(f.requests.length, 1); assert.equal([...f.rows.values()].find(row => row.reservationId).state, 'usage_unknown');
});

test('historical native audio pricing settles new zero-image text/audio evidence at embedded rates; unpriced nonzero image cannot settle', async () => {
    for (const audio of [false, true]) {
        let f; f = fixture(audio ? captured : imageResponse({ promptTokenCount: 8, candidatesTokenCount: 1, totalTokenCount: 9 }), () => { const row = [...f.rows.values()].find(value => value.reservationId); row.pricing.versionId = 'gemini-3.8-flash-standard-2026-native-audio-v1'; delete row.pricing.ratesNano.inputImage; delete row.maximumQuantities.inputImage; });
        if (audio) { const result = await f.native.transcribe({ ledger: f.ledger, scope, context, pcm: Buffer.alloc(3200) }); assert.equal(result.accounting.settledNano, '138000'); }
        else { const call = imageCall(); delete call.request.image; const { requestDigest: _digest, ...descriptor } = call.request; call.request.requestDigest = digest(descriptor); const result = await imageBridge(f).generateWithAccounting(call); assert.equal(result.accounting.settledNano, '9750'); }
        assert.match([...f.rows.values()].find(value => value.reservationId).pricing.versionId, /native-audio-v1$/);
    }
    let f; f = fixture(imageResponse(), () => { const row = [...f.rows.values()].find(value => value.reservationId); delete row.pricing.ratesNano.inputImage; delete row.maximumQuantities.inputImage; });
    await assert.rejects(imageBridge(f).generate(imageCall()), { code: 'UNSUPPORTED_BILLING_CATEGORY' }); assert.equal([...f.rows.values()].find(value => value.reservationId).state, 'usage_unknown');
});
