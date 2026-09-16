// Screen-Space Activity HUD Overlay (Phase 04 / P04.4)
// Provides clean, non-blocking operational prompts, timers, and debuff alerts.
// Keeps educational source text strictly in accessible HTML modals (C27).

import { QUESTIONS } from '../activities/reversal.mjs';

export function createActivityHud(container) {
  let hud = container.querySelector('#activity-hud');
  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'activity-hud';
    hud.className = 'activity-hud';
    container.appendChild(hud);
  }

  return {
    update({ world, base, actor }) {
      if (!world?.players || !base?.players) {
        hud.hidden = true;
        return;
      }

      const me = world.players[actor];
      if (!me) {
        hud.hidden = true;
        return;
      }

      hud.hidden = false;
      let content = '';

      // Room F Bridge HUD
      if (me.scene === 'F') {
        const bridge = world.bridge;
        const phaseLabels = {
          gathering: 'Waiting for group',
          preparation: 'Preparation',
          attempt: 'Team attempt',
          review: 'Team review',
          complete: bridge.assisted ? 'Bridge complete (assisted)' : 'Bridge complete'
        };
        const timeStr = ['gathering', 'complete'].includes(bridge.phase)
          ? ''
          : ` ${String(Math.floor(Math.ceil(bridge.remaining / 1000) / 60)).padStart(2, '0')}:${String(Math.ceil(bridge.remaining / 1000) % 60).padStart(2, '0')}`;

        content = `
          <div class="hud-bar bridge-hud">
            <span class="hud-badge ${bridge.phase}">${phaseLabels[bridge.phase] || bridge.phase}${timeStr ? ' · ' + timeStr : ''}</span>
            <span class="hud-placed">Planks: ${bridge.placed} / 6</span>
            ${me.carry ? `<span class="hud-carry">Carrying ${me.carry}</span>` : ''}
          </div>
        `;
      }
      // Room I Reversal HUD
      else if (me.scene === 'I') {
        const r = world.reversal;
        const q = QUESTIONS[r.index];
        const phaseLabels = {
          gathering: 'Gathering',
          opening: 'Read prompt',
          choice: 'Choose Do or Don\'t',
          interval: 'Feedback',
          complete: 'Activity complete'
        };
        const timeStr = ['gathering', 'complete'].includes(r.phase)
          ? ''
          : ` 00:${String(Math.ceil(r.remaining / 1000)).padStart(2, '0')}`;

        const debuff = r.debuffs?.[actor] || 0;
        const statementText = r.phase === 'gathering'
          ? 'Move to choose. Read the whole sentence before the choice timer ends.'
          : r.phase === 'opening'
          ? (q ? q[0].replace(/,$/, '…') : '')
          : (q ? q[0] + ' ' + q[1] : '');

        content = `
          <div class="hud-bar reversal-hud">
            <div class="hud-row">
              <span class="hud-badge ${r.phase}">${phaseLabels[r.phase] || r.phase}${timeStr ? ' · ' + timeStr : ''}</span>
              ${debuff > 0 ? `<span class="hud-debuff" role="alert">⚠️ Reversed controls: 00:${String(Math.ceil(debuff / 1000)).padStart(2, '0')}</span>` : ''}
            </div>
            ${statementText ? `<div class="hud-statement">${statementText}</div>` : ''}
          </div>
        `;
      }
      // Room J Cubes HUD
      else if (me.scene === 'J') {
        const cubes = world.cubes;
        const completed = cubes.pairs.filter(Boolean).length;
        content = `
          <div class="hud-bar cube-hud">
            <span class="hud-badge">Matched: ${completed} / 3 pairs</span>
            ${me.carry ? `<span class="hud-carry">Carrying cube</span>` : ''}
          </div>
        `;
      } else {
        hud.hidden = true;
        return;
      }

      hud.innerHTML = content;
    },
    clear() {
      hud.innerHTML = '';
      hud.hidden = true;
    }
  };
}
