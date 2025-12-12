(() => {
  const correctSentence =
    "Next time, we'll discuss the influence of the media on public policy."; // TODO: set the actual sentence text

  const audio = document.getElementById("audio");
  const playBtn = document.getElementById("play-btn");
  const checkBtn = document.getElementById("check-btn");
  const input = document.getElementById("answer-input");
  const result = document.getElementById("result");

  const normalize = (text) =>
    text
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();

  const diffWords = (user, correct) => {
    const userWords = normalize(user).split(" ").filter(Boolean);
    const correctWords = normalize(correct).split(" ").filter(Boolean);

    const maxLen = Math.max(userWords.length, correctWords.length);
    const pieces = [];
    for (let i = 0; i < maxLen; i += 1) {
      const u = userWords[i];
      const c = correctWords[i];
      if (u === undefined) {
        pieces.push({ text: c, type: "missing" });
      } else if (c === undefined) {
        pieces.push({ text: u, type: "extra" });
      } else if (u === c) {
        pieces.push({ text: u, type: "match" });
      } else {
        pieces.push({ text: u, type: "mismatch", expected: c });
      }
    }
    return pieces;
  };

  const renderDiff = (diff) => {
    return diff
      .map((part) => {
        if (part.type === "match") return part.text;
        if (part.type === "missing")
          return `<span class="highlight-miss">[missing: ${part.text}]</span>`;
        if (part.type === "extra")
          return `<span class="highlight-miss">[extra: ${part.text}]</span>`;
        if (part.type === "mismatch")
          return `<span class="highlight-miss">${part.text} (→ ${part.expected})</span>`;
        return part.text;
      })
      .join(" ");
  };

  playBtn.addEventListener("click", () => {
    audio.currentTime = 0;
    audio.play();
  });

  checkBtn.addEventListener("click", () => {
    const userAnswer = input.value;
    const diff = diffWords(userAnswer, correctSentence);
    const hasErrors = diff.some((p) => p.type !== "match");

    if (!userAnswer.trim()) {
      result.innerHTML = `<span class="errors">Please type your answer before checking.</span>`;
      return;
    }

    result.innerHTML = hasErrors
      ? `<div class="errors">Keep practicing! Differences highlighted below:</div><div>${renderDiff(diff)}</div>`
      : `<div class="ok">Great job! Perfect match.</div>`;
  });
})();

