const fs = require('fs');
const path = require('path');
const { callOllamaChatJson } = require('./ollama-json-client');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const QUESTIONS_JSON_PATH = path.join(PROJECT_ROOT, 'public', 'database', 'DD', 'dd-questions.json');
const AUDIT_JSON_PATH = path.join(PROJECT_ROOT, 'public', 'database', 'DD', 'dd-explanation-audit.json');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const rewrite = args.includes('--rewrite');
const maxRewrites = parseInt(args.find((_, i, a) => a[i - 1] === '--max-rewrites') || '200', 10);
const reportMdPath = args.find((_, i, a) => a[i - 1] === '--report-md') || path.join(PROJECT_ROOT, 'docs', 'audits', '2026-05-21-dd-explanation-audit.md');
const limitArg = parseInt(args.find((_, i, a) => a[i - 1] === '--limit') || '0', 10);

function escapeRegex(string) {
  return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function auditExplanation(question, blank) {
  const errors = [];
  const exp = blank.explanation;

  if (!exp || typeof exp !== 'string' || exp.trim().length === 0) {
    errors.push('Explanation is missing or empty');
    return { passed: false, errors };
  }

  // 1. Length check: 45 to 130 words
  const wordCount = exp.trim().split(/\s+/).length;
  if (wordCount < 45 || wordCount > 130) {
    errors.push(`Explanation length (${wordCount} words) is outside target of 45-130 words`);
  }

  // 2. Mentions correct answer check
  const answerLower = blank.answer.toLowerCase();
  const expLower = exp.toLowerCase();
  if (!expLower.includes(answerLower)) {
    // Check if plural or singular or simple stem works, but strictly let's flag if it doesn't contain the exact string
    errors.push(`Explanation does not mention the correct answer: '${blank.answer}'`);
  }

  // 3. Does not claim a distractor is correct
  const distractors = question.options.filter(o => o.kind === 'distractor').map(o => o.text);
  for (const dist of distractors) {
    const distEscaped = escapeRegex(dist);
    // regex pattern like: distractor is correct, distractor is the correct, correct is distractor
    const patterns = [
      new RegExp(`\\b${distEscaped}\\s+(?:is\\s+)?(?:the\\s+)?correct`, 'i'),
      new RegExp(`correct\\s+answer\\s+is\\s+${distEscaped}`, 'i'),
      new RegExp(`correct\\s+choice\\s+is\\s+${distEscaped}`, 'i'),
      new RegExp(`\\b${distEscaped}\\s+fits\\s+as\\s+(?:the\\s+)?correct`, 'i')
    ];
    for (const pattern of patterns) {
      if (pattern.test(exp)) {
        errors.push(`Explanation claims distractor '${dist}' is correct via pattern matching`);
        break;
      }
    }
  }

  // 4. No markdown fences, JSON brackets, HTML tags
  if (/```|[{}]|<\/?[a-z][^>]*>/i.test(exp)) {
    errors.push('Explanation contains markdown fences, JSON brackets, or HTML tags');
  }

  return {
    passed: errors.length === 0,
    errors
  };
}

async function rewriteExplanation(question, blank, errors) {
  const optionsText = question.options.map(o => o.text).join(', ');
  const prompt = `You are an expert English language teacher. We generated an explanation for a PTE Drag & Drop practice blank, but it failed our quality audit.
Please rewrite the explanation to fix the issues.

Passage:
${question.plainText}

Blank ID: ${blank.blankId}
Correct Answer: ${blank.answer}
Available options: [${optionsText}]

Previous Explanation (Failed):
${blank.explanation}

Audit Failure Reasons:
- ${errors.join('\n- ')}

Rewrite the explanation to be a high-quality explanation. It must:
1. Explain why '${blank.answer}' is the correct choice in context (coherence, cohesion, grammar, collocations).
2. Explicitly mention the correct answer '${blank.answer}'.
3. Do not claim any of the distractors are correct.
4. Be between 45 and 130 words long.
5. Contain absolutely NO markdown formatting, JSON brackets, HTML tags, or code blocks. Just plain text.

Return ONLY the rewritten plain text explanation in JSON format with "explanation" key, matching this schema:
{
  "explanation": "..."
}`;

  const messages = [{ role: 'user', content: prompt }];
  const responseRaw = await callOllamaChatJson(messages);
  let parsed;
  try {
    let cleaned = responseRaw.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    const match = responseRaw.match(/\{[\s\S]*?\}/);
    if (match) {
      parsed = JSON.parse(match[0]);
    } else {
      throw new Error(`Failed to parse JSON rewrite response: ${responseRaw}`);
    }
  }

  return parsed.explanation || '';
}

async function run() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Drag & Drop Explanation Auditor');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  File: ${QUESTIONS_JSON_PATH}`);
  console.log(`  Check Only: ${checkOnly}`);
  console.log(`  Rewrite: ${rewrite}`);
  console.log(`  Max Rewrites: ${maxRewrites}`);
  console.log(`  Limit: ${limitArg || 'all'}`);
  console.log('');

  if (!fs.existsSync(QUESTIONS_JSON_PATH)) {
    console.error(`Error: File not found at ${QUESTIONS_JSON_PATH}.`);
    process.exit(1);
  }

  const raw = fs.readFileSync(QUESTIONS_JSON_PATH, 'utf8');
  const questions = JSON.parse(raw);
  console.log(`Loaded ${questions.length} questions.`);

  const auditReport = {
    totalQuestions: questions.length,
    totalBlanks: 0,
    passedBlanks: 0,
    failedBlanks: 0,
    failures: []
  };

  let rewritesDone = 0;
  let questionsUpdated = false;
  let processedCount = 0;

  for (const q of questions) {
    if (limitArg > 0 && processedCount >= limitArg) {
      break;
    }
    let qHasUpdates = false;

    for (const blank of q.blanks) {
      auditReport.totalBlanks++;

      const res = auditExplanation(q, blank);
      if (res.passed) {
        auditReport.passedBlanks++;
      } else {
        auditReport.failedBlanks++;
        auditReport.failures.push({
          questionId: q.id,
          questionTitle: q.title,
          blankId: blank.blankId,
          answer: blank.answer,
          explanation: blank.explanation || '',
          errors: res.errors
        });

        if (rewrite && rewritesDone < maxRewrites) {
          console.log(`Rewriting Q#${q.id} "${q.title}" -> Blank ${blank.blankId} (${blank.answer})...`);
          try {
            const rewritten = await rewriteExplanation(q, blank, res.errors);
            if (rewritten && rewritten.trim().length > 0) {
              blank.explanation = rewritten.trim();
              blank.status = 'rewritten';
              // Re-audit to verify
              const reAudit = auditExplanation(q, blank);
              if (reAudit.passed) {
                console.log(`  ✓ Rewrite PASSED subsequent audit.`);
                auditReport.passedBlanks++;
                auditReport.failedBlanks--;
                // Remove from failures list
                auditReport.failures.pop();
              } else {
                console.warn(`  ⚠ Rewrite FAILED subsequent audit: ${reAudit.errors.join('; ')}`);
                // Update error details in report
                auditReport.failures[auditReport.failures.length - 1].explanation = rewritten;
                auditReport.failures[auditReport.failures.length - 1].errors = reAudit.errors;
              }
              rewritesDone++;
              qHasUpdates = true;
              questionsUpdated = true;
            }
          } catch (err) {
            console.error(`  ❌ Rewrite failed: ${err.message}`);
          }
        }
      }
    }

    if (qHasUpdates) {
      fs.writeFileSync(QUESTIONS_JSON_PATH, JSON.stringify(questions, null, 2), 'utf8');
      console.log(`Saved Q#${q.id} changes after rewrite.`);
    }

    processedCount++;
  }

  // Save audit report JSON
  fs.mkdirSync(path.dirname(AUDIT_JSON_PATH), { recursive: true });
  fs.writeFileSync(AUDIT_JSON_PATH, JSON.stringify(auditReport, null, 2), 'utf8');
  console.log(`Audit report JSON written to: ${AUDIT_JSON_PATH}`);

  // Generate markdown report
  const mdLines = [
    `# Drag & Drop Explanation Audit Report`,
    ``,
    `- **Date:** ${new Date().toISOString().split('T')[0]}`,
    `- **Total Questions Evaluated:** ${auditReport.totalQuestions}`,
    `- **Total Blanks Evaluated:** ${auditReport.totalBlanks}`,
    `- **Passed Blanks:** ${auditReport.passedBlanks} (${((auditReport.passedBlanks / auditReport.totalBlanks) * 100).toFixed(1)}%)`,
    `- **Failed Blanks:** ${auditReport.failedBlanks} (${((auditReport.failedBlanks / auditReport.totalBlanks) * 100).toFixed(1)}%)`,
    ``,
    `## Summary of Failures`,
    ``
  ];

  if (auditReport.failures.length === 0) {
    mdLines.push(`✓ All evaluated explanations passed the quality audit successfully!`);
  } else {
    mdLines.push(`| Question ID | Blank ID | Answer | Failures |`);
    mdLines.push(`|---|---|---|---|`);
    for (const fail of auditReport.failures) {
      mdLines.push(`| ${fail.questionId} | ${fail.blankId} | \`${fail.answer}\` | ${fail.errors.join('; ')} |`);
    }
  }

  fs.mkdirSync(path.dirname(reportMdPath), { recursive: true });
  fs.writeFileSync(reportMdPath, mdLines.join('\n'), 'utf8');
  console.log(`Audit report Markdown written to: ${reportMdPath}`);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Audit Finished.');
  console.log(`  Total Blanks: ${auditReport.totalBlanks}`);
  console.log(`  Passed: ${auditReport.passedBlanks}`);
  console.log(`  Failed: ${auditReport.failedBlanks}`);
  console.log(`  Rewrites Executed: ${rewritesDone}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (checkOnly && auditReport.failedBlanks > 0) {
    console.error('Audit failed: One or more explanations did not pass quality checks.');
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
