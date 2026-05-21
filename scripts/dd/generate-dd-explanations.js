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
  return `You are an expert English language teacher preparing material for a PTE Academic Practice test.
Analyze this passage and explain why the word "${blank.answer}" is the correct choice for the blank (correct answer: "${blank.answer}").

Passage:
${question.plainText}

Available options (word bank):
[${optionsText}]

For the blank (correct answer: "${blank.answer}"), generate a clear explanation in JSON format.
Ensure you address:
1. "explanation": Explain why the correct answer is the right choice (coherence, cohesion, vocabulary fit, grammar, syntax). Keep it under 130 words.
2. "coherenceCue": Provide a short cue about how the context/coherence leads to this answer.
3. "vocabGrammarCue": Provide a short cue explaining why this word works grammatically or collocations.
4. "contextNote": Highlight a specific context clue or clue word from the passage.
5. "distractorNotes": An array of objects with "option" and "reason" explaining why other options are incorrect.

Return ONLY a JSON object matching this schema exactly, with no markdown formatting or wrapper around it:
{
  "explanation": "...",
  "coherenceCue": "...",
  "vocabGrammarCue": "...",
  "contextNote": "...",
  "distractorNotes": [
    { "option": "incorrect_word", "reason": "why it doesn't fit" }
  ]
}`;
}

async function run() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Drag & Drop Explanation Generator (Ollama)');
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

      if (resume && blank.explanation && typeof blank.explanation === 'string' && blank.explanation.trim().length > 0) {
        continue;
      }

      needsUpdate = true;
      console.log(`Generating explanation for Q#${q.id} "${q.title}" -> Blank #${j + 1} (${blank.answer})...`);

      const prompt = buildPrompt(q, blank);
      const messages = [{ role: 'user', content: prompt }];

      try {
        const rawResponse = await callOllamaChatJson(messages);
        let parsed;
        try {
          // Strip any markdown code fence wrappers
          let cleaned = rawResponse.trim();
          cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
          parsed = JSON.parse(cleaned);
        } catch (e) {
          // Try regex fallback to find first JSON block
          const match = rawResponse.match(/\{[\s\S]*?\}/);
          if (match) {
            parsed = JSON.parse(match[0]);
          } else {
            throw new Error(`Failed to parse JSON response from Ollama: ${rawResponse.slice(0, 100)}...`);
          }
        }

        blank.explanation = parsed.explanation || '';
        blank.coherenceCue = parsed.coherenceCue || '';
        blank.vocabGrammarCue = parsed.vocabGrammarCue || '';
        blank.contextNote = parsed.contextNote || '';
        blank.distractorNotes = parsed.distractorNotes || [];
        blank.model = 'gemma4:latest';
        blank.status = 'generated';

        successCount++;
      } catch (err) {
        console.error(`  ❌ Failed to generate explanation for Q#${q.id} Blank #${j + 1}: ${err.message}`);
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
