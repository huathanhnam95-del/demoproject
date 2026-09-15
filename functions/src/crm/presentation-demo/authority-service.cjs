'use strict';

const crypto = require('node:crypto');
const { AuthoritativeRuntime } = require('./runtime.cjs');
const { assertActiveIdentity } = require('./identity.cjs');
const { fail, assertOperationEnabled } = require('./contracts.cjs');
const { roomState } = require('./authority-store.cjs');
const LEASE_MS = 15000, RENEW_MS = 5000, TICK_MS = 100, MAX_INBOX = 64, MAX_RECEIPTS = 512;
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
    return value;
}
const hash = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function requestHash(request) { return hash({ kind: request.kind, id: request.id, uid: request.identity.uid, seatId: request.seatId, generation: request.kind === 'input' ? undefined : request.generation, command: request.command, replaceExisting: request.replaceExisting }); }
function validateActor(room, request, receipt = null, now = Date.now()) {
    const identity = assertActiveIdentity(request.identity), slot = room.slots[request.seatId];
    if (!slot || slot.uid !== identity.uid) fail('ACTOR_MISMATCH');
    if (slot.role === 'presenter' && !identity.isAdmin) fail('PRESENTER_ONLY');
    const generation = request.kind === 'connect' ? receipt?.result?.generation : request.generation;
    if (generation !== undefined && (slot.connectionGeneration !== generation || !slot.connected || now - slot.lastSeenAt > 20000)) fail('STALE_CONNECTION');
}

