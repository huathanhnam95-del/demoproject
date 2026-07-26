const fs = require('fs');
const path = require('path');
const { callOllamaChatJson } = require('./ollama-json-client');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const QUESTIONS_JSON_PATH = path.join(PROJECT_ROOT, 'public', 'database', 'DD', 'dd-questions.json');

const args = process.argv.slice(2);
const limitArg = parseInt(args.find((_, i, a) => a[i - 1] === '--limit') || '0', 10);
const resume = args.includes('--resume');
const targetQuestionId = parseInt(args.find((_, i, a) => a[i - 1] === '--question-id') || '0', 10);

function buildPrompt(question, blank) {
  const optionsText = question.options.map(o => o.text).join(', ');
  const allCorrectAnswers = question.blanks.map(b => b.answer);
  const extraDistractors = question.options
    .map(o => o.text)
    .filter(t => !allCorrectAnswers.includes(t));

  return `You are an expert English language teacher preparing material for a PTE Academic Reading Practice test (Drag & Drop / Fill in the Blanks).

Analyze this passage and explain why the word "${blank.answer}" is the correct choice for Blank #${blank.index + 1} (correct answer: "${blank.answer}").

Passage:
${question.plainText}

Full Word Bank (Shared Pool):
[${optionsText}]

Target Answers for other blanks in this passage (for context):
${question.blanks.map((b, idx) => `Blank #${idx + 1}: "${b.answer}"`).join('\n')}

Unused Extra Distractor Words in pool:
[${extraDistractors.join(', ')}]

For Blank #${blank.index + 1} (correct answer: "${blank.answer}"), generate a clear, pedagogical explanation in JSON format.

Ensure your explanation addresses:
1. "syntaxRequirement": The required Part of Speech (Noun, Verb, Adjective, etc.) and grammatical form (e.g. Past Tense Transitive Verb) for this blank.
2. "collocationCohesionClue": The specific collocations, discourse markers, or context clues that indicate this choice.
3. "explanation": A concise explanation (under 130 words) explaining why "${blank.answer}" is correct grammatically and semantically.
4. "competingOptionNotes": Array of objects with "option" and "reason" explaining why competing options in the pool are incorrect for THIS blank (distinguishing between same-PoS traps and PoS mismatches).
5. "coherenceCue": Short cue summarizing how context leads to this answer.
6. "vocabGrammarCue": Short cue on grammar/collocation fit.
7. "contextNote": Key sentence clue.

Return ONLY a JSON object matching this schema exactly, with no markdown code fences or extra text around it:
{
  "syntaxRequirement": "...",
  "collocationCohesionClue": "...",
  "explanation": "...",
  "coherenceCue": "...",
  "vocabGrammarCue": "...",
  "contextNote": "...",
  "competingOptionNotes": [
    { "option": "word", "reason": "why it does not fit this blank" }
  ]
}`;
}

function buildReviewPrompt(question, blank, initialDraft) {
  return `You are a Senior PTE English Language Master Editor auditing and refining AI-generated practice test explanations.

Passage:
${question.plainText}

Target Blank: Blank #${blank.index + 1} (Correct Answer: "${blank.answer}")

Draft Explanation to Review:
${JSON.stringify(initialDraft, null, 2)}

Audit Rubric:
1. "syntaxRequirement": Ensure the Part of Speech and grammatical form (e.g. Past Tense Transitive Verb) is 100% accurate.
2. "collocationCohesionClue": Verify the collocation or sentence context cue is concise, natural, and helpful for B1-B2 learners.
3. "explanation": Edit the explanation to be crystal clear, professional, pedagogical, and under 120 words. Eliminate any repetitive phrases.
4. "competingOptionNotes": Review each distractor reason. Ensure reasons are accurate (correctly distinguishing PoS mismatches from same-PoS traps).

Return ONLY the final, polished JSON object matching the schema below, with no markdown wrappers:
{
  "syntaxRequirement": "...",
  "collocationCohesionClue": "...",
  "explanation": "...",
  "coherenceCue": "...",
  "vocabGrammarCue": "...",
  "contextNote": "...",
  "competingOptionNotes": [
    { "option": "word", "reason": "why it does not fit this blank" }
  ]
}`;
}

async function run() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Drag & Drop Explanation Generator (2-Pass Ollama / Gemma AI)');
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

    let needsUpdate = false;
    for (let j = 0; j < q.blanks.length; j++) {
      const blank = q.blanks[j];

      if (resume && blank.explanation && typeof blank.explanation === 'string' && blank.explanation.trim().length > 0 && blank.reviewPass === true) {
        continue;
      }

      needsUpdate = true;
      console.log(`[Pass 1: Generate] Q#${q.id} "${q.title}" -> Blank #${j + 1} (${blank.answer})...`);

      const prompt = buildPrompt(q, blank);
      const messages = [{ role: 'user', content: prompt }];

      try {
        // Pass 1: Generate initial explanation
        const rawResponse = await callOllamaChatJson(messages);
        let parsed;
        try {
          let cleaned = rawResponse.trim();
          cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
          parsed = JSON.parse(cleaned);
        } catch (e) {
          const match = rawResponse.match(/\{[\s\S]*?\}/);
          if (match) {
            parsed = JSON.parse(match[0]);
          } else {
            throw new Error(`Failed to parse JSON response from Ollama: ${rawResponse.slice(0, 100)}...`);
          }
        }

        // Pass 2: Review & Edit with local Gemma AI
        console.log(`  [Pass 2: Review & Edit] Q#${q.id} Blank #${j + 1}...`);
        const reviewPrompt = buildReviewPrompt(q, blank, parsed);
        const reviewMessages = [{ role: 'user', content: reviewPrompt }];
        const rawReviewResponse = await callOllamaChatJson(reviewMessages);
        
        let reviewed;
        try {
          let cleanedRev = rawReviewResponse.trim();
          cleanedRev = cleanedRev.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
          reviewed = JSON.parse(cleanedRev);
        } catch (e) {
          const matchRev = rawReviewResponse.match(/\{[\s\S]*?\}/);
          if (matchRev) {
            reviewed = JSON.parse(matchRev[0]);
          } else {
            // Fallback to Pass 1 if Pass 2 JSON parsing fails
            reviewed = parsed;
          }
        }

        blank.explanation = reviewed.explanation || parsed.explanation || '';
        blank.syntaxRequirement = reviewed.syntaxRequirement || parsed.syntaxRequirement || '';
        blank.collocationCohesionClue = reviewed.collocationCohesionClue || parsed.collocationCohesionClue || '';
        blank.coherenceCue = reviewed.coherenceCue || parsed.coherenceCue || '';
        blank.vocabGrammarCue = reviewed.vocabGrammarCue || parsed.vocabGrammarCue || '';
        blank.contextNote = reviewed.contextNote || parsed.contextNote || '';
        blank.distractorNotes = reviewed.competingOptionNotes || reviewed.distractorNotes || parsed.competingOptionNotes || [];
        blank.model = 'gemma4:latest';
        blank.reviewPass = true;
        blank.status = 'generated';

        successCount++;
      } catch (err) {
        console.error(`  ❌ Failed to generate/review explanation for Q#${q.id} Blank #${j + 1}: ${err.message}`);
        blank.explanation = null;
        blank.status = 'generation_failed';
        blank.error = err.message;
        failCount++;
      }
    }


    if (needsUpdate) {
      processedCount++;
      // Save after each question updated
      fs.writeFileSync(QUESTIONS_JSON_PATH, JSON.stringify(questions, null, 2), 'utf8');
      console.log(`Saved Q#${q.id} changes to questions JSON file.`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Generator Finished.');
  console.log(`  Processed: ${processedCount} questions`);
  console.log(`  Succeeded: ${successCount} explanations`);
  console.log(`  Failed: ${failCount} explanations`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

run().catch(err => {
  console.error('Fatal generator error:', err);
  process.exit(1);
});
