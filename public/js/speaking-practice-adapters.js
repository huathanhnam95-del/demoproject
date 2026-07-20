/**
 * Speaking Practice Adapters — Mode Registration
 * Each adapter registers a configuration describing the mode's capabilities
 * with SpeakingPracticeController.
 *
 * Adapters are added incrementally per migration wave.
 * Wave 0: No production adapters (test-only synthetic adapter in browser tests)
 * Wave 1: RTS, ASQ
 * Wave 2: Describe Image, Retell Lecture
 * Wave 3A: SGD
 * Wave 3B: Repeat Sentence (Speak)
 * Wave 4: Read Aloud (3 sub-gates)
 */
(function () {
  'use strict';

  // Guard: controller must be loaded first
  if (!window.SpeakingPracticeController) {
    console.warn('[SPC Adapters] SpeakingPracticeController not found. Skipping adapter registration.');
    return;
  }

  // Adapters will be added here per wave.
  // Each adapter calls: window.SpeakingPracticeController.register({ ... });

})();
