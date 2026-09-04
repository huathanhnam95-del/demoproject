// @ts-check

/**
 * Stage scene controller for Echo Forge.
 *
 * Listens to `echo-forge:run` and `echo-forge:event` to drive pure DOM stage presentation:
 * - Parallax camera sway via `--ef-par-x` on `.battle-stage`
 * - Act title card entry and dismissal on `run.act.entered`
 * - Synchronization of `document.body.dataset.stage`
 */

export const ACT_TITLES = Object.freeze([
  { badge: 'ACT I', title: 'THE RESONANT HALL', stageId: 'resonant_hall' },
  { badge: 'ACT II', title: 'THE CINDER FORGE', stageId: 'cinder_forge' },
  { badge: 'ACT III', title: 'THE VOID BENEATH', stageId: 'void_beneath' },
]);

export function createEchoForgeScene({
  root = document.querySelector('#echo-forge-root'),
  documentRef = document,
  windowRef = (typeof window !== 'undefined' ? window : null),
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  const stageEl = root?.querySelector('.battle-stage');
  const titleCard = root?.querySelector('#ef-act-title-card');
  const badgeEl = root?.querySelector('#ef-act-badge');
  const titleEl = root?.querySelector('#ef-act-title');

  let titleCardTimer = null;
  let titleCardLeaveTimer = null;
  let parallaxTimer = null;

  function prefersReducedMotion() {
    return !!windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  }

  function clearTimers() {
    if (titleCardTimer) {
      clearTimeoutImpl(titleCardTimer);
      titleCardTimer = null;
    }
    if (titleCardLeaveTimer) {
      clearTimeoutImpl(titleCardLeaveTimer);
      titleCardLeaveTimer = null;
    }
    if (parallaxTimer) {
      clearTimeoutImpl(parallaxTimer);
      parallaxTimer = null;
    }
  }

  function setParallaxOffset(xPx, returnDelayMs = 0) {
    if (!stageEl) return;
    if (parallaxTimer) {
      clearTimeoutImpl(parallaxTimer);
      parallaxTimer = null;
    }

    const effectivePx = prefersReducedMotion() ? 0 : xPx;
    stageEl.style.setProperty('--ef-par-x', `${effectivePx}px`);

    if (returnDelayMs > 0 && effectivePx !== 0) {
      parallaxTimer = setTimeoutImpl(() => {
        if (stageEl) {
          stageEl.style.setProperty('--ef-par-x', '0px');
        }
        parallaxTimer = null;
      }, returnDelayMs);
    }
  }

  function hideActTitleCard() {
    if (!titleCard) return;
    if (titleCardTimer) {
      clearTimeoutImpl(titleCardTimer);
      titleCardTimer = null;
    }
    if (titleCardLeaveTimer) {
      clearTimeoutImpl(titleCardLeaveTimer);
      titleCardLeaveTimer = null;
    }
    titleCard.hidden = true;
    titleCard.classList.remove('ef-title-enter', 'ef-title-leave');
  }

  function showActTitleCard(actIndex) {
    if (!titleCard) return;
    const actMeta = ACT_TITLES[actIndex] || ACT_TITLES[0];
    if (badgeEl) badgeEl.textContent = actMeta.badge;
    if (titleEl) titleEl.textContent = actMeta.title;

    hideActTitleCard();

    titleCard.hidden = false;
    titleCard.classList.add('ef-title-enter');

    // Auto-dismiss after 2.4s
    titleCardTimer = setTimeoutImpl(() => {
      titleCard.classList.remove('ef-title-enter');
      titleCard.classList.add('ef-title-leave');
      titleCardLeaveTimer = setTimeoutImpl(() => {
        titleCard.hidden = true;
        titleCard.classList.remove('ef-title-leave');
        titleCardLeaveTimer = null;
      }, 400);
      titleCardTimer = null;
    }, 2400);
  }

  function handleRunEvent(event) {
    const detail = event?.detail || {};
    const type = detail.type;
    const payload = detail.payload || {};

    if (type === 'run.act.entered') {
      const actIndex = Number.isInteger(payload.act) ? payload.act : 0;
      const actMeta = ACT_TITLES[actIndex] || ACT_TITLES[0];
      if (documentRef?.body) {
        documentRef.body.dataset.stage = actMeta.stageId;
      }
      showActTitleCard(actIndex);
      setParallaxOffset(0);
    } else if (type === 'run.started') {
      setParallaxOffset(0);
    } else if (type === 'run.abandoned' || type === 'run.completed') {
      hideActTitleCard();
      setParallaxOffset(0);
    }
  }

  function handleCombatEvent(event) {
    const detail = event?.detail || {};
    const type = detail.type;

    if (type === 'player.attack.resolved') {
      // Subtle lunge forward parallax with 400ms return
      setParallaxOffset(12, 400);
    } else if (type === 'enemy.intent.presented') {
      // Slight tension sway with 500ms return
      setParallaxOffset(-8, 500);
    } else if (type === 'combat.damage.applied') {
      // Impact shake response with 300ms return
      setParallaxOffset(detail.target === 'hero' ? -10 : 10, 300);
    }
  }

  if (root) {
    root.addEventListener('echo-forge:run', handleRunEvent);
    root.addEventListener('echo-forge:event', handleCombatEvent);
  }

  function reset() {
    clearTimers();
    hideActTitleCard();
    if (stageEl) {
      stageEl.style.setProperty('--ef-par-x', '0px');
    }
  }

  return {
    showActTitleCard,
    setParallaxOffset,
    reset,
    destroy() {
      reset();
      if (root) {
        root.removeEventListener('echo-forge:run', handleRunEvent);
        root.removeEventListener('echo-forge:event', handleCombatEvent);
      }
    },
  };
}
