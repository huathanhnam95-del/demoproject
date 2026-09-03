// Visual Juice layer for Echo Forge — handles physical animation feedback and procedural SFX

export function createEchoForgeJuice({
  root,
  sfx = null,
} = {}) {
  if (!root) throw new Error('root element is required for Echo Forge juice');

  let currentCritTier = 'normal';

  function getFighter(target) {
    return root.querySelector(`.fighter.${target}`);
  }

  function getBattleStage() {
    return root.querySelector('.battle-stage');
  }

  function spawnDamageNumber(target, damage, tier) {
    const fighter = getFighter(target);
    if (!fighter || !Number.isFinite(damage) || damage <= 0) return;

    const span = document.createElement('span');
    span.className = `ef-dmg ef-dmg--${tier}`;
    span.textContent = `-${damage}`;
    span.setAttribute('aria-hidden', 'true');
    const jitter = Math.round(Math.random() * 28 - 14);
    span.style.marginLeft = `${jitter}px`;

    fighter.appendChild(span);

    const cleanup = () => {
      if (span.parentNode) span.remove();
    };
    span.addEventListener('animationend', cleanup, { once: true });
    setTimeout(cleanup, 950);
  }

  function triggerHitReaction(target, isCritOrBurst) {
    const fighter = getFighter(target);
    if (fighter) {
      fighter.classList.remove('ef-hit-flash', 'ef-recoil');
      void fighter.offsetWidth;
      fighter.classList.add('ef-hit-flash', 'ef-recoil');

      const clear = () => {
        fighter.classList.remove('ef-hit-flash', 'ef-recoil');
      };
      fighter.addEventListener('animationend', clear, { once: true });
      setTimeout(clear, 300);
    }

    const stage = getBattleStage();
    if (stage && (target === 'hero' || isCritOrBurst)) {
      stage.classList.remove('ef-shake');
      void stage.offsetWidth;
      stage.classList.add('ef-shake');
      const clearShake = () => stage.classList.remove('ef-shake');
      stage.addEventListener('animationend', clearShake, { once: true });
      setTimeout(clearShake, 350);
    }
  }

  function updateGhostBars() {
    const heroProgress = root.querySelector('#hero-hp');
    const heroGhost = root.querySelector('#hero-hp-ghost');
    if (heroProgress && heroGhost) {
      const heroMax = Number(heroProgress.max) || 100;
      const heroVal = Number(heroProgress.value) || 0;
      const heroPct = Math.max(0, Math.min(100, (heroVal / heroMax) * 100));
      heroGhost.style.width = `${heroPct}%`;

      const heroMeter = root.querySelector('.hero-meter');
      if (heroMeter) {
        if (heroVal / heroMax <= 0.25) {
          heroMeter.classList.add('ef-low-hp');
        } else {
          heroMeter.classList.remove('ef-low-hp');
        }
      }
    }

    const enemyProgress = root.querySelector('#enemy-hp');
    const enemyGhost = root.querySelector('#enemy-hp-ghost');
    if (enemyProgress && enemyGhost) {
      const enemyMax = Number(enemyProgress.max) || 120;
      const enemyVal = Number(enemyProgress.value) || 0;
      const enemyPct = Math.max(0, Math.min(100, (enemyVal / enemyMax) * 100));
      enemyGhost.style.width = `${enemyPct}%`;
    }
  }

  function handleEvent(customEvent) {
    const detail = customEvent.detail || {};
    const type = detail.type;
    const payload = detail.payload || {};

    switch (type) {
      case 'player.attack.resolved': {
        if (payload.burstApplied) {
          currentCritTier = 'burst';
        } else if (payload.score >= 95) {
          currentCritTier = 'crit';
        } else if (payload.score >= 80) {
          currentCritTier = 'strong';
        } else {
          currentCritTier = 'normal';
        }
        break;
      }

      case 'analysis.pending': {
        const hero = getFighter('hero');
        if (hero) {
          hero.classList.remove('ef-windup', 'ef-lunge');
          void hero.offsetWidth;
          hero.classList.add('ef-windup');
          setTimeout(() => {
            hero.classList.remove('ef-windup');
            hero.classList.add('ef-lunge');
            setTimeout(() => hero.classList.remove('ef-lunge'), 260);
          }, 200);
        }
        break;
      }

      case 'combat.damage.applied': {
        const target = payload.target;
        const damage = payload.damage;
        const tier = target === 'enemy' ? currentCritTier : 'normal';
        const isCrit = tier === 'crit' || tier === 'burst';

        spawnDamageNumber(target, damage, tier);
        triggerHitReaction(target, isCrit);
        updateGhostBars();

        if (sfx) {
          if (target === 'enemy') {
            if (tier === 'burst') sfx.play('burst');
            else if (tier === 'crit') sfx.play('crit');
            else sfx.play('hit');
          } else {
            sfx.play('hit');
          }
        }
        break;
      }

      case 'player.block.resolved': {
        sfx?.play('block');
        updateGhostBars();
        break;
      }

      case 'player.parry.resolved': {
        sfx?.play('parry');
        updateGhostBars();
        break;
      }

      case 'combat.focus.changed': {
        sfx?.play('focusGain');
        break;
      }

      case 'combat.resonance.ready': {
        sfx?.play('resonanceReady');
        break;
      }

      case 'combat.victory': {
        sfx?.play('victory');
        break;
      }

      case 'combat.defeat': {
        sfx?.play('defeat');
        break;
      }

      case 'combat.started': {
        currentCritTier = 'normal';
        updateGhostBars();
        break;
      }

      default:
        break;
    }
  }

  root.addEventListener('echo-forge:event', handleEvent);

  function dispose() {
    root.removeEventListener('echo-forge:event', handleEvent);
  }

  return Object.freeze({
    handleEvent,
    updateGhostBars,
    dispose,
  });
}
