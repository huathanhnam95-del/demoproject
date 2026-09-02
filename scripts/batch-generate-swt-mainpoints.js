/* eslint-disable no-console */
/**
 * batch-generate-swt-mainpoints.js
 *
 * Reads swt-questions.json, sends each sourceText to Gemma4 via local Ollama,
 * and populates the mainPoints array with 3–5 key points.
 *
 * Usage:
 *   node scripts/batch-generate-swt-mainpoints.js [--dry-run] [--start N] [--limit N] [--concurrency N]
 */

const fs = require('fs');
const path = require('path');

// ── Config ──
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const MODEL = process.env.LOCAL_GEMMA_MODEL || process.env.OLLAMA_MODEL || 'gemma4:12b';
const SWT_JSON_PATH = path.resolve(__dirname, '../public/database/Summarize Written Text/SWT/swt-questions.json');

const CONCURRENCY = parseInt(process.env.CONCURRENCY || '1', 10);
const SAVE_EVERY = 10; // Save progress every N questions

// ── CLI Args ──
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const startIdx = parseInt(args.find((_, i, a) => a[i - 1] === '--start') || '0', 10);
const limitArg = parseInt(args.find((_, i, a) => a[i - 1] === '--limit') || '0', 10);

// ── Prompt ──
function sanitizeText(text) {
  // Replace problematic Unicode with ASCII equivalents
  return text
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2026]/g, '...')
    .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPrompt(sourceText) {
  const clean = sanitizeText(sourceText).slice(0, 4000);
  return `Extract 3-5 main points from this passage. Return ONLY a JSON array of strings, no other text.

Passage:
${clean}

JSON array:`;
}

// ── Ollama Call ──
async function callOllama(prompt, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000); // 2min timeout

      const res = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          prompt,
          stream: false,
          options: {
            temperature: 0.3
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }

      const data = await res.json();
      return data.response || '';
    } catch (err) {
      if (attempt < retries) {
        console.warn(`  ⚠ Attempt ${attempt + 1} failed: ${err.message}. Retrying in 3s...`);
        await sleep(3000);
        continue;
      }
      throw err;
    }
  }
}

// ── Parse JSON from LLM response ──
function parseMainPoints(rawResponse) {
  // Strip markdown code fences (```json ... ```)
  let cleaned = rawResponse.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  // Try direct parse
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.every(x => typeof x === 'string')) {
      return parsed.map(s => s.trim()).filter(Boolean).slice(0, 6);
    }
  } catch (_) { /* continue */ }

  // Try extracting JSON array from text
  const match = cleaned.match(/\[[\s\S]*?\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed) && parsed.every(x => typeof x === 'string')) {
        return parsed.map(s => s.trim()).filter(Boolean).slice(0, 6);
      }
    } catch (_) { /* continue */ }
  }

  // Try line-by-line extraction (numbered list fallback)
  const lines = cleaned.split('\n')
    .map(l => l.replace(/^\d+[.)]\s*/, '').replace(/^[-*]\s*/, '').replace(/^["']|["']$/g, '').trim())
    .filter(l => l.length >= 10 && l.length <= 200);
  if (lines.length >= 2) {
    return lines.slice(0, 6);
  }

  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Main ──
async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  SWT Main Points Batch Generator (Gemma4)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (isDryRun) console.log('  🔹 DRY RUN — no files will be modified');
  console.log(`  Model: ${MODEL}`);
  console.log(`  Concurrency: ${CONCURRENCY}`);
  console.log(`  Start: ${startIdx}, Limit: ${limitArg || 'all'}`);
  console.log('');

  // Load questions
  const raw = fs.readFileSync(SWT_JSON_PATH, 'utf-8');
  const questions = JSON.parse(raw);
  console.log(`  📂 Loaded ${questions.length} questions from swt-questions.json`);

  // Filter to questions needing mainPoints
  let toProcess = questions
    .map((q, idx) => ({ q, idx }))
    .filter(({ q }) => !q.mainPoints || !Array.isArray(q.mainPoints) || q.mainPoints.length === 0);

  console.log(`  🔍 ${toProcess.length} questions need mainPoints`);

  // Apply start/limit
  if (startIdx > 0) {
    toProcess = toProcess.slice(startIdx);
  }
  if (limitArg > 0) {
    toProcess = toProcess.slice(0, limitArg);
  }

  console.log(`  🎯 Processing ${toProcess.length} questions\n`);

  if (toProcess.length === 0) {
    console.log('  ✅ All questions already have mainPoints. Nothing to do.');
    return;
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const startTime = Date.now();

  // Process in batches of CONCURRENCY
  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    const batch = toProcess.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async ({ q, idx }) => {
        const prompt = buildPrompt(q.sourceText);
        const rawResponse = await callOllama(prompt);
        const mainPoints = parseMainPoints(rawResponse);

        if (!mainPoints || mainPoints.length < 2) {
          throw new Error(`Bad parse for Q${q.id}: got ${JSON.stringify(mainPoints)}`);
        }

        return { idx, mainPoints, id: q.id, title: q.title };
      })
    );

    for (const result of results) {
      processed++;
      if (result.status === 'fulfilled') {
        const { idx, mainPoints, id, title } = result.value;
        questions[idx].mainPoints = mainPoints;
        succeeded++;
        console.log(`  ✅ [${processed}/${toProcess.length}] Q${id} "${title}" → ${mainPoints.length} points`);
      } else {
        failed++;
        console.error(`  ❌ [${processed}/${toProcess.length}] Failed: ${result.reason?.message || result.reason}`);
      }
    }

    // Save progress periodically
    if (!isDryRun && succeeded > 0 && (processed % SAVE_EVERY === 0 || i + CONCURRENCY >= toProcess.length)) {
      fs.writeFileSync(SWT_JSON_PATH, JSON.stringify(questions, null, 2), 'utf-8');
      console.log(`  💾 Saved progress (${succeeded} updated so far)`);
    }

    // Small delay between batches to avoid overwhelming Ollama
    if (i + CONCURRENCY < toProcess.length) {
      await sleep(500);
    }
  }

  // Final save
  if (!isDryRun && succeeded > 0) {
    fs.writeFileSync(SWT_JSON_PATH, JSON.stringify(questions, null, 2), 'utf-8');
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ✅ Done in ${elapsed}s`);
  console.log(`  Succeeded: ${succeeded}/${processed}`);
  console.log(`  Failed: ${failed}/${processed}`);
  if (isDryRun) console.log('  🔹 DRY RUN — no files were modified');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
