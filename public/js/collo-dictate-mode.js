import { countNormalizedWords, derivePhraseFirstCapture, getColloAudioKey, normalizeForCompare } from './collo-dictate-utils.js';

const SPEED_PRESETS = [1.0, 0.9, 0.8];

function pickRandom(list, avoidValue) {
  if (!Array.isArray(list) || list.length === 0) return null;
  if (list.length === 1) return list[0];
  let next = list[Math.floor(Math.random() * list.length)];
  if (!avoidValue) return next;
  for (let i = 0; i < 5 && next === avoidValue; i += 1) {
    next = list[Math.floor(Math.random() * list.length)];
  }
  return next;
}

function extractPhrasesFromCollocations(data) {
  const set = new Set();

  if (!data || typeof data !== 'object') return [];
  for (const [key, value] of Object.entries(data)) {
    if (typeof key === 'string') {
      const trimmed = key.trim();
      if (trimmed) set.add(trimmed);
    }
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (typeof entry !== 'string') continue;
      const trimmed = entry.trim();
      if (trimmed) set.add(trimmed);
    }
  }

  return Array.from(set);
}

function formatPct(n) {
  if (!Number.isFinite(n)) return '0%';
  return `${Math.round(n * 100)}%`;
}

function supportsSpeechSynthesis() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

