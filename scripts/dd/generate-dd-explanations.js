const fs = require('fs');
const path = require('path');
const { callOllamaChatJson, OLLAMA_MODEL } = require('./ollama-json-client');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const QUESTIONS_JSON_PATH = path.join(PROJECT_ROOT, 'public', 'database', 'DD', 'dd-questions.json');

const args = process.argv.slice(2);
const limitArg = parseInt(args.find((_, i, a) => a[i - 1] === '--limit') || '0', 10);
const resume = args.includes('--resume');
const targetQuestionId = parseInt(args.find((_, i, a) => a[i - 1] === '--question-id') || '0', 10);

function safeSaveFile(filePath, content, maxRetries = 5) {
  const tempPath = `${filePath}.tmp_${Date.now()}`;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      fs.writeFileSync(tempPath, content, 'utf8');
      fs.renameSync(tempPath, filePath);
      return;
    } catch (err) {
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (_) {}
      }
      if (attempt === maxRetries) {
        fs.writeFileSync(filePath, content, 'utf8');
        return;
      }
      console.warn(`  ⚠️ File save attempt ${attempt}/${maxRetries} encountered lock (${err.message}). Retrying in 500ms...`);
      const stop = Date.now() + 500;
      while (Date.now() < stop) {}
    }
  }
}