function createRoomAuthority({ store, gatewayId = crypto.randomUUID(), clock = Date.now, autoStart = true, runtimeFactory = room => new AuthoritativeRuntime(room, { clock }), beforeCommit = null } = {}) {
    if (!store) throw new TypeError('authority store required');
    const watched = new Map(), pumps = new Map(), mirrors = new Map(), wake = new Set(), waiters = new Set();
    let closed = false;
    const metrics = { transactions: 0, transactionCallbacks: 0, reducedCommands: 0, commits: 0, rejected: 0, mirrorFailures: 0, maxStateBytes: 0, maxInbox: 0 };

    async function transaction(id, update) {
        metrics.transactions++;
        return store.transact(id, value => { metrics.transactionCallbacks++; return update(value); });
    }
    async function watch(id) {
        if (closed) fail('AUTHORITY_CLOSED');
        if (watched.has(id)) return;
        await store.ensure(id);
        if (!watched.has(id)) watched.set(id, store.onInbox(id, () => { pump(id).catch(error => { metrics.lastError = { code: error.code || null, message: error.message }; }); }));
    }
    async function runPump(id) {
        if (closed || process.env.PRESENTATION_DEMO_MUTATIONS_ENABLED === '0') return;
        let now = clock();
        const claim = await transaction(id, room => {
            if (!room || room.lifecycle === 'ended') return undefined;
            const owner = room.owner;
            if (owner.gatewayId && owner.gatewayId !== gatewayId && owner.leaseUntil > now) return undefined;
            if (owner.gatewayId === gatewayId && owner.leaseUntil - now > LEASE_MS - RENEW_MS) return undefined;
            room.owner = { gatewayId, ownerEpoch: owner.ownerEpoch + (owner.gatewayId !== gatewayId ? 1 : 0), leaseUntil: now + LEASE_MS };
            return room;
        });
        if (claim.value?.lifecycle === 'ended') {
            // Persist the final outbox before releasing this room's listeners.
            // A failed mirror keeps the watch so a later tick can retry it.
            if (mirrors.get(id)?.running) return;
            await store.mirror(id, claim.value);
            watched.get(id)?.(); watched.delete(id); mirrors.delete(id);
            return;
        }
        const owner = claim.value?.owner;
        if (!owner || owner.gatewayId !== gatewayId || owner.leaseUntil <= now || claim.value.lifecycle === 'ended') return;
        if (autoStart && claim.value.lastTickAt && now > claim.value.lastTickAt && now - claim.value.lastTickAt < TICK_MS) {
            await new Promise(resolve => setTimeout(resolve, TICK_MS - (now - claim.value.lastTickAt)));
            if (closed) return;
        }
        if (beforeCommit) await beforeCommit({ roomId: id, owner: structuredClone(owner) });
        // Fence against the time after a suspended process resumes. A lease
        // valid before an await is not permission to commit after it expires.
        now = clock();
        let reduced = 0;
        const committed = await transaction(id, current => {
            reduced = 0;
            // The callback may be retried after async owner work. Re-read the
            // in-process kill switch at every canonical commit attempt.
            if (process.env.PRESENTATION_DEMO_MUTATIONS_ENABLED === '0') return undefined;
            if (!current || current.owner.gatewayId !== gatewayId || current.owner.ownerEpoch !== owner.ownerEpoch || current.owner.leaseUntil <= now) return undefined;
            if (current.lifecycle === 'ended') return undefined;
            const inbox = { ...(current._inbox || {}) }, receipts = { ...(current._receipts || {}) };
            const runtime = runtimeFactory(roomState(current));
            runtime.tick(now);
            if (runtime.room.expiresAt <= now) {
                runtime.room.lifecycle = 'ended'; runtime.room.endedAt = now; runtime.room.endReason = 'expired'; runtime.room.archiveStatus = 'pending';
            }
            for (const [key, request] of Object.entries(inbox).slice(0, 32)) {
                if (Object.keys(receipts).length >= MAX_RECEIPTS && !receipts[key]) break;
                const receipt = { requestHash: request.requestHash, at: now, uid: request.identity.uid, generation: request.generation ?? null };
                const before = runtime.rawState();
                try {
                    validateActor(runtime.room, request, receipts[key], now);
                    if (receipts[key]) {
                        if (receipts[key].requestHash !== request.requestHash) fail('COMMAND_RECEIPT_CONFLICT');
                        delete inbox[key]; continue;
                    }
                    if (runtime.room.lifecycle === 'ended') fail('ROOM_ENDED');
                    let result;
                    if (request.kind === 'connect') {
                        result = runtime.connect(request.seatId, null, { replaceExisting: request.replaceExisting === true, now });
                        runtime.markBootstrap(request.seatId, now);
                    } else if (request.kind === 'heartbeat') result = runtime.heartbeat(request.seatId, request.generation, now);
                    else if (request.kind === 'disconnect') { runtime.setPresence(request.seatId, false, now, request.generation); result = { accepted: true }; }
                    else if (request.kind === 'input') {
                        // Movement lifetime starts at trusted server receipt,
                        // not after mailbox/owner contention. Discrete actions
                        // remain evaluated at their canonical reduction time.
                        const inputAt = request.command?.type === 'move' && Number.isFinite(request.queuedAt) ? request.queuedAt : now;
                        result = runtime.command(request.seatId, request.generation, request.command, inputAt);
                    }
                    else fail('COMMAND_TYPE_FORBIDDEN');
                    const { snapshot, gameplay, ...compact } = result;
                    receipt.ok = true; receipt.result = compact; reduced++;
                } catch (error) {
                    runtime.refreshRoom(before);
                    receipt.ok = false; receipt.error = { code: error.code || 'COMMAND_REJECTED', message: error.message || 'Command rejected' };
                }
                receipts[key] = receipt; delete inbox[key];
            }
            const next = runtime.rawState();
            next._inbox = inbox; next._receipts = receipts;
            if (Buffer.byteLength(JSON.stringify(next)) > 65536) fail('RATE_LIMITED', 'The room command queue is full. Retry shortly.');
            return next;
        });
        if (committed.committed) {
            metrics.commits++; metrics.reducedCommands += reduced;
            metrics.maxStateBytes = Math.max(metrics.maxStateBytes, Buffer.byteLength(JSON.stringify(committed.value)));
            if (!mirrors.get(id)?.running && (!mirrors.has(id) || now - mirrors.get(id).at >= 500)) {
                const mirror = { at: now, running: true };
                const pending = store.mirror(id, committed.value).then(async () => {
                    // A receipt is only removed after its durable archive has
                    // succeeded. Failed mirrors apply bounded backpressure.
                    await transaction(id, value => {
                        if (!value) return undefined;
                        for (const [key, receipt] of Object.entries(committed.value._receipts || {})) {
                            if (receipt.at < now - 1000 && value._receipts?.[key]?.requestHash === receipt.requestHash) delete value._receipts[key];
                        }
                        return value;
                    });
                }).catch(() => { metrics.mirrorFailures++; }).finally(() => { mirror.running = false; });
                mirror.pending = pending;
                mirrors.set(id, mirror);
            }
        }
    }
    function pump(id) {
        if (pumps.has(id)) { wake.add(id); return pumps.get(id); }
        const pending = (async () => {
            do { wake.delete(id); await runPump(id); } while (!closed && wake.has(id));
        })().finally(() => pumps.delete(id));
        pumps.set(id, pending); return pending;
    }
    async function submit(id, request) {
        assertOperationEnabled('mutation');
        assertActiveIdentity(request.identity);
        if (!/^[A-Za-z0-9:_-]{1,128}$/.test(request.id || '') || Buffer.byteLength(JSON.stringify(request)) > 8192) fail('COMMAND_INVALID');
        await watch(id);
        const key = hash([request.identity.uid, request.id]), payloadHash = requestHash(request);
        const archived = await store.readReceipt(id, key);
        const queuedAt = clock();
        let replay = null, failure = null;
        const queued = await transaction(id, room => {
            replay = null; failure = null;
            try {
                if (!room) fail('ROOM_NOT_FOUND');
                const receipt = room._receipts?.[key] || archived;
                validateActor(room, request, receipt, queuedAt);
                if (receipt) {
                    if (receipt.requestHash !== payloadHash) fail('COMMAND_RECEIPT_CONFLICT');
                    replay = receipt; return undefined;
                }
                if (room.lifecycle === 'ended' || room.expiresAt <= queuedAt) fail('ROOM_ENDED');
                room._inbox ||= {};
                if (room._inbox[key] && room._inbox[key].requestHash !== payloadHash) fail('COMMAND_RECEIPT_CONFLICT');
                if (!room._inbox[key] && Object.keys(room._inbox).length >= MAX_INBOX) fail('RATE_LIMITED');
                room._inbox[key] = { ...structuredClone(request), requestHash: payloadHash, queuedAt };
                if (Buffer.byteLength(JSON.stringify(room)) > 65536) fail('RATE_LIMITED');
                return room;
            } catch (error) { failure = error; return undefined; }
        });
        if (failure) throw failure;
        if (replay) return unwrap(replay);
        metrics.maxInbox = Math.max(metrics.maxInbox, Object.keys(queued.value?._inbox || {}).length);
        // Wait for this command's committed receipt, never for a background
        // ticker to become idle while other players are producing input.
        pump(id).catch(error => { metrics.lastError = { code: error.code || null, message: error.message }; });
        return waitForResult(id, key);
    }
    function unwrap(receipt) {
        if (!receipt.ok) throw Object.assign(new Error(receipt.error.message), { code: receipt.error.code });
        return structuredClone(receipt.result);
    }
    function waitForResult(id, key) {
        return new Promise((resolve, reject) => {
            let settled = false, reading = false, changed = false;
            let stop = () => {}, timer, poll;
            const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); clearInterval(poll); stop(); waiters.delete(cancel); error ? reject(error) : resolve(value); };
            const cancel = () => finish(Object.assign(new Error('Authority is shutting down; retry the same operation.'), { code: 'OUTCOME_UNKNOWN' }));
            const check = async () => {
                if (settled) return;
                try { assertOperationEnabled('mutation'); }
                catch (error) { finish(error); return; }
                if (reading) { changed = true; return; } reading = true;
                try {
                    do {
                        changed = false;
                        const receipt = await store.readReceipt(id, key);
                        if (receipt) finish(null, unwrap(receipt));
                    } while (changed && !settled);
                }
                catch (error) { finish(error); }
                finally { reading = false; }
            };
            waiters.add(cancel);
            stop = store.onChange(id, check);
            timer = setTimeout(() => finish(Object.assign(new Error('The committed result is not available yet. Retry the same operation.'), { code: 'OUTCOME_UNKNOWN' })), 20000);
            poll = setInterval(check, 250);
            check();
        });
    }
    const timer = autoStart ? setInterval(() => { for (const id of watched.keys()) pump(id).catch(error => { metrics.lastError = { code: error.code || null, message: error.message }; }); }, TICK_MS) : null;
    timer?.unref();
    function close() { closed = true; clearInterval(timer); for (const stop of watched.values()) stop(); watched.clear(); for (const cancel of waiters) cancel(); }
    async function drain() { await Promise.allSettled([...pumps.values(), ...[...mirrors.values()].map(m => m.pending)]); }
    return { gatewayId, metrics, watch, pump, submit, close, drain };
}

module.exports = { createRoomAuthority, LEASE_MS, TICK_MS, requestHash };
