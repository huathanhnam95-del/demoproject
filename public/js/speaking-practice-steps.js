/**
 * Shared Speaking practice step preview.
 *
 * The component is intentionally presentational: mode adapters provide the
 * ordered labels, while the controller owns placement and lifecycle.
 */
(function () {
  'use strict';

  function normalizeStep(step) {
    if (typeof step === 'string') return { label: step };
    return {
      label: String(step?.label || ''),
      id: step?.id ? String(step.id) : ''
    };
  }

  function clampIndex(index, count) {
    const value = Number.isFinite(Number(index)) ? Number(index) : 0;
    return Math.max(0, Math.min(count - 1, Math.trunc(value)));
  }

  function create(options = {}) {
    const modeId = String(options.modeId || 'speaking');
    const steps = (options.steps || []).map(normalizeStep).filter((step) => step.label);
    if (!steps.length) return null;

    const root = document.createElement('nav');
    root.className = 'spc-steps';
    root.id = `spc-steps-${modeId}`;
    root.dataset.spcStepsMode = modeId;
    root.setAttribute('aria-label', 'Practice steps');

    const list = document.createElement('ol');
    list.className = 'spc-steps__list';
    list.setAttribute('aria-label', 'Practice flow');

    const items = [];
    steps.forEach((step, index) => {
      if (index > 0) {
        const connector = document.createElement('li');
        connector.className = 'spc-step-connector';
        connector.setAttribute('aria-hidden', 'true');
        list.appendChild(connector);
      }

      const item = document.createElement('li');
      item.className = 'spc-step';
      item.dataset.spcStep = String(index);
      if (step.id) item.dataset.stepId = step.id;

      const marker = document.createElement('span');
      marker.className = 'spc-step__marker';
      marker.setAttribute('aria-hidden', 'true');
      marker.textContent = String(index + 1);

      const label = document.createElement('span');
      label.className = 'spc-step__label';
      label.textContent = step.label;

      item.appendChild(marker);
      item.appendChild(label);
      list.appendChild(item);
      items.push(item);
    });

    root.appendChild(list);

    let currentIndex = 0;
    function setCurrent(index) {
      currentIndex = clampIndex(index, items.length);
      root.dataset.currentIndex = String(currentIndex);
      items.forEach((item, itemIndex) => {
        const state = itemIndex < currentIndex
          ? 'complete'
          : itemIndex === currentIndex ? 'current' : 'upcoming';
        item.dataset.state = state;
        item.toggleAttribute('aria-current', state === 'current');
        item.setAttribute('aria-label', `${item.querySelector('.spc-step__label')?.textContent || ''}: ${state}`);
      });
    }

    setCurrent(options.currentIndex || 0);
    return {
      element: root,
      setCurrent,
      getCurrent: () => currentIndex,
      stepCount: items.length
    };
  }

  window.SpeakingPracticeSteps = { create };
})();
