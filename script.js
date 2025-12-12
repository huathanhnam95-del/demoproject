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

  const STEP_INTERVAL_MS = 2400;
  let lastSteps = [];
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
        return `<span class="${cls}">${display}</span>`;
      })
      .join(" ");
    animationBox.innerHTML = `
      <div class="anim-line"><strong>${step.label}</strong></div>
      <div class="anim-step">${words}</div>
    `;
  };

  const speakWord = (word) => {
    if (!synth || !word) return;
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(word);
    utter.rate = 0.95;
    utter.pitch = 1;
    synth.speak(utter);
  };

  const playAnimation = (steps, onComplete = () => {}) => {
    if (!steps.length) {
      onComplete();
      return;
    }
    if (animationTimer) clearTimeout(animationTimer);
    if (synth) synth.cancel();

    let idx = 0;
    renderAnimationStep(steps[idx]);
    if (steps[idx].speak) speakWord(steps[idx].speak);

    const advance = () => {
      idx += 1;
      if (idx >= steps.length) {
        onComplete();
        return;
      }
      renderAnimationStep(steps[idx]);
      if (steps[idx].speak) speakWord(steps[idx].speak);
      animationTimer = setTimeout(advance, STEP_INTERVAL_MS);
    };

    animationTimer = setTimeout(advance, STEP_INTERVAL_MS);
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

  playBtn.addEventListener("click", () => {
    audio.currentTime = 0;
    audio.play();
  });

  checkBtn.addEventListener("click", () => {
    const userAnswer = input.value;
    const diff = diffWords(userAnswer, correctSentence);
    const hasErrors = diff.some((p) => p.type !== "match");
    const scoreValue = diff.filter((p) => p.type === "match").length;

    if (!userAnswer.trim()) {
      result.innerHTML = `<span class="errors">Please type your answer before checking.</span>`;
      score.textContent = `Points: 0 / ${correctWordCount}`;
      return;
    }

    score.textContent = `Points: ${scoreValue} / ${correctWordCount}`;

    lastSteps = buildAnimationSteps(userAnswer);
    animationBox.innerHTML = "";
    result.innerHTML = `<div class="errors">Playing correction animation...</div>`;

    playAnimation(lastSteps, () => {
      const feedback = hasErrors
        ? `<div class="errors">Keep practicing! Differences highlighted below:</div><div>${renderDiff(diff)}</div>`
        : `<div class="ok">Great job! Perfect match.</div>`;

      result.innerHTML = `${feedback}<div class="correct-sentence">Correct sentence: ${correctSentence}</div>`;
    });
  });

  replayBtn.addEventListener("click", () => {
    if (lastSteps.length) playAnimation(lastSteps);
  });
})();

