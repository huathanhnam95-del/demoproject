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
  const animationPanel = document.querySelector(".animation-panel");
  const replayBtn = document.getElementById("replay-btn");
  const skipAnimationBtn = document.getElementById("skip-animation-btn");

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
  // Type mode generate panel
  const generatePanelType = document.getElementById("generate-sentences-type");
  const generateBtnType = document.getElementById("generate-type-btn");
  const showAllSentencesBtnType = document.getElementById("show-all-sentences-type-btn");
  const hideAllSentencesBtnType = document.getElementById("hide-all-sentences-type-btn");
  const generatedSentencesType = document.getElementById("generated-sentences-type");
  
  // Speak mode generate panel
  const generatePanelSpeak = document.getElementById("generate-sentences-speak");
  const generateBtnSpeak = document.getElementById("generate-speak-btn");
  const showAllSentencesBtnSpeak = document.getElementById("show-all-sentences-speak-btn");
  const hideAllSentencesBtnSpeak = document.getElementById("hide-all-sentences-speak-btn");
  const generatedSentencesSpeak = document.getElementById("generated-sentences-speak");

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

    recognition.onstart = () => {
      recordingStatus.textContent = "Recording... (speak now)";
    };

    recognition.onaudiostart = () => {
      // Audio capture started - no need to log
    };

    recognition.onsoundstart = () => {
      // Sound detected - no need to log
    };

    recognition.onresult = (event) => {
      // Build complete transcript from ALL results (not just new ones)
      // This ensures we keep everything even after pauses/restarts
      let newFinalText = "";
      let interimText = "";

      // Process results starting from resultIndex (new results)
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          newFinalText += transcript + " ";
        } else {
          interimText += transcript;
        }
      }

      // If we got new final text, append it to our accumulated transcription
      if (newFinalText.trim()) {
        transcription = (transcription ? transcription + " " : "") + newFinalText.trim();
      }

      // Display: accumulated final transcript + current interim text
      const displayText = transcription + (interimText ? " " + interimText : "");
      transcriptionText.textContent = displayText || "Click 'Start Recording' and speak...";
      transcriptionText.classList.toggle("empty", !displayText);
    };

    recognition.onerror = (event) => {
      // Ignore "aborted" errors - they happen when we stop recognition intentionally
      if (event.error === "aborted") {
        return;
      }
      
      console.error("Speech recognition error:", event.error);
      if (event.error === "no-speech") {
        recordingStatus.textContent = "No speech detected. Try speaking louder or closer to the microphone.";
      } else if (event.error === "not-allowed") {
        recordingStatus.textContent = "Microphone access denied. Please allow microphone access in your browser settings.";
        isRecording = false;
        recordBtn.textContent = "Start Recording";
        recordBtn.classList.remove("recording");
        recordingStatus.classList.remove("active");
      } else if (event.error === "audio-capture") {
        recordingStatus.textContent = "No microphone found. Please connect a microphone.";
        isRecording = false;
        recordBtn.textContent = "Start Recording";
        recordBtn.classList.remove("recording");
        recordingStatus.classList.remove("active");
      } else if (event.error === "network") {
        recordingStatus.textContent = "Network error. Please check your internet connection.";
      } else {
        recordingStatus.textContent = `Error: ${event.error}`;
      }
    };

    recognition.onend = () => {
      if (isRecording) {
        // Restart if still supposed to be recording
        // Add a small delay to avoid immediate restart conflicts
        setTimeout(() => {
          if (isRecording) {
            try {
              console.log("Restarting recognition...");
              recognition.start();
            } catch (e) {
              // Already started or error - check if it's a real error
              if (e.name !== "InvalidStateError" && !e.message.includes("already started")) {
                console.error("Failed to restart recognition:", e);
                isRecording = false;
                recordBtn.textContent = "Start Recording";
                recordBtn.classList.remove("recording");
                recordingStatus.classList.remove("active");
              }
            }
          }
        }, 100);
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

  const renderAnimationStep = (step) => {
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
    
    animationBox.innerHTML = `
      <div class="anim-line"><strong>${step.label || ""}</strong></div>
      <div class="anim-step">${words}</div>
    `;
  };

  const playWordAudio = (word, nextWord = "") => {
    speakWord(word, nextWord);
  };

  let currentAnimationIdx = 0;
  let animationSteps = [];
  let animationOnComplete = null;
  let isSpeakModeAnimation = false;


  const continueAnimation = () => {
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

    // Continue to next step after interval
    animationTimer = setTimeout(continueAnimation, STEP_INTERVAL_MS);
  };

  const skipAnimation = () => {
    if (animationTimer) {
      clearTimeout(animationTimer);
      animationTimer = null;
    }
    if (synth) synth.cancel();
    
    // Jump to the last step
    if (animationSteps.length > 0) {
      currentAnimationIdx = animationSteps.length - 1;
      const lastStep = animationSteps[currentAnimationIdx];
      renderAnimationStep(lastStep);
      
      // Call the completion callback
      if (animationOnComplete) {
        animationOnComplete();
      }
    }
  };

  const playAnimation = (steps, onComplete = () => {}, isSpeakMode = false) => {
    if (!steps || !steps.length) {
      if (onComplete) onComplete();
      return;
    }
    if (animationTimer) clearTimeout(animationTimer);
    if (synth) synth.cancel();

    animationSteps = steps;
    animationOnComplete = onComplete;
    isSpeakModeAnimation = isSpeakMode;
    currentAnimationIdx = 0;

    // Ensure animation box exists and is visible
    if (!animationBox) {
      console.error("Animation box element not found");
      if (onComplete) onComplete();
      return;
    }

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
    
    // Hide Speak mode panels
    pronunciationPanel.style.display = "none";
    breakdownPanel.style.display = "none";
    generatePanelSpeak.style.display = "none";
    
    // Hide shared panels (will be shown when Check is pressed in Type mode)
    animationPanel.style.display = "none";
    result.style.display = "none";
    generatePanelType.style.display = "none";
    
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

  tabSpeak.addEventListener("click", () => {
    tabSpeak.classList.add("active");
    tabType.classList.remove("active");
    modeSpeak.classList.add("active");
    modeType.classList.remove("active");
    
    // Hide Type mode panels
    generatePanelType.style.display = "none";
    
    // Hide shared panels (will be shown when Check is pressed in Speak mode)
    animationPanel.style.display = "none";
    result.style.display = "none";
    generatePanelSpeak.style.display = "none";
    
    // Microphone access will be requested when user clicks "Start Recording"
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
    // Filter to only show content words (keywords)
    // Double-check: ensure we're filtering properly
    const contentWords = filterContentWords(missedWords);
    
    if (contentWords.length === 0) {
      pronunciationPanel.style.display = "none";
      return;
    }

    pronunciationPanel.style.display = "block";
    pronunciationWords.innerHTML = contentWords
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

  // Type mode check function
  const performCheckType = (userAnswer, scoreElement) => {
    const diff = diffWords(userAnswer, correctSentence);
    const hasErrors = diff.some((p) => p.type !== "match");
    const scoreValue = diff.filter((p) => p.type === "match").length;

    if (!userAnswer.trim()) {
      result.innerHTML = `<span class="errors">Please provide your answer before checking.</span>`;
      scoreElement.textContent = `Points: 0 / ${correctWordCount}`;
      return;
    }

    scoreElement.textContent = `Points: ${scoreValue} / ${correctWordCount}`;

    // Hide pronunciation practice and breakdown mode for type mode
    pronunciationPanel.style.display = "none";
    breakdownPanel.style.display = "none";

    // Store diff for sentence generation (Type mode)
    lastDiffType = diff;
    
    // Show generate panel immediately after check (if there are errors)
    if (hasErrors) {
      generatePanelType.style.display = "block";
    } else {
      generatePanelType.style.display = "none";
    }

    // Show animation panel and result box for Type mode
    animationPanel.style.display = "block";
    result.style.display = "block";
    
    lastSteps = buildAnimationSteps(userAnswer);
    if (!lastSteps || lastSteps.length === 0) {
      result.innerHTML = `<div class="errors">Error: Could not generate animation steps.</div>`;
      return;
    }
    animationBox.innerHTML = "";
    result.innerHTML = `<div class="errors">Playing correction animation...</div>`;

    lastAnimationMode = false; // Type mode
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
    }, false);
  };

  // Speak mode check function
  const performCheckSpeak = (userAnswer, scoreElement) => {
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
    const missedWords = getMissedWords(diff);
    renderPronunciationPractice(missedWords);
    renderBreakdownMode();

    // Store diff for sentence generation (Speak mode)
    lastDiffSpeak = diff;
    
    // Show generate panel immediately after check (if there are errors)
    if (hasErrors) {
      generatePanelSpeak.style.display = "block";
    } else {
      generatePanelSpeak.style.display = "none";
    }

    // Show animation panel and result box for Speak mode
    animationPanel.style.display = "block";
    result.style.display = "block";
    
    lastSteps = buildAnimationSteps(userAnswer);
    if (!lastSteps || lastSteps.length === 0) {
      result.innerHTML = `<div class="errors">Error: Could not generate animation steps.</div>`;
      return;
    }
    animationBox.innerHTML = "";
    result.innerHTML = `<div class="errors">Playing correction animation...</div>`;

    lastAnimationMode = true; // Speak mode
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
    }, true);
  };
  
  let lastDiffType = [];
  let lastDiffSpeak = [];

  // Type mode
  playBtn.addEventListener("click", () => {
    audio.currentTime = 0;
    audio.play();
  });

  checkBtn.addEventListener("click", () => {
    performCheckType(input.value, score);
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
      // Stop recording
      try {
        recognition.stop();
      } catch (e) {
        // Ignore errors when stopping
      }
      isRecording = false;
      recordBtn.textContent = "Start Recording";
      recordBtn.classList.remove("recording");
      recordingStatus.classList.remove("active");
    } else {
      // Start recording
      // First, make sure any previous recognition is stopped
      try {
        recognition.stop();
      } catch (e) {
        // Ignore if already stopped
      }
      
      // Wait a moment before starting to avoid conflicts
      await new Promise(resolve => setTimeout(resolve, 100));
      
      transcription = "";
      transcriptionText.textContent = "Listening...";
      transcriptionText.classList.remove("empty");
      recordingStatus.textContent = "Starting...";
      recordingStatus.classList.add("active");
      recordBtn.textContent = "Stop Recording";
      recordBtn.classList.add("recording");
      isRecording = true;
      
      try {
        recognition.start();
      } catch (e) {
        // Handle specific error cases
        if (e.name === "InvalidStateError" || e.message.includes("already started")) {
          // Recognition is already running, just update UI
          recordingStatus.textContent = "Recording...";
        } else if (e.name === "NotAllowedError") {
          recordingStatus.textContent = "Microphone access denied. Please allow microphone access and try again.";
          isRecording = false;
          recordBtn.textContent = "Start Recording";
          recordBtn.classList.remove("recording");
          recordingStatus.classList.remove("active");
        } else {
          console.error("Failed to start recognition:", e);
          isRecording = false;
          recordBtn.textContent = "Start Recording";
          recordBtn.classList.remove("recording");
          recordingStatus.classList.remove("active");
          recordingStatus.textContent = `Error: ${e.message || "Failed to start"}`;
        }
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
    performCheckSpeak(transcription.trim(), scoreSpeak);
  });

  replayBtn.addEventListener("click", () => {
    if (lastSteps.length) playAnimation(lastSteps, () => {}, lastAnimationMode);
  });

  // Stop words to exclude from sentence generation
  const stopWords = new Set([
    // Articles
    "a", "an", "the",
    // Conjunctions
    "and", "or", "but", "nor", "so", "yet",
    // Prepositions
    "in", "on", "at", "to", "for", "of", "with", "by", "from", "up", "about", "into", "through", 
    "during", "including", "excluding", "following", "over", "under", "above", "below", "between", 
    "among", "within", "without", "against", "across", "around", "behind", "beside", "besides", 
    "beyond", "near", "off", "out", "down", "upon", "toward", "towards", "until", "till",
    // Auxiliary verbs
    "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
    // Modal verbs
    "will", "would", "should", "could", "may", "might", "must", "can", "shall",
    // Demonstratives
    "this", "that", "these", "those",
    // Personal pronouns
    "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
    // Possessive pronouns
    "my", "your", "his", "her", "its", "our", "their", "mine", "yours", "hers", "ours", "theirs",
    // Other grammar words
    "as", "if", "when", "where", "while", "which", "who", "whom", "whose", "what", "why", "how",
    // Contractions
    "we'll", "we're", "we've", "we'd", "they'll", "they're", "they've", "they'd", "it's", "that's", "there's",
    "don't", "doesn't", "didn't", "won't", "wouldn't", "couldn't", "shouldn't", "can't", "isn't", "aren't",
    "wasn't", "weren't", "haven't", "hasn't", "hadn't", "i'm", "i've", "i'd", "i'll", "you're", "you've",
    "you'd", "you'll", "he's", "she's", "here's", "where's", "what's", "who's", "how's", "let's"
  ]);
  
  // Common verbs that shouldn't be used as keywords (nouns)
  const commonVerbs = new Set([
    "discuss", "analyze", "examine", "study", "review", "explore", "understand", "consider", "evaluate",
    "assess", "investigate", "explain", "describe", "present", "show", "demonstrate", "highlight", "focus",
    "address", "affect", "influence", "impact", "shape", "determine", "change", "improve", "create", "make",
    "take", "give", "get", "go", "come", "see", "know", "think", "say", "tell", "ask", "want", "need",
    "use", "work", "call", "try", "find", "keep", "let", "put", "mean", "set", "become", "leave", "feel",
    "seem", "bring", "begin", "help", "show", "hear", "play", "run", "move", "like", "live", "believe",
    "hold", "bring", "happen", "write", "sit", "stand", "lose", "pay", "meet", "include", "continue", "learn"
  ]);

  // Filter content words (exclude stop words and contractions only - keep verbs for pronunciation practice)
  const filterContentWords = (words) => {
    if (!words || !Array.isArray(words)) {
      return [];
    }
    
    return words.filter((word) => {
      if (!word || typeof word !== 'string') {
        return false;
      }
      
      // Normalize: lowercase, trim whitespace (including non-breaking spaces)
      let lowerWord = word.toLowerCase().trim();
      // Remove all whitespace characters
      lowerWord = lowerWord.replace(/\s+/g, '');
      
      // First check: Exclude contractions (any word with apostrophe) - check BEFORE removing punctuation
      if (lowerWord.includes("'")) {
        // Check if it's in stopWords (for contractions like "we'll")
        if (stopWords.has(lowerWord)) {
          return false;
        }
        // Exclude all other contractions
        return false;
      }
      
      // Remove all punctuation marks
      let normalized = lowerWord.replace(/[.,!?;:"()\[\]{}]/g, '');
      normalized = normalized.trim();
      
      // Exclude if empty or single character
      if (!normalized || normalized.length <= 1) {
        return false;
      }
      
      // Explicit check for common stop words (double-check)
      const commonStopWords = ["the", "a", "an", "on", "of", "in", "at", "to", "for", "with", "by", "from"];
      if (commonStopWords.includes(normalized)) {
        return false;
      }
      
      // Exclude if it's a stop word (articles, prepositions, pronouns, etc.)
      // BUT keep verbs - they are content words that should be practiced
      if (stopWords.has(normalized)) {
        return false;
      }
      
      // Don't filter out verbs - they are content words that should be included
      // Return true for all other words (nouns, verbs, adjectives, adverbs, etc.)
      return true;
    });
  };

  // Extract keywords from diff (missing and misplaced words, excluding stop words and verbs)
  const extractKeywords = (diff) => {
    const keywords = [];
    diff.forEach((part) => {
      const word = part.text.toLowerCase().trim();
      // Exclude stop words, contractions, and common verbs
      if ((part.type === "missing" || part.type === "misplaced") && 
          !stopWords.has(word) && 
          !commonVerbs.has(word) &&
          word.length > 1 && // Exclude single characters
          !word.includes("'") && // Exclude contractions
          !word.match(/^[a-z]+'[a-z]+$/)) { // Exclude any word with apostrophe
        keywords.push(word);
      }
    });
    // Remove duplicates and return only content words (nouns, adjectives, etc.)
    return [...new Set(keywords)];
  };

  // Generate a meaningful, grammatically correct sentence using ~20% of keywords
  const generateSentence = (keywords, sentenceNum) => {
    if (keywords.length === 0) return null;
    
    // Calculate how many keywords to use (20% of total, minimum 1, maximum 3)
    const keywordsToUse = Math.max(1, Math.min(3, Math.ceil(keywords.length * 0.2)));
    
    // Filter out any remaining invalid keywords (contractions, verbs, etc.)
    const validKeywords = keywords.filter(kw => 
      kw && 
      kw.length > 1 && 
      !kw.includes("'") && 
      !stopWords.has(kw) && 
      !commonVerbs.has(kw) &&
      !kw.match(/^[a-z]+'[a-z]+$/)
    );
    
    if (validKeywords.length === 0) return null;
    
    // Shuffle and take only the needed keywords
    const shuffled = [...validKeywords].sort(() => Math.random() - 0.5);
    const actualKeywordsToUse = Math.min(keywordsToUse, shuffled.length);
    const selectedKeywords = shuffled.slice(0, actualKeywordsToUse);
    
    // Validate keywords are valid (not contractions, verbs, or stop words)
    const isValidKeyword = (kw) => {
      if (!kw || kw.length <= 1) return false;
      if (kw.includes("'")) return false;
      if (stopWords.has(kw)) return false;
      if (commonVerbs.has(kw)) return false;
      if (kw.match(/^[a-z]+'[a-z]+$/)) return false;
      return true;
    };
    
    // Filter selected keywords one more time
    const finalKeywords = selectedKeywords.filter(isValidKeyword);
    if (finalKeywords.length === 0) return null;
    
    // Natural sentence templates that are grammatically correct
    const templates = [
      // Template 1: Subject + verb + the + keyword1 + preposition + keyword2
      (kw1, kw2) => {
        if (!isValidKeyword(kw1)) return null;
        const subjects = ["We", "They", "People", "Researchers", "Experts", "Students", "Teachers"];
        const verbs = ["discuss", "analyze", "examine", "study", "review", "explore", "understand", "consider"];
        const preps = ["of", "in", "on", "for", "about", "with", "through"];
        const subject = subjects[Math.floor(Math.random() * subjects.length)];
        const verb = verbs[Math.floor(Math.random() * verbs.length)];
        const prep = preps[Math.floor(Math.random() * preps.length)];
        if (kw2 && isValidKeyword(kw2)) {
          return `${subject} ${verb} the ${kw1} ${prep} ${kw2}.`;
        }
        return `${subject} ${verb} the ${kw1}.`;
      },
      
      // Template 2: The + keyword1 + verb + the + keyword2
      (kw1, kw2) => {
        if (!isValidKeyword(kw1)) return null;
        const verbs = ["affects", "influences", "impacts", "shapes", "determines", "changes", "improves"];
        const verb = verbs[Math.floor(Math.random() * verbs.length)];
        if (kw2 && isValidKeyword(kw2)) {
          return `The ${kw1} ${verb} the ${kw2}.`;
        }
        return `The ${kw1} matters.`;
      },
      
      // Template 3: This + keyword1 + helps + verb + the + keyword2
      (kw1, kw2) => {
        if (!isValidKeyword(kw1)) return null;
        const verbs = ["understand", "explain", "analyze", "evaluate", "assess"];
        const verb = verbs[Math.floor(Math.random() * verbs.length)];
        if (kw2 && isValidKeyword(kw2)) {
          return `This ${kw1} helps ${verb} the ${kw2}.`;
        }
        return `This ${kw1} is important.`;
      },
      
      // Template 4: We + should + verb + the + keyword1 + preposition + keyword2
      (kw1, kw2) => {
        if (!isValidKeyword(kw1)) return null;
        const modals = ["should", "must", "need to", "can", "will"];
        const verbs = ["discuss", "analyze", "examine", "study", "review", "consider"];
        const preps = ["of", "in", "on", "for", "about"];
        const modal = modals[Math.floor(Math.random() * modals.length)];
        const verb = verbs[Math.floor(Math.random() * verbs.length)];
        const prep = preps[Math.floor(Math.random() * preps.length)];
        if (kw2 && isValidKeyword(kw2)) {
          return `We ${modal} ${verb} the ${kw1} ${prep} ${kw2}.`;
        }
        return `We ${modal} ${verb} the ${kw1}.`;
      },
      
      // Template 5: The + keyword1 + shows + how + keyword2 + affects + keyword3
      (kw1, kw2, kw3) => {
        if (!isValidKeyword(kw1)) return null;
        const verbs = ["shows", "explains", "demonstrates", "illustrates", "reveals"];
        const verb = verbs[Math.floor(Math.random() * verbs.length)];
        if (kw2 && kw3 && isValidKeyword(kw2) && isValidKeyword(kw3)) {
          return `The ${kw1} ${verb} how ${kw2} affects ${kw3}.`;
        } else if (kw2 && isValidKeyword(kw2)) {
          return `The ${kw1} ${verb} the ${kw2}.`;
        }
        return `The ${kw1} is significant.`;
      },
      
      // Template 6: People + often + verb + the + keyword1 + preposition + keyword2
      (kw1, kw2) => {
        if (!isValidKeyword(kw1)) return null;
        const verbs = ["discuss", "analyze", "examine", "study", "review"];
        const preps = ["of", "in", "on", "for", "about"];
        const verb = verbs[Math.floor(Math.random() * verbs.length)];
        const prep = preps[Math.floor(Math.random() * preps.length)];
        if (kw2 && isValidKeyword(kw2)) {
          return `People often ${verb} the ${kw1} ${prep} ${kw2}.`;
        }
        return `People often ${verb} the ${kw1}.`;
      },
      
      // Template 7: It + is + important + to + verb + the + keyword1 + preposition + keyword2
      (kw1, kw2) => {
        if (!isValidKeyword(kw1)) return null;
        const verbs = ["understand", "analyze", "examine", "study", "consider"];
        const preps = ["of", "in", "on", "for", "about"];
        const verb = verbs[Math.floor(Math.random() * verbs.length)];
        const prep = preps[Math.floor(Math.random() * preps.length)];
        if (kw2 && isValidKeyword(kw2)) {
          return `It is important to ${verb} the ${kw1} ${prep} ${kw2}.`;
        }
        return `It is important to ${verb} the ${kw1}.`;
      },
      
      // Template 8: Many + people + verb + the + keyword1 + preposition + keyword2
      (kw1, kw2) => {
        if (!isValidKeyword(kw1)) return null;
        const verbs = ["discuss", "analyze", "examine", "study", "review"];
        const preps = ["of", "in", "on", "for", "about"];
        const verb = verbs[Math.floor(Math.random() * verbs.length)];
        const prep = preps[Math.floor(Math.random() * preps.length)];
        if (kw2 && isValidKeyword(kw2)) {
          return `Many people ${verb} the ${kw1} ${prep} ${kw2}.`;
        }
        return `Many people ${verb} the ${kw1}.`;
      }
    ];
    
    // Select a template based on sentence number
    const templateIdx = sentenceNum % templates.length;
    const template = templates[templateIdx];
    
    // Generate sentence based on number of valid keywords
    let sentence = null;
    if (finalKeywords.length >= 3) {
      sentence = template(finalKeywords[0], finalKeywords[1], finalKeywords[2]);
    } else if (finalKeywords.length === 2) {
      sentence = template(finalKeywords[0], finalKeywords[1]);
    } else if (finalKeywords.length === 1) {
      sentence = template(finalKeywords[0]);
    }
    
    // Fallback if template doesn't work
    if (!sentence && finalKeywords.length > 0) {
      const kw = finalKeywords[0];
      if (isValidKeyword(kw)) {
        const verbs = ["discuss", "analyze", "examine", "study"];
        const verb = verbs[Math.floor(Math.random() * verbs.length)];
        sentence = `We ${verb} the ${kw}.`;
        
        if (finalKeywords.length > 1 && isValidKeyword(finalKeywords[1])) {
          const preps = ["of", "in", "on", "for", "about"];
          const prep = preps[Math.floor(Math.random() * preps.length)];
          sentence = `We ${verb} the ${kw} ${prep} ${finalKeywords[1]}.`;
        }
      }
    }
    
    if (!sentence) return null;
    
    // Ensure proper capitalization and formatting
    sentence = sentence.trim();
    sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);
    if (!sentence.endsWith(".")) {
      sentence += ".";
    }
    
    // Clean up any double spaces
    sentence = sentence.replace(/\s+/g, " ");
    
    // Determine which keywords were actually used in the sentence
    const usedKeywords = finalKeywords.filter(kw => 
      sentence.toLowerCase().includes(kw.toLowerCase())
    );
    
    return {
      text: sentence,
      keywords: usedKeywords.length > 0 ? usedKeywords : finalKeywords.slice(0, Math.min(3, finalKeywords.length))
    };
  };

  // Generate 5 sentences
  // Helper function to highlight keywords in sentence text
  const highlightKeywords = (text, keywords) => {
    let highlighted = text;
    keywords.forEach(keyword => {
      // Create a regex that matches the keyword as a whole word (case insensitive)
      const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      highlighted = highlighted.replace(regex, (match) => {
        return `<strong class="sentence-keyword">${match}</strong>`;
      });
    });
    return highlighted;
  };

  // Type mode: Generate sentences with text input
  const generateSentencesType = () => {
    if (lastDiffType.length === 0) {
      generatedSentencesType.innerHTML = "<div class='error'>Please check your answer first to generate sentences.</div>";
      return;
    }
    
    const keywords = extractKeywords(lastDiffType);
    if (keywords.length === 0) {
      generatedSentencesType.innerHTML = "<div class='error'>No keywords found. All errors are stop words.</div>";
      return;
    }
    
    const sentences = [];
    for (let i = 0; i < 5; i++) {
      const sentence = generateSentence(keywords, i);
      if (sentence) {
        sentences.push(sentence);
      }
    }
    
    if (sentences.length === 0) {
      generatedSentencesType.innerHTML = "<div class='error'>Could not generate sentences.</div>";
      return;
    }
    
    // Render sentences (default hidden) with text input for Type mode
    generatedSentencesType.innerHTML = sentences.map((sentence, idx) => {
      const sentenceId = `sentence-type-${idx}`;
      const highlightedText = highlightKeywords(sentence.text, sentence.keywords);
      return `
        <div class="generated-sentence" data-sentence-id="${sentenceId}">
          <div class="sentence-header">
            <span class="sentence-number">Sentence ${idx + 1}</span>
            <button class="sentence-show-btn" data-sentence="${idx}" type="button">Show</button>
            <button class="sentence-play-btn" data-sentence="${idx}" type="button">Play</button>
          </div>
          <div class="sentence-text" data-sentence-text="${idx}" style="display: none;">${highlightedText}</div>
          <div class="sentence-input-container">
            <textarea class="sentence-input" id="input-${sentenceId}" rows="2" placeholder="Type the sentence here..."></textarea>
            <button class="sentence-check-btn" data-sentence="${idx}" type="button">Check</button>
          </div>
          <div class="sentence-status" id="status-${sentenceId}"></div>
        </div>
      `;
    }).join("");
    
    // Show Show All / Hide All buttons
    showAllSentencesBtnType.style.display = "inline-block";
    hideAllSentencesBtnType.style.display = "inline-block";
    
    // Store sentences data
    window.generatedSentencesDataType = sentences;
    
    // Add event listeners for Show buttons
    generatedSentencesType.querySelectorAll(".sentence-show-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.sentence, 10);
        const textEl = document.querySelector(`[data-sentence-text="${idx}"]`);
        
        if (textEl.style.display === "none") {
          textEl.style.display = "block";
          btn.textContent = "Hide";
          btn.classList.add("sentence-hide-btn");
          btn.classList.remove("sentence-show-btn");
        } else {
          textEl.style.display = "none";
          btn.textContent = "Show";
          btn.classList.add("sentence-show-btn");
          btn.classList.remove("sentence-hide-btn");
        }
      });
    });
    
    // Add event listeners for Play buttons
    generatedSentencesType.querySelectorAll(".sentence-play-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.sentence, 10);
        playGeneratedSentenceType(idx);
      });
    });
    
    // Add event listeners for Check buttons (Type mode)
    generatedSentencesType.querySelectorAll(".sentence-check-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.sentence, 10);
        checkGeneratedSentenceType(idx);
      });
    });
    
    generatePanelType.style.display = "block";
  };

  // Speak mode: Generate sentences with Record button
  const generateSentencesSpeak = () => {
    if (lastDiffSpeak.length === 0) {
      generatedSentencesSpeak.innerHTML = "<div class='error'>Please check your answer first to generate sentences.</div>";
      return;
    }
    
    const keywords = extractKeywords(lastDiffSpeak);
    if (keywords.length === 0) {
      generatedSentencesSpeak.innerHTML = "<div class='error'>No keywords found. All errors are stop words.</div>";
      return;
    }
    
    const sentences = [];
    for (let i = 0; i < 5; i++) {
      const sentence = generateSentence(keywords, i);
      if (sentence) {
        sentences.push(sentence);
      }
    }
    
    if (sentences.length === 0) {
      generatedSentencesSpeak.innerHTML = "<div class='error'>Could not generate sentences.</div>";
      return;
    }
    
    // Render sentences (default hidden) with Record button for Speak mode
    generatedSentencesSpeak.innerHTML = sentences.map((sentence, idx) => {
      const sentenceId = `sentence-speak-${idx}`;
      const highlightedText = highlightKeywords(sentence.text, sentence.keywords);
      return `
        <div class="generated-sentence" data-sentence-id="${sentenceId}">
          <div class="sentence-header">
            <span class="sentence-number">Sentence ${idx + 1}</span>
            <button class="sentence-show-btn" data-sentence="${idx}" type="button">Show</button>
            <button class="sentence-play-btn" data-sentence="${idx}" type="button">Play</button>
            <button class="sentence-record-btn" data-sentence="${idx}" type="button">Record</button>
          </div>
          <div class="sentence-text" data-sentence-text="${idx}" style="display: none;">${highlightedText}</div>
          <div class="sentence-status" id="status-${sentenceId}"></div>
        </div>
      `;
    }).join("");
    
    // Show Show All / Hide All buttons
    showAllSentencesBtnSpeak.style.display = "inline-block";
    hideAllSentencesBtnSpeak.style.display = "inline-block";
    
    // Store sentences data
    window.generatedSentencesDataSpeak = sentences;
    
    // Add event listeners for Show buttons
    generatedSentencesSpeak.querySelectorAll(".sentence-show-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.sentence, 10);
        const textEl = document.querySelector(`[data-sentence-text="${idx}"]`);
        
        if (textEl.style.display === "none") {
          textEl.style.display = "block";
          btn.textContent = "Hide";
          btn.classList.add("sentence-hide-btn");
          btn.classList.remove("sentence-show-btn");
        } else {
          textEl.style.display = "none";
          btn.textContent = "Show";
          btn.classList.add("sentence-show-btn");
          btn.classList.remove("sentence-hide-btn");
        }
      });
    });
    
    // Add event listeners for Play buttons
    generatedSentencesSpeak.querySelectorAll(".sentence-play-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.sentence, 10);
        playGeneratedSentenceSpeak(idx);
      });
    });
    
    // Add event listeners for Record buttons
    generatedSentencesSpeak.querySelectorAll(".sentence-record-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.sentence, 10);
        recordGeneratedSentence(idx, btn);
      });
    });
    
    generatePanelSpeak.style.display = "block";
  };

  // Play a generated sentence (Type mode)
  const playGeneratedSentenceType = (idx) => {
    if (!window.generatedSentencesDataType || !window.generatedSentencesDataType[idx]) return;
    
    const sentence = window.generatedSentencesDataType[idx].text;
    if (synth) {
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(sentence);
      utter.lang = "en-US";
      const voices = synth.getVoices();
      const preferred = voices.find((v) =>
        /female|samantha|allison|joanna|kimberly|ssml female|en-us/i.test(v.name)
      );
      if (preferred) utter.voice = preferred;
      utter.rate = 1.0;
      utter.pitch = 1.0;
      synth.speak(utter);
    }
  };

  // Play a generated sentence (Speak mode)
  const playGeneratedSentenceSpeak = (idx) => {
    if (!window.generatedSentencesDataSpeak || !window.generatedSentencesDataSpeak[idx]) return;
    
    const sentence = window.generatedSentencesDataSpeak[idx].text;
    if (synth) {
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(sentence);
      utter.lang = "en-US";
      const voices = synth.getVoices();
      const preferred = voices.find((v) =>
        /female|samantha|allison|joanna|kimberly|ssml female|en-us/i.test(v.name)
      );
      if (preferred) utter.voice = preferred;
      utter.rate = 1.0;
      utter.pitch = 1.0;
      synth.speak(utter);
    }
  };

  // Check typed input for Type mode generated sentences
  const checkGeneratedSentenceType = (idx) => {
    if (!window.generatedSentencesDataType || !window.generatedSentencesDataType[idx]) return;
    
    const sentence = window.generatedSentencesDataType[idx];
    const sentenceId = `sentence-type-${idx}`;
    const inputEl = document.getElementById(`input-${sentenceId}`);
    const statusEl = document.getElementById(`status-${sentenceId}`);
    
    if (!inputEl || !statusEl) return;
    
    const userInput = inputEl.value.trim();
    if (!userInput) {
      statusEl.textContent = "Please type your answer first.";
      statusEl.className = "sentence-status error";
      return;
    }
    
    const userWords = normalize(userInput).split(" ").filter(Boolean);
    const expectedWords = normalize(sentence.text).split(" ").filter(Boolean);
    
    // Check which keywords are missing
    const missingKeywords = [];
    sentence.keywords.forEach((keyword) => {
      const found = userWords.some(word => normalize(word) === normalize(keyword));
      if (!found) {
        missingKeywords.push(keyword);
      }
    });
    
    if (missingKeywords.length === 0) {
      statusEl.textContent = "✓ All keywords typed correctly!";
      statusEl.className = "sentence-status correct";
    } else {
      statusEl.textContent = `You missed these words: ${missingKeywords.join(", ")}`;
      statusEl.className = "sentence-status incorrect";
    }
  };

  // Record and assess a generated sentence
  let sentenceRecognition = null;
  const recordGeneratedSentence = (idx, btn) => {
    if (!SpeechRecognition) {
      alert("Speech recognition not available in your browser.");
      return;
    }
    
    if (!window.generatedSentencesData || !window.generatedSentencesData[idx]) return;
    
    const sentence = window.generatedSentencesData[idx];
    const statusEl = document.getElementById(`status-sentence-${idx}`);
    
    if (sentenceRecognition) {
      sentenceRecognition.stop();
      sentenceRecognition = null;
      btn.textContent = "Record";
      return;
    }
    
    btn.textContent = "Stop";
    statusEl.textContent = "Listening...";
    
    sentenceRecognition = new SpeechRecognition();
    sentenceRecognition.continuous = false;
    sentenceRecognition.interimResults = false;
    sentenceRecognition.lang = "en-US";
    
    sentenceRecognition.onresult = (event) => {
      const spokenText = event.results[0][0].transcript.trim().toLowerCase();
      const spokenWords = normalize(spokenText).split(" ").filter(Boolean);
      
      // Check which keywords are missing
      const missingKeywords = [];
      sentence.keywords.forEach((keyword) => {
        const found = spokenWords.some(word => normalize(word) === normalize(keyword));
        if (!found) {
          missingKeywords.push(keyword);
        }
      });
      
      if (missingKeywords.length === 0) {
        statusEl.textContent = "✓ All keywords spoken correctly!";
        statusEl.className = "sentence-status correct";
      } else {
        statusEl.textContent = `You missed these words: ${missingKeywords.join(", ")}`;
        statusEl.className = "sentence-status incorrect";
      }
      
      sentenceRecognition = null;
      btn.textContent = "Record";
    };
    
    sentenceRecognition.onerror = (event) => {
      if (event.error !== "aborted") {
        statusEl.textContent = `Error: ${event.error}`;
        statusEl.className = "sentence-status error";
      }
      sentenceRecognition = null;
      btn.textContent = "Record";
    };
    
    sentenceRecognition.onend = () => {
      sentenceRecognition = null;
      btn.textContent = "Record";
    };
    
    try {
      sentenceRecognition.start();
    } catch (e) {
      statusEl.textContent = "Failed to start recording";
      statusEl.className = "sentence-status error";
      sentenceRecognition = null;
      btn.textContent = "Record";
    }
  };

  // Type mode event listeners
  generateBtnType.addEventListener("click", generateSentencesType);
  
  // Show All sentences (Type mode)
  showAllSentencesBtnType.addEventListener("click", () => {
    const sentenceTexts = generatedSentencesType.querySelectorAll(".sentence-text");
    const showBtns = generatedSentencesType.querySelectorAll(".sentence-show-btn, .sentence-hide-btn");
    
    sentenceTexts.forEach((textEl) => {
      textEl.style.display = "block";
    });
    showBtns.forEach((btn) => {
      btn.textContent = "Hide";
      btn.classList.add("sentence-hide-btn");
      btn.classList.remove("sentence-show-btn");
    });
  });
  
  // Hide All sentences (Type mode)
  hideAllSentencesBtnType.addEventListener("click", () => {
    const sentenceTexts = generatedSentencesType.querySelectorAll(".sentence-text");
    const showBtns = generatedSentencesType.querySelectorAll(".sentence-show-btn, .sentence-hide-btn");
    
    sentenceTexts.forEach((textEl) => {
      textEl.style.display = "none";
    });
    showBtns.forEach((btn) => {
      btn.textContent = "Show";
      btn.classList.add("sentence-show-btn");
      btn.classList.remove("sentence-hide-btn");
    });
  });

  // Speak mode event listeners
  generateBtnSpeak.addEventListener("click", generateSentencesSpeak);
  
  // Show All sentences (Speak mode)
  showAllSentencesBtnSpeak.addEventListener("click", () => {
    const sentenceTexts = generatedSentencesSpeak.querySelectorAll(".sentence-text");
    const showBtns = generatedSentencesSpeak.querySelectorAll(".sentence-show-btn, .sentence-hide-btn");
    
    sentenceTexts.forEach((textEl) => {
      textEl.style.display = "block";
    });
    showBtns.forEach((btn) => {
      btn.textContent = "Hide";
      btn.classList.add("sentence-hide-btn");
      btn.classList.remove("sentence-show-btn");
    });
  });
  
  // Hide All sentences (Speak mode)
  hideAllSentencesBtnSpeak.addEventListener("click", () => {
    const sentenceTexts = generatedSentencesSpeak.querySelectorAll(".sentence-text");
    const showBtns = generatedSentencesSpeak.querySelectorAll(".sentence-show-btn, .sentence-hide-btn");
    
    sentenceTexts.forEach((textEl) => {
      textEl.style.display = "none";
    });
    showBtns.forEach((btn) => {
      btn.textContent = "Show";
      btn.classList.add("sentence-show-btn");
      btn.classList.remove("sentence-hide-btn");
    });
  });
  
  // Skip Animation button
  if (skipAnimationBtn) {
    skipAnimationBtn.addEventListener("click", skipAnimation);
  }

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
        // Use diffWords to find missing words
        const diff = diffWords(spokenText, expectedSegment);
        const missingWords = [];
        diff.forEach((part) => {
          if (part.type === "missing") {
            missingWords.push(part.text);
          }
        });
        
        if (missingWords.length > 0) {
          statusEl.textContent = `Incorrect, you are missing these words: ${missingWords.join(", ")}; try practicing them in Pronunciation Practice first`;
        } else {
          statusEl.textContent = `Incorrect. Expected: "${expectedSegment}"`;
        }
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


