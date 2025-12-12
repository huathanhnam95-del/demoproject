(() => {
  const correctSentence =
    "Next time, we'll discuss the influence of the media on public policy."; // Set the exact sentence spoken in 1.mp3

  const audio = document.getElementById("audio");
  const playBtn = document.getElementById("play-btn");
  const checkBtn = document.getElementById("check-btn");
  const input = document.getElementById("answer-input");
  const result = document.getElementById("result");
  const score = document.getElementById("score");
  const animationBox = document.getElementById("animation");
  const replayBtn = document.getElementById("replay-btn");

  // Tab switching
  const tabType = document.getElementById("tab-type");
  const tabSpeak = document.getElementById("tab-speak");
  const modeType = document.getElementById("mode-type");
  const modeSpeak = document.getElementById("mode-speak");

  // Speak mode elements
  const playBtnSpeak = document.getElementById("play-btn-speak");
  const recordBtn = document.getElementById("record-btn");
  const checkBtnSpeak = document.getElementById("check-btn-speak");
  const transcriptionText = document.getElementById("transcription-text");
  const recordingStatus = document.getElementById("recording-status");
  const scoreSpeak = document.getElementById("score-speak");
  const pronunciationPanel = document.getElementById("pronunciation-practice");
  const pronunciationWords = document.getElementById("pronunciation-words");
  const breakdownPanel = document.getElementById("breakdown-mode");
  const breakdownLines = document.getElementById("breakdown-lines");
  const breakdownBeginningBtn = document.getElementById("breakdown-beginning");
  const breakdownEndBtn = document.getElementById("breakdown-end");

  // Speech recognition
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let isRecording = false;
  let transcription = "";
  let wordRecognition = null; // For individual word pronunciation practice
  let currentWordIndex = -1; // Track which word is being practiced

  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let interimTranscript = "";
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + " ";
        } else {
          interimTranscript += transcript;
        }
      }

      transcription = finalTranscript || interimTranscript;
      transcriptionText.textContent = transcription || "Click 'Start Recording' and speak...";
      transcriptionText.classList.toggle("empty", !transcription);
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      if (event.error === "no-speech") {
        recordingStatus.textContent = "No speech detected. Try again.";
      } else if (event.error === "not-allowed") {
        recordingStatus.textContent = "Microphone access denied. Please allow microphone access.";
      } else {
        recordingStatus.textContent = `Error: ${event.error}`;
      }
    };

    recognition.onend = () => {
      if (isRecording) {
        // Restart if still supposed to be recording
        try {
          recognition.start();
        } catch (e) {
          // Already started or error
          isRecording = false;
          recordBtn.textContent = "Start Recording";
          recordBtn.classList.remove("recording");
          recordingStatus.classList.remove("active");
        }
      } else {
        recordBtn.textContent = "Start Recording";
        recordBtn.classList.remove("recording");
        recordingStatus.classList.remove("active");
      }
    };
  } else {
    recordBtn.disabled = true;
    recordBtn.textContent = "Speech Recognition Not Available";
    transcriptionText.textContent = "Your browser does not support speech recognition. Please use Chrome or Edge.";
  }

  const STEP_INTERVAL_MS = 2400;
  let lastSteps = [];
  let lastAnimationMode = false; // Track if last animation was in speak mode
  let animationTimer = null;
  const synth = window.speechSynthesis || null;

  const normalize = (text) =>
    text
      .toLowerCase()
      .replace(/[.,!?;:]/g, " ") // drop punctuation for comparison
      .trim()
      .replace(/\s+/g, " ");

  const correctWords = normalize(correctSentence).split(" ").filter(Boolean);
  const correctWordCount = correctWords.length;

  const diffWords = (user, correct) => {
    const userWords = normalize(user).split(" ").filter(Boolean);
    const correctWordsLocal = normalize(correct).split(" ").filter(Boolean);

    const m = userWords.length;
    const n = correctWordsLocal.length;
    const dp = Array.from({ length: m + 1 }, () =>
      Array(n + 1).fill(0)
    );

    for (let i = 1; i <= m; i += 1) {
      for (let j = 1; j <= n; j += 1) {
        if (userWords[i - 1] === correctWordsLocal[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    const pieces = [];
    let i = m;
    let j = n;
    while (i > 0 || j > 0) {
      if (
        i > 0 &&
        j > 0 &&
        userWords[i - 1] === correctWordsLocal[j - 1]
      ) {
        pieces.push({ text: correctWordsLocal[j - 1], type: "match" });
        i -= 1;
        j -= 1;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        pieces.push({ text: correctWordsLocal[j - 1], type: "missing" });
        j -= 1;
      } else {
        pieces.push({ text: userWords[i - 1], type: "extra" });
        i -= 1;
      }
    }

    const reversed = pieces.reverse();

    const missingCounts = reversed.reduce((acc, part) => {
      if (part.type === "missing") acc[part.text] = (acc[part.text] || 0) + 1;
      return acc;
    }, {});

    const mapped = reversed.map((part) => {
      if (part.type === "extra" && missingCounts[part.text] > 0) {
        missingCounts[part.text] -= 1;
        return { ...part, type: "misplaced" };
      }
      return part;
    });

    // Pair misplaced with one missing instance to mark destination
    const pendingMove = {};
    mapped.forEach((part, idx) => {
      if (part.type === "misplaced") {
        pendingMove[part.text] = (pendingMove[part.text] || 0) + 1;
      }
      if (part.type === "missing" && pendingMove[part.text] > 0) {
        pendingMove[part.text] -= 1;
        mapped[idx] = { ...part, type: "move-target" };
      }
    });

    return mapped;
  };

  const renderDiff = (diff) => {
    return diff
      .map((part) => {
        if (part.type === "match") return part.text;
        if (part.type === "missing")
          return `<span class="highlight-miss missing">${part.text}</span>`;
        if (part.type === "extra")
          return `<span class="extra-word">${part.text}</span>`;
        if (part.type === "misplaced")
          return `<span class="misplaced-word">${part.text}</span>`;
        return part.text;
      })
      .join(" ");
  };

  const choosePronunciation = (word, nextWord) => {
    const w = (word || "").toLowerCase();
    if (w === "the") {
      const n = (nextWord || "").trim().toLowerCase();
      const startsWithVowel = /^[aeiou]/.test(n);
      return startsWithVowel ? "thee" : "thuh";
    }
    return word;
  };

  const speakWord = (word, nextWord = "") => {
    if (!synth || !word) return;
    const spokenText = choosePronunciation(word, nextWord);
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(spokenText);
    utter.lang = "en-US";
    // Try to prefer a bright/happy US female voice by name substring if available
    const voices = synth.getVoices();
    const preferred = voices.find((v) =>
      /female|samantha|allison|joanna|kimberly|ssml female|en-us/i.test(v.name)
    );
    if (preferred) utter.voice = preferred;
    utter.rate = 1.05; // a bit quicker for a brighter feel
    utter.pitch = 1.1; // slightly higher pitch
    synth.speak(utter);
  };

  const renderAnimationStep = (step, showSkipButton = false) => {
    const words = step.words
      .map((w, idx) => {
        const display =
          step.highlight &&
          step.highlight.index === idx &&
          step.highlight.type === "remove" &&
          step.highlight.ghost
            ? step.highlight.ghost
            : w === ""
            ? "&nbsp;"
            : w;
        const baseClass = w === "" ? "anim-word anim-base anim-empty" : "anim-word anim-base";
        const cls =
          step.highlight && step.highlight.index === idx
            ? step.highlight.type === "add"
              ? "anim-word anim-add"
              : "anim-word anim-remove"
            : baseClass;
        const dataWord = w ? ` data-word="${w}"` : "";
        return `<span class="${cls}"${dataWord}>${display}</span>`;
      })
      .join(" ");
    
    const skipButton = showSkipButton
      ? `<button id="skip-word-btn" class="skip-word-btn" type="button">Skip this word</button>`
      : "";
    
    animationBox.innerHTML = `
      <div class="anim-line"><strong>${step.label || ""}</strong></div>
      <div class="anim-step">${words}</div>
      ${skipButton}
    `;
    
    // Add event listener to skip button if it exists
    if (showSkipButton) {
      const skipBtn = document.getElementById("skip-word-btn");
      if (skipBtn) {
        skipBtn.addEventListener("click", () => {
          skipCurrentWord();
        });
      }
    }
  };

  const playWordAudio = (word, nextWord = "") => {
    speakWord(word, nextWord);
  };

  let animationRecognition = null;
  let isAnimationPaused = false;
  let currentAnimationStep = null;
  let currentAnimationIdx = 0;
  let animationSteps = [];
  let animationOnComplete = null;
  let isSpeakModeAnimation = false;
  let currentWaitingWord = null;
  let currentWaitingStepIdx = -1;
  let permissionRequested = false; // Track if we've requested permission

  const skipCurrentWord = () => {
    if (!isAnimationPaused || currentWaitingStepIdx === -1) return;
    
    // Stop recognition
    if (animationRecognition) {
      animationRecognition.stop();
      animationRecognition = null;
    }
    
    // Restore original label
    const step = animationSteps[currentWaitingStepIdx];
    step.label = step.originalLabel || step.label;
    renderAnimationStep(step, false);
    
    // Continue animation
    isAnimationPaused = false;
    currentWaitingWord = null;
    currentWaitingStepIdx = -1;
    continueAnimation();
  };

  const waitForWordInAnimation = (expectedWord, stepIdx) => {
    if (!SpeechRecognition) {
      // If no speech recognition, just continue
      continueAnimation();
      return;
    }

    isAnimationPaused = true;
    currentAnimationStep = stepIdx;
    currentWaitingWord = expectedWord;
    currentWaitingStepIdx = stepIdx;

    // Show prompt message
    const step = animationSteps[stepIdx];
    if (!step.originalLabel) {
      step.originalLabel = step.label;
    }
    step.label = `Say "${expectedWord}"`;
    renderAnimationStep(step, true);

    // Stop any ongoing recognition
    if (animationRecognition) {
      animationRecognition.stop();
      animationRecognition = null;
    }

    // Stop main recording if active
    if (isRecording && recognition) {
      recognition.stop();
      isRecording = false;
      recordBtn.textContent = "Start Recording";
      recordBtn.classList.remove("recording");
      recordingStatus.classList.remove("active");
    }

    let isHandlingResult = false; // Flag to prevent multiple result handlers

    const startListening = () => {
      // Clean up any existing recognition first
      if (animationRecognition) {
        try {
          animationRecognition.stop();
        } catch (e) {
          // Ignore errors when stopping
        }
        animationRecognition = null;
      }

      // Only start if we're still waiting for this word
      if (!isAnimationPaused || currentAnimationStep !== stepIdx) {
        return;
      }

      // Reuse existing instance if available, otherwise create new one
      if (!animationRecognition) {
        animationRecognition = new SpeechRecognition();
        animationRecognition.continuous = false;
        animationRecognition.interimResults = false;
        animationRecognition.lang = "en-US";
        animationRecognition.maxAlternatives = 1;
      }

      animationRecognition.onresult = (event) => {
        if (isHandlingResult) return; // Prevent duplicate handling
        isHandlingResult = true;

        const spokenText = event.results[0][0].transcript.trim().toLowerCase();
        const expected = normalize(expectedWord);
        const match = normalize(spokenText) === expected;

        // Clean up recognition before handling result
        if (animationRecognition) {
          try {
            animationRecognition.stop();
          } catch (e) {
            // Ignore
          }
          animationRecognition = null;
        }

        if (match) {
          // Correct! Continue animation
          step.label = step.originalLabel || step.label;
          renderAnimationStep(step, false);
          isAnimationPaused = false;
          currentWaitingWord = null;
          currentWaitingStepIdx = -1;
          // Don't null animationRecognition - reuse it
          isHandlingResult = false;
          continueAnimation();
        } else {
          // Incorrect! Show message and wait for user to speak again
          step.label = `Please try <em>${expectedWord}</em> again`;
          renderAnimationStep(step, true);
          
          // Speak the word again
          const nextW = step.speakNext || "";
          playWordAudio(expectedWord, nextW);
          
          // Reset flag and restart listening after a short delay
          isHandlingResult = false;
          setTimeout(() => {
            if (isAnimationPaused && currentAnimationStep === stepIdx) {
              startListening();
            }
          }, 1500);
        }
      };

      animationRecognition.onerror = (event) => {
        if (isHandlingResult) return; // Don't handle error if we're already handling a result
        isHandlingResult = true;

        // Clean up recognition
        if (animationRecognition) {
          try {
            animationRecognition.stop();
          } catch (e) {
            // Ignore
          }
          animationRecognition = null;
        }

        if (event.error === "no-speech") {
          // No speech detected, show message and wait for user to speak again
          step.label = `Please try <em>${expectedWord}</em> again`;
          renderAnimationStep(step, true);
          const nextW = step.speakNext || "";
          playWordAudio(expectedWord, nextW);
          
          // Reset flag and restart listening after a short delay
          isHandlingResult = false;
          setTimeout(() => {
            if (isAnimationPaused && currentAnimationStep === stepIdx) {
              startListening();
            }
          }, 1500);
        } else {
          // Other error - only continue if we're no longer waiting for this word
          if (!isAnimationPaused || currentAnimationStep !== stepIdx) {
            return;
          }
          // For other errors, show message but don't auto-continue
          step.label = `Error: ${event.error}. Please try <em>${expectedWord}</em> again`;
          renderAnimationStep(step, true);
          isHandlingResult = false;
          setTimeout(() => {
            if (isAnimationPaused && currentAnimationStep === stepIdx) {
              startListening();
            }
          }, 2000);
        }
      };

      animationRecognition.onend = () => {
        // Only restart if we're still waiting and haven't handled a result
        if (isAnimationPaused && currentAnimationStep === stepIdx && !isHandlingResult) {
          // Small delay before restarting to avoid immediate restart
          setTimeout(() => {
            if (isAnimationPaused && currentAnimationStep === stepIdx && !isHandlingResult) {
              try {
                startListening();
              } catch (e) {
                console.error("Failed to restart recognition:", e);
                // Don't continue animation on restart failure - just wait
              }
            }
          }, 500);
        }
      };

      try {
        isHandlingResult = false;
        animationRecognition.start();
      } catch (e) {
        console.error("Failed to start animation recognition:", e);
        isHandlingResult = false;
        // Don't continue animation on start failure - user can skip if needed
        step.label = `Failed to start recognition. Please try <em>${expectedWord}</em> or skip.`;
        renderAnimationStep(step, true);
      }
    };

    startListening();
  };

  const continueAnimation = () => {
    if (isAnimationPaused) return;

    currentAnimationIdx += 1;
    if (currentAnimationIdx >= animationSteps.length) {
      if (animationOnComplete) animationOnComplete();
      return;
    }

    const step = animationSteps[currentAnimationIdx];
    renderAnimationStep(step);
    
    if (step.speak) {
      const hi = step.highlight ? step.highlight.index : null;
      const nextW =
        step.speakNext !== undefined
          ? step.speakNext
          : hi !== null && hi !== undefined
          ? step.words[hi + 1] || ""
          : "";
      playWordAudio(step.speak, nextW);
    }

    // Check if this is a missing word step in speak mode
    if (isSpeakModeAnimation && step.label && step.label.startsWith("Add \"")) {
      // Extract the word from the label (e.g., "Add \"the\"" -> "the")
      const wordMatch = step.label.match(/Add "([^"]+)"/);
      if (wordMatch && wordMatch[1]) {
        const expectedWord = wordMatch[1];
        // Wait for user to speak the word
        waitForWordInAnimation(expectedWord, currentAnimationIdx);
        return; // Don't advance automatically
      }
    }

    // Continue to next step after interval
    animationTimer = setTimeout(continueAnimation, STEP_INTERVAL_MS);
  };

  const playAnimation = (steps, onComplete = () => {}, isSpeakMode = false) => {
    if (!steps.length) {
      onComplete();
      return;
    }
    if (animationTimer) clearTimeout(animationTimer);
    if (synth) synth.cancel();
    if (animationRecognition) {
      animationRecognition.stop();
      animationRecognition = null;
    }

    animationSteps = steps;
    animationOnComplete = onComplete;
    isSpeakModeAnimation = isSpeakMode;
    currentAnimationIdx = 0;
    isAnimationPaused = false;
    currentWaitingWord = null;
    currentWaitingStepIdx = -1;

    renderAnimationStep(steps[0]);
    if (steps[0].speak) {
      const hi = steps[0].highlight ? steps[0].highlight.index : null;
      const nextW =
        steps[0].speakNext !== undefined
          ? steps[0].speakNext
          : hi !== null && hi !== undefined
          ? steps[0].words[hi + 1] || ""
          : "";
      playWordAudio(steps[0].speak, nextW);
    }

    // Check if first step is a missing word in speak mode
    if (isSpeakMode && steps[0].label && steps[0].label.startsWith("Add \"")) {
      const wordMatch = steps[0].label.match(/Add "([^"]+)"/);
      if (wordMatch && wordMatch[1]) {
        waitForWordInAnimation(wordMatch[1], 0);
        return;
      }
    }

    animationTimer = setTimeout(continueAnimation, STEP_INTERVAL_MS);
  };

  const buildAnimationSteps = (userText) => {
    const userWords = normalize(userText).split(" ").filter(Boolean);
    const correctWordsLocal = normalize(correctSentence).split(" ").filter(Boolean);
    const diff = diffWords(userText, correctSentence);

    const steps = [];
    const current = [...userWords]; // allow positions to shift naturally
    let curIdx = 0;
    let corIdx = 0;
    const moveQueue = [];

    steps.push({ label: "Your attempt", words: [...current] });

    diff.forEach((part) => {
      if (part.type === "match") {
        curIdx += 1;
        corIdx += 1;
        return;
      }

      if (part.type === "move-target") {
        const movedText = moveQueue.shift() || part.text;
        current.splice(curIdx, 0, movedText);
        steps.push({
          label: `Place "${movedText}"`,
          words: [...current],
          highlight: { index: curIdx, type: "add" },
          speakNext: current[curIdx + 1] || "",
        });
        curIdx += 1;
        corIdx += 1;
        return;
      }

      if (part.type === "missing") {
        current.splice(curIdx, 0, part.text);
        steps.push({
          label: `Add "${part.text}"`,
          words: [...current],
          highlight: { index: curIdx, type: "add" },
          speak: part.text,
          speakNext: correctWordsLocal[curIdx + 1] || "",
        });
        curIdx += 1;
        corIdx += 1;
        return;
      }

      // extra or misplaced -> remove
      const removedText = current[curIdx] || part.text;
      if (part.type === "misplaced") {
        moveQueue.push(removedText);
        const snapshot = [...current];
        steps.push({
          label: `Move "${removedText}"`,
          words: snapshot,
          highlight: { index: curIdx, type: "remove", ghost: removedText },
          speak: removedText,
        });
      } else {
        const snapshot = [...current];
        steps.push({
          label: `Remove "${removedText}"`,
          words: snapshot,
          highlight: { index: curIdx, type: "remove", ghost: removedText },
        });
      }
      current.splice(curIdx, 1); // remove and shift naturally
    });

    steps.push({ label: "Correct sentence", words: [...correctWordsLocal] });
    return steps;
  };

  // Tab switching
  tabType.addEventListener("click", () => {
    tabType.classList.add("active");
    tabSpeak.classList.remove("active");
    modeType.classList.add("active");
    modeSpeak.classList.remove("active");
    pronunciationPanel.style.display = "none";
    breakdownPanel.style.display = "none";
    if (isRecording && recognition) {
      recognition.stop();
      isRecording = false;
    }
    if (wordRecognition) {
      wordRecognition.stop();
      wordRecognition = null;
      currentWordIndex = -1;
    }
    if (breakdownRecognition) {
      breakdownRecognition.stop();
      breakdownRecognition = null;
    }
  });

  tabSpeak.addEventListener("click", async () => {
    tabSpeak.classList.add("active");
    tabType.classList.remove("active");
    modeSpeak.classList.add("active");
    modeType.classList.remove("active");
    // Request microphone access when switching to speak tab
    await ensureMicrophoneAccess();
  });

  // Extract missed words from diff
  const getMissedWords = (diff) => {
    const missed = [];
    diff.forEach((part) => {
      if (part.type === "missing") {
        missed.push(part.text);
      }
    });
    // Remove duplicates while preserving order
    return [...new Set(missed)];
  };

  // Render pronunciation practice box
  const renderPronunciationPractice = (missedWords) => {
    if (missedWords.length === 0) {
      pronunciationPanel.style.display = "none";
      return;
    }

    pronunciationPanel.style.display = "block";
    pronunciationWords.innerHTML = missedWords
      .map(
        (word, idx) => `
      <div class="pronunciation-item" data-word-index="${idx}">
        <span class="pronunciation-word" id="pron-word-${idx}">${word}</span>
        <button class="pronunciation-record-btn" data-word="${word}" data-index="${idx}" type="button">Record</button>
        <span class="pronunciation-status" id="pron-status-${idx}"></span>
      </div>
    `
      )
      .join("");

    // Add event listeners to record buttons
    pronunciationWords.querySelectorAll(".pronunciation-record-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const word = btn.dataset.word;
        const index = parseInt(btn.dataset.index, 10);
        startWordRecording(word, index, btn);
      });
    });
  };

  // Start recording for individual word
  const startWordRecording = async (expectedWord, index, btn) => {
    if (!SpeechRecognition) {
      alert("Speech recognition is not available in your browser.");
      return;
    }

    // Ensure microphone access is granted
    await ensureMicrophoneAccess();

    // Stop any ongoing word recording
    if (wordRecognition) {
      wordRecognition.stop();
      wordRecognition = null;
    }

    // Stop main recording if active
    if (isRecording && recognition) {
      recognition.stop();
      isRecording = false;
      recordBtn.textContent = "Start Recording";
      recordBtn.classList.remove("recording");
      recordingStatus.classList.remove("active");
    }

    currentWordIndex = index;
    btn.textContent = "Recording...";
    btn.classList.add("recording");
    const statusEl = document.getElementById(`pron-status-${index}`);
    statusEl.textContent = "Listening...";
    const wordEl = document.getElementById(`pron-word-${index}`);
    wordEl.classList.remove("correct", "incorrect");

    // Reuse wordRecognition if it exists, otherwise create new
    if (!wordRecognition) {
      wordRecognition = new SpeechRecognition();
      wordRecognition.continuous = false;
      wordRecognition.interimResults = false;
      wordRecognition.lang = "en-US";
      wordRecognition.maxAlternatives = 1;
    }

    wordRecognition.onresult = (event) => {
      const spokenText = event.results[0][0].transcript.trim().toLowerCase();
      const expected = normalize(expectedWord);
      const match = normalize(spokenText) === expected;

      wordEl.classList.remove("correct", "incorrect");
      if (match) {
        wordEl.classList.add("correct");
        statusEl.textContent = "✓ Correct!";
        statusEl.style.color = "#166534";
      } else {
        wordEl.classList.add("incorrect");
        statusEl.textContent = `You said: "${spokenText}"`;
        statusEl.style.color = "#b91c1c";
      }

      btn.textContent = "Record";
      btn.classList.remove("recording");
      wordRecognition = null;
      currentWordIndex = -1;
    };

    wordRecognition.onerror = (event) => {
      statusEl.textContent = `Error: ${event.error}`;
      statusEl.style.color = "#b91c1c";
      btn.textContent = "Record";
      btn.classList.remove("recording");
      wordRecognition = null;
      currentWordIndex = -1;
    };

    wordRecognition.onend = () => {
      if (currentWordIndex === index) {
        // Only reset if this is still the active recording
        btn.textContent = "Record";
        btn.classList.remove("recording");
        if (!statusEl.textContent || statusEl.textContent === "Listening...") {
          statusEl.textContent = "No speech detected. Try again.";
          statusEl.style.color = "#b91c1c";
        }
        wordRecognition = null;
        currentWordIndex = -1;
      }
    };

    try {
      wordRecognition.start();
    } catch (e) {
      console.error("Failed to start word recognition:", e);
      btn.textContent = "Record";
      btn.classList.remove("recording");
      statusEl.textContent = "Failed to start recording";
      statusEl.style.color = "#b91c1c";
      wordRecognition = null;
      currentWordIndex = -1;
    }
  };

  // Shared check function
  const performCheck = (userAnswer, scoreElement) => {
    const diff = diffWords(userAnswer, correctSentence);
    const hasErrors = diff.some((p) => p.type !== "match");
    const scoreValue = diff.filter((p) => p.type === "match").length;

    if (!userAnswer.trim()) {
      result.innerHTML = `<span class="errors">Please provide your answer before checking.</span>`;
      scoreElement.textContent = `Points: 0 / ${correctWordCount}`;
      return;
    }

    scoreElement.textContent = `Points: ${scoreValue} / ${correctWordCount}`;

    // Show pronunciation practice and breakdown mode for speak mode
    if (scoreElement === scoreSpeak) {
      const missedWords = getMissedWords(diff);
      renderPronunciationPractice(missedWords);
      renderBreakdownMode();
    } else {
      pronunciationPanel.style.display = "none";
      breakdownPanel.style.display = "none";
    }

    lastSteps = buildAnimationSteps(userAnswer);
    animationBox.innerHTML = "";
    result.innerHTML = `<div class="errors">Playing correction animation...</div>`;

    const isSpeakMode = scoreElement === scoreSpeak;
    lastAnimationMode = isSpeakMode;
    playAnimation(lastSteps, () => {
      const feedback = hasErrors
        ? `<div class="errors">Keep practicing! Differences highlighted below:</div><div>${renderDiff(diff)}</div>`
        : `<div class="ok">Great job! Perfect match.</div>`;

      result.innerHTML = `${feedback}<div class="correct-sentence">Correct sentence: ${correctSentence}</div>`;

      // Replay original audio if there are errors (points not max)
      if (hasErrors && scoreValue < correctWordCount) {
        audio.currentTime = 0;
        audio.play();
      }
    }, isSpeakMode);
  };

  // Type mode
  playBtn.addEventListener("click", () => {
    audio.currentTime = 0;
    audio.play();
  });

  checkBtn.addEventListener("click", () => {
    performCheck(input.value, score);
  });

  // Speak mode
  playBtnSpeak.addEventListener("click", () => {
    audio.currentTime = 0;
    audio.play();
  });

  // Note: Speech Recognition API handles permissions automatically.
  // The browser should remember permissions after the first grant.
  // If you're opening this as a local file (file://), browsers don't persist
  // permissions for security reasons - this is expected browser behavior.
  const ensureMicrophoneAccess = async () => {
    // No-op: Let each recognition instance request permission naturally
    // The browser will remember it after the first grant (unless file://)
  };

  recordBtn.addEventListener("click", async () => {
    if (!recognition) return;

    // Ensure microphone access is granted
    await ensureMicrophoneAccess();

    if (isRecording) {
      recognition.stop();
      isRecording = false;
      recordBtn.textContent = "Start Recording";
      recordBtn.classList.remove("recording");
      recordingStatus.classList.remove("active");
    } else {
      transcription = "";
      transcriptionText.textContent = "Listening...";
      transcriptionText.classList.remove("empty");
      recordingStatus.textContent = "Recording...";
      recordingStatus.classList.add("active");
      recordBtn.textContent = "Stop Recording";
      recordBtn.classList.add("recording");
      isRecording = true;
      try {
        recognition.start();
      } catch (e) {
        console.error("Failed to start recognition:", e);
        isRecording = false;
        recordBtn.textContent = "Start Recording";
        recordBtn.classList.remove("recording");
        recordingStatus.classList.remove("active");
      }
    }
  });

  checkBtnSpeak.addEventListener("click", () => {
    if (isRecording && recognition) {
      recognition.stop();
      isRecording = false;
      recordBtn.textContent = "Start Recording";
      recordBtn.classList.remove("recording");
      recordingStatus.classList.remove("active");
    }
    performCheck(transcription.trim(), scoreSpeak);
  });

  replayBtn.addEventListener("click", () => {
    if (lastSteps.length) playAnimation(lastSteps, () => {}, lastAnimationMode);
  });

  // Breakdown Mode functions
  let breakdownMode = "beginning"; // "beginning" or "end"
  let breakdownRecognition = null;

  const getWordSegment = (percentage, fromEnd = false) => {
    const words = normalize(correctSentence).split(" ").filter(Boolean);
    const totalWords = words.length;
    const wordCount = Math.ceil((totalWords * percentage) / 100);

    if (fromEnd) {
      return words.slice(-wordCount).join(" ");
    } else {
      return words.slice(0, wordCount).join(" ");
    }
  };

  // Process a phrase to handle "the" pronunciation correctly
  const processPhraseForSpeech = (phrase) => {
    const words = phrase.split(" ").filter(Boolean);
    const processedWords = words.map((word, idx) => {
      const nextWord = words[idx + 1] || "";
      return choosePronunciation(word, nextWord);
    });
    return processedWords.join(" ");
  };

  const playBreakdownSegment = (percentage) => {
    const segment = getWordSegment(percentage, breakdownMode === "end");
    
    // Cancel any ongoing speech
    if (synth) synth.cancel();

    // Process the entire phrase to handle "the" pronunciation correctly
    const processedPhrase = processPhraseForSpeech(segment);

    // Speak the entire phrase as one natural utterance
    const utter = new SpeechSynthesisUtterance(processedPhrase);
    utter.lang = "en-US";
    
    // Try to prefer a bright/happy US female voice by name substring if available
    const voices = synth.getVoices();
    const preferred = voices.find((v) =>
      /female|samantha|allison|joanna|kimberly|ssml female|en-us/i.test(v.name)
    );
    if (preferred) utter.voice = preferred;
    utter.rate = 1.0; // Natural speaking rate
    utter.pitch = 1.0; // Natural pitch
    
    synth.speak(utter);
  };

  const startBreakdownRecording = async (percentage, lineIndex, btn) => {
    if (!SpeechRecognition) {
      alert("Speech recognition is not available in your browser.");
      return;
    }

    await ensureMicrophoneAccess();

    // Stop any ongoing breakdown recording
    if (breakdownRecognition) {
      breakdownRecognition.stop();
      breakdownRecognition = null;
    }

    // Stop main recording if active
    if (isRecording && recognition) {
      recognition.stop();
      isRecording = false;
      recordBtn.textContent = "Start Recording";
      recordBtn.classList.remove("recording");
      recordingStatus.classList.remove("active");
    }

    const expectedSegment = getWordSegment(percentage, breakdownMode === "end");
    const statusEl = document.getElementById(`breakdown-status-${lineIndex}`);

    btn.textContent = "Recording...";
    btn.disabled = true;
    btn.classList.add("recording");
    statusEl.textContent = "Listening...";
    statusEl.className = "breakdown-status";

    breakdownRecognition = new SpeechRecognition();
    breakdownRecognition.continuous = false;
    breakdownRecognition.interimResults = false;
    breakdownRecognition.lang = "en-US";
    breakdownRecognition.maxAlternatives = 1;

    breakdownRecognition.onresult = (event) => {
      const spokenText = event.results[0][0].transcript.trim();
      const expected = normalize(expectedSegment);
      const spoken = normalize(spokenText);
      const match = spoken === expected;

      if (match) {
        statusEl.textContent = "✓ Correct!";
        statusEl.className = "breakdown-status correct";
      } else {
        statusEl.textContent = `Incorrect. Expected: "${expectedSegment}"`;
        statusEl.className = "breakdown-status incorrect";
      }

      btn.textContent = "Record";
      btn.disabled = false;
      btn.classList.remove("recording");
      breakdownRecognition = null;
    };

    breakdownRecognition.onerror = (event) => {
      statusEl.textContent = `Error: ${event.error}`;
      statusEl.className = "breakdown-status incorrect";
      btn.textContent = "Record";
      btn.disabled = false;
      btn.classList.remove("recording");
      breakdownRecognition = null;
    };

    breakdownRecognition.onend = () => {
      if (statusEl.textContent === "Listening...") {
        statusEl.textContent = "No speech detected. Try again.";
        statusEl.className = "breakdown-status incorrect";
      }
      btn.textContent = "Record";
      btn.disabled = false;
      btn.classList.remove("recording");
      breakdownRecognition = null;
    };

    try {
      breakdownRecognition.start();
    } catch (e) {
      console.error("Failed to start breakdown recognition:", e);
      btn.textContent = "Record";
      btn.disabled = false;
      btn.classList.remove("recording");
      statusEl.textContent = "Failed to start recording";
      statusEl.className = "breakdown-status incorrect";
      breakdownRecognition = null;
    }
  };

  const renderBreakdownMode = () => {
    breakdownPanel.style.display = "block";
    breakdownLines.innerHTML = `
      <div class="breakdown-line">
        <span class="breakdown-line-label">30%</span>
        <div class="breakdown-line-controls">
          <button class="breakdown-play-btn" data-percentage="30" type="button">Play</button>
          <button class="breakdown-record-btn" data-percentage="30" data-index="0" type="button">Record</button>
          <span class="breakdown-status" id="breakdown-status-0"></span>
        </div>
      </div>
      <div class="breakdown-line">
        <span class="breakdown-line-label">60%</span>
        <div class="breakdown-line-controls">
          <button class="breakdown-play-btn" data-percentage="60" type="button">Play</button>
          <button class="breakdown-record-btn" data-percentage="60" data-index="1" type="button">Record</button>
          <span class="breakdown-status" id="breakdown-status-1"></span>
        </div>
      </div>
      <div class="breakdown-line">
        <span class="breakdown-line-label">100%</span>
        <div class="breakdown-line-controls">
          <button class="breakdown-play-btn" data-percentage="100" type="button">Play</button>
          <button class="breakdown-record-btn" data-percentage="100" data-index="2" type="button">Record</button>
          <span class="breakdown-status" id="breakdown-status-2"></span>
        </div>
      </div>
    `;

    // Add event listeners
    breakdownLines.querySelectorAll(".breakdown-play-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const percentage = parseInt(btn.dataset.percentage, 10);
        playBreakdownSegment(percentage);
      });
    });

    breakdownLines.querySelectorAll(".breakdown-record-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const percentage = parseInt(btn.dataset.percentage, 10);
        const index = parseInt(btn.dataset.index, 10);
        startBreakdownRecording(percentage, index, btn);
      });
    });
  };

  // Breakdown mode option buttons
  breakdownBeginningBtn.addEventListener("click", () => {
    breakdownMode = "beginning";
    breakdownBeginningBtn.classList.add("active");
    breakdownEndBtn.classList.remove("active");
    renderBreakdownMode();
  });

  breakdownEndBtn.addEventListener("click", () => {
    breakdownMode = "end";
    breakdownEndBtn.classList.add("active");
    breakdownBeginningBtn.classList.remove("active");
    renderBreakdownMode();
  });

  animationBox.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const word = target.dataset.word;
    if (word) {
      const next = target.nextElementSibling?.getAttribute("data-word") || "";
      speakWord(word, next);
    }
  });
})();

