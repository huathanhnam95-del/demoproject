import assert from 'node:assert/strict';

import SurvivalGame from '../public/js/survival-game/SurvivalGame.js';

console.log('Starting survival modal typing tests...');

assert.equal(typeof SurvivalGame.prototype.handleModalTyping, 'function', 'modal typing handler should exist');

{
  let continueCount = 0;
  const state = {
    modalInput: '',
    modalInputTimer: 0
  };

  for (const ch of 'Continue') {
    SurvivalGame.prototype.handleModalTyping.call(state, ch, {
      CONTINUE: () => {
        continueCount += 1;
      }
    });
  }

  assert.equal(continueCount, 1, 'typing Continue should close the tutorial without clicking');
  assert.equal(state.modalInput, '', 'command input should reset after completing the word');
}

console.log('survival modal typing tests passed');
