import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../../functions/src/crm/presentation-demo/core/state/session.mjs';
import { createWorld, stepWorld } from '../../functions/src/crm/presentation-demo/core/world/simulation.mjs';
import { SCENES, entry } from '../../functions/src/crm/presentation-demo/core/world/scenes.mjs';
import { bridgeReady, createBridge } from '../../functions/src/crm/presentation-demo/core/activities/bridge.mjs';
import { choiceReady, createReversal } from '../../functions/src/crm/presentation-demo/core/activities/reversal.mjs';

test('authoritative core preserves scene identities, private Homes and deterministic entry positions', () => {
    let tokenIndex = 0;
    const session = createSession({ id: 'online-core-test', tokenFactory: () => `${++tokenIndex}${'x'.repeat(32)}` });
    const world = createWorld(session.state);
    assert.deepEqual(Object.keys(SCENES).slice(0, 3), ['home', 'street', 'reception']);
    assert.equal(world.players.p1.instance, 'home:p1');
    assert.notDeepEqual(entry('A', 'p1', 'B1'), entry('A', 'p2', 'B1'));
});

test('legacy all-player activity helpers remain explicit and are wrapped by online disconnect policy', () => {
    let tokenIndex = 0;
    const session = createSession({ id: 'online-core-test', tokenFactory: () => `${++tokenIndex}${'x'.repeat(32)}` });
    const world = createWorld(session.state);
    const bridge = createBridge();
    const reversal = createReversal();
    assert.equal(bridgeReady(world, session.state), false);
    assert.equal(choiceReady(world, session.state), false);
    const next = structuredClone(world);
    stepWorld(next, session.state, {}, 0.033, 1000);
    assert.equal(next.revision, world.revision);
});
