// Unit tests for Scoped Content Disclosure Selectors (Phase 04 / P04.1)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getDisclosedRouteSections,
  getDisclosedPortrait,
  getDisclosedBridgeReview,
  getDisclosedObjectives,
  canStartPresentation
} from '../../public/prototypes/bel-working-as-equals-demo/content/disclosure.mjs';
import { HEADINGS } from '../../public/prototypes/bel-working-as-equals-demo/content/source.mjs';

const mockSource = {
  routes: {
    B1: {
      slide: 4,
      title: 'B1 Route Title',
      sections: ['B1 Thought text', 'B1 Why text', 'B1 Shift text']
    }
  },
  gallery: [
    {
      name: 'Chet Faliszek',
      slide: 10,
      image: 'images/chet.jpg',
      quote: 'Quote here',
      paragraphs: ['Para 1'],
      attribution: 'Attribution here'
    }
  ],
  objectives: [
    { title: 'Objective 1 Title', detail: 'Objective 1 Detail' },
    { title: 'Objective 2 Title', detail: 'Objective 2 Detail' },
    { title: 'Objective 3 Title', detail: 'Objective 3 Detail' }
  ]
};

test('P04.1: getDisclosedRouteSections hides unplaced text and discloses placed text', () => {
  const world = {
    routes: {
      B1: [
        { placed: true },
        { placed: false },
        { placed: false }
      ]
    }
  };

  const sections = getDisclosedRouteSections(world, 'B1', mockSource);
  assert.equal(sections.length, 3);
  assert.equal(sections[0].placed, true);
  assert.equal(sections[0].text, 'B1 Thought text');
  assert.equal(sections[0].heading, HEADINGS[0]);

  // Unplaced section must NOT disclose text
  assert.equal(sections[1].placed, false);
  assert.equal(sections[1].text, null);
  assert.equal(sections[2].placed, false);
  assert.equal(sections[2].text, null);
});

test('P04.1: getDisclosedPortrait returns exact gallery data', () => {
  const portrait = getDisclosedPortrait(0, mockSource);
  assert.equal(portrait.name, 'Chet Faliszek');
  assert.equal(portrait.slide, 10);
  assert.equal(portrait.quote, 'Quote here');
  assert.equal(portrait.attribution, 'Attribution here');

  // Out of bounds returns null
  assert.equal(getDisclosedPortrait(99, mockSource), null);
});

test('P04.1: getDisclosedBridgeReview reveals only earned pairs', () => {
  assert.deepEqual(getDisclosedBridgeReview({ bridge: { placed: 0 } }), []);
  assert.deepEqual(getDisclosedBridgeReview({ bridge: { placed: 1 } }), []);

  const twoPlaced = getDisclosedBridgeReview({ bridge: { placed: 2 } });
  assert.equal(twoPlaced.length, 1);
  assert.equal(twoPlaced[0].index, 0);
  assert.equal(twoPlaced[0].planks.length, 2);

  const sixPlaced = getDisclosedBridgeReview({ bridge: { placed: 6 } });
  assert.equal(sixPlaced.length, 3);
});

test('P04.1: getDisclosedObjectives strictly withholds unmatched objective details', () => {
  const world = {
    cubes: {
      pairs: [true, false, true]
    }
  };

  const disclosed = getDisclosedObjectives(world, mockSource);
  assert.equal(disclosed.length, 3);

  // Pair 0 matched -> disclosed
  assert.equal(disclosed[0].matched, true);
  assert.equal(disclosed[0].detail, 'Objective 1 Detail');

  // Pair 1 NOT matched -> detail must be null
  assert.equal(disclosed[1].matched, false);
  assert.equal(disclosed[1].detail, null);

  // Pair 2 matched -> disclosed
  assert.equal(disclosed[2].matched, true);
  assert.equal(disclosed[2].detail, 'Objective 3 Detail');
});

test('P04.1: canStartPresentation validates presenter authority and participant readiness', () => {
  const session = {
    players: {
      p0: { id: 'p0', name: 'Minh', connected: true, ready: true },
      p1: { id: 'p1', name: 'Lan', connected: true, ready: true },
      p2: { id: 'p2', name: 'Mai', connected: true, ready: true },
      p3: { id: 'p3', name: 'An', connected: true, ready: true }
    }
  };

  const worldAllInA = {
    players: {
      p0: { scene: 'A' },
      p1: { scene: 'A' },
      p2: { scene: 'A' },
      p3: { scene: 'A' }
    }
  };

  // p0 can start in A when everyone is present
  assert.equal(canStartPresentation(worldAllInA, session, 'A', 'p0').allowed, true);

  // p1 cannot start (presenter authority lock)
  assert.equal(canStartPresentation(worldAllInA, session, 'A', 'p1').allowed, false);

  // Missing player in room blocks start
  const worldMissingInA = {
    players: {
      p0: { scene: 'A' },
      p1: { scene: 'A' },
      p2: { scene: 'reception' },
      p3: { scene: 'A' }
    }
  };
  const checkMissing = canStartPresentation(worldMissingInA, session, 'A', 'p0');
  assert.equal(checkMissing.allowed, false);
  assert.ok(checkMissing.reason.includes('Mai'));

  // In room J, all 3 cube pairs must be completed
  const worldInJIncomplete = {
    players: {
      p0: { scene: 'J' },
      p1: { scene: 'J' },
      p2: { scene: 'J' },
      p3: { scene: 'J' }
    },
    cubes: {
      pairs: [true, true, false]
    }
  };
  assert.equal(canStartPresentation(worldInJIncomplete, session, 'J', 'p0').allowed, false);

  worldInJIncomplete.cubes.pairs[2] = true;
  assert.equal(canStartPresentation(worldInJIncomplete, session, 'J', 'p0').allowed, true);
});