const ColloDictateMode = (() => {
  /** @type {null | {
   *  panel: HTMLElement,
   *  playBtn: HTMLButtonElement,
   *  checkBtn: HTMLButtonElement,
   *  backBtn: HTMLButtonElement,
   *  nextBtn: HTMLButtonElement,
   *  speedBtn: HTMLButtonElement,
   *  lengthSelect: HTMLSelectElement,
   *  questionIdEl: HTMLElement,
   *  audioIdEl: HTMLElement,
   *  scoreEl: HTMLElement,
   *  statsEl: HTMLElement,
   *  input: HTMLTextAreaElement,
   *  feedback: HTMLElement,
   *  audio: HTMLAudioElement,
   *  searchInput: HTMLInputElement,
   *  searchCountEl: HTMLElement,
   *  searchClearBtn: HTMLButtonElement,
   *  searchHintEl: HTMLElement,
   *  noResultsEl: HTMLElement,
   * }} */
  let els = null;

  let initDone = false;
  let phrases = [];
  let filtered = [];
  let currentPhrase = '';
  let speedIdx = 0;
  let history = /** @type {string[]} */ ([]);
  let historyIndex = -1;
  let playbackSession = 0;

  const stats = {
    attempts: 0,
    correct: 0,
    streak: 0
  };

  let collocationsLoadPromise = null;

  async function checkAudioExists(url) {
    try {
      const response = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
      if (!response.ok) return false;
      const contentType = response.headers.get('content-type') || '';
      return contentType.startsWith('audio/');
    } catch {
      return false;
    }
  }

  function setFeedback(kind, html) {
    if (!els) return;
    els.feedback.style.display = 'block';
    els.feedback.classList.toggle('is-correct', kind === 'correct');
    els.feedback.classList.toggle('is-wrong', kind === 'wrong');
    els.feedback.innerHTML = html;
  }

  function clearFeedback() {
    if (!els) return;
    els.feedback.style.display = 'none';
    els.feedback.classList.remove('is-correct', 'is-wrong');
    els.feedback.textContent = '';
  }

  function updateScoreUI() {
    if (!els) return;
    els.scoreEl.textContent = `Score: ${stats.correct}`;

    const accuracy = stats.attempts > 0 ? stats.correct / stats.attempts : 0;
    els.statsEl.textContent = `Streak: ${stats.streak} • Accuracy: ${formatPct(accuracy)} • Pool: ${filtered.length}`;
  }

  function updateQuestionMetaUI() {
    if (!els) return;
    if (!currentPhrase || historyIndex < 0) {
      els.questionIdEl.textContent = '-';
      els.audioIdEl.textContent = '-';
      return;
    }

    els.questionIdEl.textContent = String(historyIndex + 1);
    const key = getColloAudioKey(currentPhrase);
    els.audioIdEl.textContent = `${key}.wav`;
  }

  function updateNavUI() {
    if (!els) return;
    const hasPool = filtered.length > 0;
    els.nextBtn.disabled = !hasPool;
    els.backBtn.disabled = historyIndex <= 0 || !hasPool;
  }

  function stopPlayback() {
    if (!els) return;
    try {
      els.audio.pause();
      els.audio.currentTime = 0;
    } catch (_err) {
      // Audio pause failure safely ignored
    }

    if (supportsSpeechSynthesis()) {
      try {
        window.speechSynthesis.cancel();
      } catch (_err) {
        // Speech synthesis cancel failure safely ignored
      }
    }
  }

  function invalidatePlayback() {
    playbackSession += 1;
    stopPlayback();
  }

  function applyFilter() {
    if (!els) return;
    const value = String(els.lengthSelect.value || 'any');
    if (value === 'any') {
      filtered = phrases.slice();
    } else {
      const target = Number.parseInt(value, 10);
      if (!Number.isFinite(target) || target <= 0) {
        filtered = phrases.slice();
      } else {
        filtered = phrases.filter((p) => countNormalizedWords(p) === target);
      }
    }

    // Apply search keyword filter on top of length filter
    const searchTerm = normalizeForCompare(els.searchInput?.value || '');
    if (searchTerm) {
      const searchWords = searchTerm.split(' ');
      filtered = filtered.filter((p) => {
        const normalized = normalizeForCompare(p);
        const phraseWords = normalized.split(' ');
        if (searchWords.length > 1) {
          // Multi-word search: use exact substring match
          return normalized.includes(searchTerm);
        }
        // Single-word search: match if any word in the phrase STARTS with the search term
        // So "play" matches "play a role" but NOT "display data"
        return phraseWords.some((w) => w.startsWith(searchTerm));
      });
    }

    // Update search UI
    updateSearchUI(searchTerm);
  }

  function updateSearchUI(searchTerm) {
    if (!els) return;
    const hasSearch = !!searchTerm;

    // Show/hide match count badge
    if (hasSearch) {
      els.searchCountEl.textContent = `${filtered.length} match${filtered.length !== 1 ? 'es' : ''}`;
      els.searchCountEl.classList.add('visible');
    } else {
      els.searchCountEl.classList.remove('visible');
    }

    // Show/hide clear button
    if (els.searchClearBtn) {
      els.searchClearBtn.classList.toggle('visible', hasSearch);
    }

    // Show/hide search hint
    if (els.searchHintEl) {
      els.searchHintEl.classList.toggle('visible', hasSearch);
    }

    // Show/hide no-results message
    els.noResultsEl.style.display = (hasSearch && filtered.length === 0) ? 'block' : 'none';
  }

  async function ensurePhrasesLoaded() {
    if (phrases.length > 0) return phrases;
    if (collocationsLoadPromise) return collocationsLoadPromise;

    collocationsLoadPromise = (async () => {
      if (!els) return [];

      els.statsEl.textContent = 'Loading collocations...';
      els.playBtn.disabled = true;
      els.checkBtn.disabled = true;
      els.backBtn.disabled = true;
      els.nextBtn.disabled = true;
      els.input.disabled = true;

      try {
        const response = await fetch('./collocations.json', { cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        phrases = extractPhrasesFromCollocations(data);

        applyFilter();
        updateScoreUI();

        els.playBtn.disabled = false;
        els.input.disabled = false;
        updateNavUI();
        els.statsEl.textContent = `Ready • Pool: ${filtered.length}`;
        return phrases;
      } catch (error) {
        console.error('[ColloDictate] Failed to load collocations.json:', error);
        setFeedback(
          'wrong',
          `Could not load collocations.json. Please refresh and try again.<br><small>${String(
            error?.message || error
          )}</small>`
        );
        els.statsEl.textContent = 'Load failed';
        return [];
      }
    })();

    return collocationsLoadPromise;
  }

  function setCurrentPhrase(nextPhrase) {
    if (!els) return;
    clearFeedback();
    invalidatePlayback();

    if (filtered.length === 0) {
      const searchTerm = normalizeForCompare(els.searchInput?.value || '');
      const msg = searchTerm
        ? `No collocations found matching "<strong>${els.searchInput.value.trim()}</strong>" with the current filters.`
        : 'No phrases available for the selected length filter.';
      setFeedback('wrong', msg);
      els.input.value = '';
      els.input.disabled = true;
      els.checkBtn.disabled = true;
      els.nextBtn.disabled = true;
      els.backBtn.disabled = true;
      currentPhrase = '';
      history = [];
      historyIndex = -1;
      updateQuestionMetaUI();
      updateScoreUI();
      return;
    }

    currentPhrase = String(nextPhrase || '');
    els.input.value = '';
    els.input.disabled = false;
    els.input.focus();

    els.checkBtn.disabled = true;
    updateNavUI();
    updateQuestionMetaUI();
    updateScoreUI();

    if (window.PracticeRouter && currentPhrase) {
      const audioKey = getColloAudioKey(currentPhrase) || currentPhrase;
      window.PracticeRouter.replaceRoute('collo-dictate', audioKey);
    }
  }

  function goNext() {
    if (filtered.length === 0) {
      setCurrentPhrase('');
      return;
    }

    if (historyIndex >= 0 && historyIndex < history.length - 1) {
      historyIndex += 1;
      setCurrentPhrase(history[historyIndex]);
      return;
    }

    const nextPhrase = pickRandom(filtered, currentPhrase) || '';
    if (!nextPhrase) {
      setCurrentPhrase('');
      return;
    }

    history = history.slice(0, historyIndex + 1);
    history.push(nextPhrase);
    historyIndex = history.length - 1;
    setCurrentPhrase(nextPhrase);
  }

  function goBack() {
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    setCurrentPhrase(history[historyIndex]);
  }

  function speakFallback(phrase) {
    if (!supportsSpeechSynthesis()) {
      setFeedback('wrong', 'Audio file missing and speech synthesis is not supported in this browser.');
      return;
    }

    try {
      const synth = window.speechSynthesis;
      const speakNow = () => {
        synth.cancel();
        const utterance = new SpeechSynthesisUtterance(String(phrase || ''));
        utterance.lang = 'en-US';
        utterance.rate = SPEED_PRESETS[speedIdx] || 1.0;
        utterance.pitch = 1.1;
        utterance.volume = 1;

        // Match the "soft female" voice preference used elsewhere (Type/Speak step-by-step).
        const voices = synth.getVoices?.() || [];
        const preferred = voices.find((v) =>
          /female|samantha|allison|joanna|kimberly|ssml female|en-us/i.test(v.name)
        );
        if (preferred) utterance.voice = preferred;

        synth.speak(utterance);
      };

      // Chrome sometimes needs voices to be loaded before the first speak.
      const voices = synth.getVoices?.() || [];
      if (voices.length > 0) {
        speakNow();
        return;
      }

      let settled = false;
      const handleVoicesChanged = () => {
        if (settled) return;
        settled = true;
        synth.removeEventListener?.('voiceschanged', handleVoicesChanged);
        speakNow();
      };

      if (typeof synth.addEventListener === 'function') {
        synth.addEventListener('voiceschanged', handleVoicesChanged, { once: true });
      } else {
        synth.onvoiceschanged = handleVoicesChanged;
      }

      setTimeout(() => {
        if (settled) return;
        settled = true;
        synth.removeEventListener?.('voiceschanged', handleVoicesChanged);
        speakNow();
      }, 800);
    } catch (e) {
      setFeedback('wrong', `Could not play audio: ${String(e?.message || e)}`);
    }
  }

  async function playCurrent() {
    if (!els) return;
    await ensurePhrasesLoaded();
    applyFilter();
    updateNavUI();

    if (!currentPhrase) goNext();
    if (!currentPhrase) return;

    const phraseAtStart = currentPhrase;
    const key = getColloAudioKey(phraseAtStart);
    const localUrl = `/database/collo-dictate/audio/${key}.wav`;
    let resolvedUrl = localUrl;
    let hasOfflineAudio = false;

    if (window.MediaUrlResolver && typeof window.MediaUrlResolver.resolveAudioUrl === 'function') {
      try {
        const res = await window.MediaUrlResolver.resolveAudioUrl(localUrl, { mode: 'collo-dictate' });
        if (res && res !== localUrl) {
          resolvedUrl = res;
          hasOfflineAudio = true;
        }
      } catch (_err) {
        // Fall back to checkAudioExists
      }
    }

    if (!hasOfflineAudio) {
      hasOfflineAudio = await checkAudioExists(localUrl);
    }

    if (sessionId !== playbackSession || currentPhrase !== phraseAtStart) return;
    if (!hasOfflineAudio) {
      speakFallback(phraseAtStart);
      return;
    }

    try {
      if (sessionId !== playbackSession || currentPhrase !== phraseAtStart) return;
      els.audio.playbackRate = SPEED_PRESETS[speedIdx] || 1.0;
      els.audio.src = resolvedUrl;
      els.audio.load();
      await els.audio.play();
    } catch (error) {
      // Hybrid: if offline audio fails to decode/play, fall back to browser TTS.
      if (sessionId !== playbackSession || currentPhrase !== phraseAtStart) return;
      speakFallback(phraseAtStart);
    } finally {
      els.playBtn.disabled = false;
    }
  }

  function checkAnswer() {
    if (!els) return;
    if (!currentPhrase) return;

    const expected = normalizeForCompare(currentPhrase);
    const typed = normalizeForCompare(els.input.value);
    const baseCapture = derivePhraseFirstCapture(currentPhrase, els.input.value);
    const missCounts = Object.fromEntries(
      (baseCapture.tracking.missedWords || []).map((word) => [
        word,
        Number(window.VocabularyBook?.getMissCount?.(word) || 0) + 1
      ])
    );
    const capture = derivePhraseFirstCapture(currentPhrase, els.input.value, missCounts);

    stats.attempts += 1;

    if (typed && typed === expected) {
      stats.correct += 1;
      stats.streak += 1;
      setFeedback('correct', `Correct!<br><strong>${currentPhrase}</strong>`);
    } else {
      stats.streak = 0;
      setFeedback('wrong', `Not quite.<br>Answer: <strong>${currentPhrase}</strong>`);

      if (window.VocabularyBook) {
        capture.tracking.missedWords.forEach((word) => {
          window.VocabularyBook.trackMissedWord?.(word, 'collo-dictate', getColloAudioKey(currentPhrase), currentPhrase);
        });
        capture.tracking.correctWords.forEach((word) => {
          window.VocabularyBook.trackCorrectWord?.(word);
        });

        if (capture.candidates.length > 0) {
          window.VocabularyBook.handlePracticeCapture?.({
            mode: 'collo-dictate',
            questionId: getColloAudioKey(currentPhrase),
            sentenceText: currentPhrase,
            candidates: capture.candidates.map((candidate) => ({
              ...candidate,
              sentence: currentPhrase
            }))
          });
        }
      }
    }

    els.checkBtn.disabled = true;
    updateNavUI();
    updateScoreUI();
  }

  function cycleSpeed() {
    if (!els) return;
    speedIdx = (speedIdx + 1) % SPEED_PRESETS.length;
    els.speedBtn.textContent = `${(SPEED_PRESETS[speedIdx] || 1.0).toFixed(1)}x`;
  }

  function initUI() {
    if (initDone) return;
    initDone = true;

    const panel = document.getElementById('mode-collo-dictate');
    const playBtn = document.getElementById('collo-play-btn');
    const checkBtn = document.getElementById('collo-check-btn');
    const backBtn = document.getElementById('collo-back-btn');
    const nextBtn = document.getElementById('collo-next-btn');
    const speedBtn = document.getElementById('collo-speed-btn');
    const lengthSelect = document.getElementById('collo-length-filter');
    const questionIdEl = document.getElementById('collo-question-id');
    const audioIdEl = document.getElementById('collo-audio-id');
    const scoreEl = document.getElementById('collo-score');
    const statsEl = document.getElementById('collo-stats');
    const input = document.getElementById('collo-answer-input');
    const feedback = document.getElementById('collo-feedback');
    const audio = document.getElementById('audio-collo-dictate');
    const searchInput = document.getElementById('collo-search-input');
    const searchCountEl = document.getElementById('collo-search-count');
    const searchClearBtn = document.getElementById('collo-search-clear');
    const searchHintEl = document.querySelector('.collo-search-hint');
    const noResultsEl = document.getElementById('collo-search-no-results');

    if (
      !panel ||
      !playBtn ||
      !checkBtn ||
      !backBtn ||
      !nextBtn ||
      !speedBtn ||
      !lengthSelect ||
      !questionIdEl ||
      !audioIdEl ||
      !scoreEl ||
      !statsEl ||
      !input ||
      !feedback ||
      !audio
    ) {
      console.warn('[ColloDictate] Missing DOM elements; mode not initialized.');
      return;
    }

    els = {
      panel,
      playBtn,
      checkBtn,
      backBtn,
      nextBtn,
      speedBtn,
      lengthSelect,
      questionIdEl,
      audioIdEl,
      scoreEl,
      statsEl,
      input,
      feedback,
      audio,
      searchInput,
      searchCountEl,
      searchClearBtn,
      searchHintEl,
      noResultsEl
    };

    // Initial UI state
    speedIdx = 0;
    speedBtn.textContent = `${(SPEED_PRESETS[speedIdx] || 1.0).toFixed(1)}x`;
    updateScoreUI();
    updateQuestionMetaUI();
    updateNavUI();

    playBtn.addEventListener('click', () => {
      void playCurrent();
    });

    checkBtn.addEventListener('click', () => {
      checkAnswer();
    });

    backBtn.addEventListener('click', () => {
      goBack();
    });

    nextBtn.addEventListener('click', () => {
      goNext();
    });

    speedBtn.addEventListener('click', () => {
      cycleSpeed();
    });

    lengthSelect.addEventListener('change', () => {
      applyFilter();
      history = [];
      historyIndex = -1;
      currentPhrase = '';
      goNext();
    });

    // Search input: debounced filter + keyboard handling
    let searchDebounce = null;
    if (searchInput) {
      // Prevent Enter from triggering form submit or other actions
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
        }
        // Escape clears the search
        if (e.key === 'Escape') {
          searchInput.value = '';
          searchInput.dispatchEvent(new Event('input'));
          searchInput.blur();
        }
      });

      searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
          applyFilter();
          history = [];
          historyIndex = -1;
          currentPhrase = '';
          updateNavUI();
          updateScoreUI();
          updateQuestionMetaUI();
          clearFeedback();
          if (filtered.length > 0) {
            goNext();
          } else {
            setCurrentPhrase('');
          }
        }, 250);
      });
    }

    // Clear button click handler
    if (searchClearBtn && searchInput) {
      searchClearBtn.addEventListener('click', () => {
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input'));
        searchInput.focus();
      });
    }

    input.addEventListener('input', () => {
      const hasText = normalizeForCompare(input.value).length > 0;
      checkBtn.disabled = !hasText;
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        if (!checkBtn.disabled) checkAnswer();
      }
    });
  }

  async function onEnter() {
    initUI();
    if (!els) return;
    await ensurePhrasesLoaded();
    applyFilter();
    updateNavUI();
    if (!currentPhrase) goNext();
    updateQuestionMetaUI();
    updateScoreUI();
  }

  function onExit() {
    if (!els) return;
    invalidatePlayback();
  }

  return { onEnter, onExit };
})();

window.ColloDictateMode = ColloDictateMode;
export { ColloDictateMode };