// Pass 1: Question-Level Batched Prompt
function buildQuestionPrompt(question) {
  const optionsText = question.options.map(o => o.text).join(', ');
  const allCorrectAnswers = question.blanks.map(b => b.answer);
  const extraDistractors = question.options
    .map(o => o.text)
    .filter(t => !allCorrectAnswers.includes(t));

  return `You are an expert English language teacher preparing material for a PTE Academic Reading Practice test (Drag & Drop / Fill in the Blanks).

Analyze this entire passage and ALL its blank gaps holistically.

Passage:
${question.plainText}

Shared Word Bank (Pool of Options):
[${optionsText}]

Blanks & Target Answers:
${question.blanks.map((b, idx) => `Blank #${idx + 1} (blankId: "${b.blankId}") -> Correct Answer: "${b.answer}"`).join('\n')}

Unused Extra Distractor Words in pool (not used in any blank):
[${extraDistractors.join(', ')}]

Generate a clear, pedagogical explanation object for EVERY blank gap in this question in a single JSON payload.

For EACH blank in the "blanks" array, provide:
1. "blankId": Exact blankId matching the target blank.
2. "syntaxRequirement": The required Part of Speech (Noun, Verb, Adjective, etc.) and grammatical form (e.g. Past Tense Transitive Verb).
3. "collocationCohesionClue": The specific collocations, discourse markers, or context clues in the sentence.
4. "explanation": A concise explanation (under 120 words) explaining why this answer is correct grammatically and semantically.
5. "competingOptionNotes": Array of objects with "option" and "reason". Include cross-blank context (e.g., explicitly noting if a distractor belongs to another blank in the text vs an unused pool distractor).

Return ONLY a JSON object matching this schema exactly, with no markdown code fences or extra text:
{
  "blanks": [
    {
      "blankId": "...",
      "syntaxRequirement": "...",
      "collocationCohesionClue": "...",
      "explanation": "...",
      "coherenceCue": "...",
      "vocabGrammarCue": "...",
      "contextNote": "...",
      "competingOptionNotes": [
        { "option": "word", "reason": "why it does not fit this specific blank" }
      ]
    }
  ]
}`;
}

// Pass 2: Question-Level Master Editor Review Prompt
function buildQuestionReviewPrompt(question, initialDraft) {
  return `You are a Senior PTE English Language Master Editor auditing and refining AI-generated practice test explanations for a Reading Drag & Drop question.

Passage:
${question.plainText}

Shared Word Bank:
[${question.options.map(o => o.text).join(', ')}]

Draft Explanations to Review:
${JSON.stringify(initialDraft, null, 2)}

Audit Rubric:
1. "syntaxRequirement": Ensure the Part of Speech and grammatical form for each blank is 100% accurate.
2. "collocationCohesionClue": Verify collocations and sentence context cues are natural and clear for B1-B2 learners.
3. "explanation": Refine explanations to be crystal clear, professional, pedagogical, and under 120 words.
4. "competingOptionNotes": Audit distractor reasons. Ensure cross-blank distinctions are accurate (explicitly noting when a distractor belongs to another blank vs a global distractor).

Return ONLY the final, polished JSON object matching the exact same schema with no markdown code fences:
{
  "blanks": [
    {
      "blankId": "...",
      "syntaxRequirement": "...",
      "collocationCohesionClue": "...",
      "explanation": "...",
      "coherenceCue": "...",
      "vocabGrammarCue": "...",
      "contextNote": "...",
      "competingOptionNotes": [
        { "option": "word", "reason": "why it does not fit this specific blank" }
      ]
    }
  ]
}`;
}

// Single Blank Fallback Prompt if batched call ever fails
function buildSingleBlankPrompt(question, blank) {
  const optionsText = question.options.map(o => o.text).join(', ');
  return `You are an expert English language teacher. Explain why "${blank.answer}" is correct for Blank #${blank.index + 1} in this passage:
${question.plainText}
Word bank: [${optionsText}]

Return ONLY JSON:
{
  "syntaxRequirement": "...",
  "collocationCohesionClue": "...",
  "explanation": "...",
  "coherenceCue": "...",
  "vocabGrammarCue": "...",
  "contextNote": "...",
  "competingOptionNotes": [
    { "option": "word", "reason": "why it does not fit" }
  ]
}`;
}

async function run() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Drag & Drop Explanation Generator (Option B: Question-Level 2-Pass)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  File: ${QUESTIONS_JSON_PATH}`);
  console.log(`  Resume: ${resume}`);
  console.log(`  Limit: ${limitArg || 'all'}`);
  console.log(`  Question ID: ${targetQuestionId || 'all'}`);
  console.log('');

  if (!fs.existsSync(QUESTIONS_JSON_PATH)) {
    console.error(`Error: File not found at ${QUESTIONS_JSON_PATH}. Run build-dd-dataset.js first.`);
    process.exit(1);
  }

  const raw = fs.readFileSync(QUESTIONS_JSON_PATH, 'utf8');
  const questions = JSON.parse(raw);
  console.log(`Loaded ${questions.length} questions.`);

  let processedCount = 0;
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];

    if (targetQuestionId > 0 && q.id !== targetQuestionId) {
      continue;
    }

    if (limitArg > 0 && processedCount >= limitArg) {
      break;
    }

    // Question-level resume check: skip only if all blanks have OptionB-v1 batchVersion
    const allBlanksUpToDate = q.blanks.every(b => 
      b.explanation && 
      typeof b.explanation === 'string' && 
      b.explanation.trim().length > 0 && 
      (b.batchVersion === 'OptionB-v1' || b.reviewPass === true)
    );

    if (resume && allBlanksUpToDate) {
      continue;
    }

    console.log(`\n[Q#${q.id} "${q.title}"] Processing ${q.blanks.length} blanks with Option B...`);

    let questionSuccess = false;
    let generatedData = null;

    // Pass 1: Question-Level Batch Generation
    try {
      console.log(`  [Pass 1: Question-Level Batch Generate] Q#${q.id}...`);
      const prompt = buildQuestionPrompt(q);
      const rawResponse = await callOllamaChatJson([{ role: 'user', content: prompt }]);
      
      let parsed;
      try {
        let cleaned = rawResponse.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
        parsed = JSON.parse(cleaned);
      } catch (e) {
        const match = rawResponse.match(/\{[\s\S]*\}/);
        if (match) {
          parsed = JSON.parse(match[0]);
        } else {
          throw new Error('Failed to parse batched JSON response');
        }
      }

      if (parsed && Array.isArray(parsed.blanks) && parsed.blanks.length > 0) {
        console.log(`    → Received ${parsed.blanks.length}/${q.blanks.length} blank explanations`);
        if (parsed.blanks.length !== q.blanks.length) {
          console.warn(`    ⚠️ Blank count mismatch! Expected ${q.blanks.length}, got ${parsed.blanks.length}`);
        }
        // Pass 2: Question-Level Master Editor Review
        console.log(`  [Pass 2: Question-Level Master Review] Q#${q.id}...`);
        const reviewPrompt = buildQuestionReviewPrompt(q, parsed);
        const rawReview = await callOllamaChatJson([{ role: 'user', content: reviewPrompt }]);

        let reviewed;
        try {
          let cleanedRev = rawReview.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
          reviewed = JSON.parse(cleanedRev);
        } catch (e) {
          const matchRev = rawReview.match(/\{[\s\S]*\}/);
          if (matchRev) {
            reviewed = JSON.parse(matchRev[0]);
          } else {
            reviewed = parsed;
          }
        }

        generatedData = (reviewed && Array.isArray(reviewed.blanks) && reviewed.blanks.length > 0) ? reviewed : parsed;
        questionSuccess = true;
      }
    } catch (err) {
      console.warn(`  ⚠️ Question-level batching failed for Q#${q.id} (${err.message}). Falling back to single-blank processing...`);
    }

    // Apply results or Single-Blank Fallback
    for (let j = 0; j < q.blanks.length; j++) {
      const blank = q.blanks[j];
      const rawMatch = questionSuccess && generatedData && generatedData.blanks 
        ? (generatedData.blanks.find(b => b.blankId === blank.blankId) || generatedData.blanks[j])
        : null;
      const matchData = rawMatch && rawMatch.explanation && rawMatch.explanation.trim().length > 0
        ? rawMatch
        : null;

      if (matchData) {
        blank.explanation = matchData.explanation || '';
        blank.syntaxRequirement = matchData.syntaxRequirement || '';
        blank.collocationCohesionClue = matchData.collocationCohesionClue || '';
        blank.coherenceCue = matchData.coherenceCue || '';
        blank.vocabGrammarCue = matchData.vocabGrammarCue || '';
        blank.contextNote = matchData.contextNote || '';
        blank.distractorNotes = matchData.competingOptionNotes || matchData.distractorNotes || [];
        blank.model = OLLAMA_MODEL;
        blank.reviewPass = true;
        blank.batchVersion = 'OptionB-v1';
        blank.status = 'generated';
        successCount++;
      } else {
        // Single Blank Fallback
        console.log(`  [Fallback Single Blank] Q#${q.id} Blank #${j + 1} (${blank.answer})...`);
        try {
          const fbPrompt = buildSingleBlankPrompt(q, blank);
          const rawFb = await callOllamaChatJson([{ role: 'user', content: fbPrompt }]);
          let parsedFb;
          try {
            parsedFb = JSON.parse(rawFb.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim());
          } catch (e) {
            const m = rawFb.match(/\{[\s\S]*?\}/);
            parsedFb = m ? JSON.parse(m[0]) : {};
          }

          blank.explanation = parsedFb.explanation || '';
          blank.syntaxRequirement = parsedFb.syntaxRequirement || '';
          blank.collocationCohesionClue = parsedFb.collocationCohesionClue || '';
          blank.coherenceCue = parsedFb.coherenceCue || '';
          blank.vocabGrammarCue = parsedFb.vocabGrammarCue || '';
          blank.contextNote = parsedFb.contextNote || '';
          blank.distractorNotes = parsedFb.competingOptionNotes || parsedFb.distractorNotes || [];
          blank.model = OLLAMA_MODEL;
          blank.reviewPass = true;
          blank.batchVersion = 'OptionB-v1';
          blank.status = 'generated';
          successCount++;
        } catch (err) {
          console.error(`  ❌ Fallback failed for Q#${q.id} Blank #${j + 1}: ${err.message}`);
          blank.status = 'generation_failed';
          blank.error = err.message;
          failCount++;
        }
      }
    }

    processedCount++;
    safeSaveFile(QUESTIONS_JSON_PATH, JSON.stringify(questions, null, 2));
    console.log(`Saved Q#${q.id} changes (OptionB-v1) to questions JSON file.`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Generator Finished.');
  console.log(`  Processed: ${processedCount} questions`);
  console.log(`  Succeeded: ${successCount} blank explanations`);
  console.log(`  Failed: ${failCount} blank explanations`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

run().catch(err => {
  console.error('Fatal generator error:', err);
  process.exit(1);
});
