/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const WORKBOOK_PATH = path.join(ROOT_DIR, 'public', 'database', 'SST', 'SST', 'SST.xlsx');
const OUTPUT_DIR = path.join(ROOT_DIR, 'docs', 'audits');
const REPORT_PATH = path.join(OUTPUT_DIR, 'sst-mainpoints-analysis-report.md');
const JSON_OUTPUT_PATH = path.join(OUTPUT_DIR, 'sst-mainpoints-analysis.json');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = process.env.LOCAL_GEMMA_MODEL || process.env.OLLAMA_MODEL || 'gemma4:12b';

// --- CLI Args ---
const args = process.argv.slice(2);
const limitArg = parseInt(args.find((_, i, a) => a[i - 1] === '--limit') || '15', 10);
const startArg = parseInt(args.find((_, i, a) => a[i - 1] === '--start') || '0', 10);

function parseMainPoints(raw) {
  try {
    const parsed = JSON.parse(String(raw || '[]'));
    return Array.isArray(parsed) ? parsed.map((item) => String(item || '').trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function buildAuditPrompt(title, transcript, existingPoints) {
  return `You are an expert PTE Academic curriculum auditor. Your task is to evaluate the quality of the pre-defined "Expected Main Points" for a Summarize Spoken Text (SST) question against the actual lecture transcript.

Lecture Title: ${title}

Transcript:
${transcript}

Existing Expected Main Points (stored in our database):
${JSON.stringify(existingPoints, null, 2)}

Please perform the following analysis:
1. Extract the true 3-5 key main points of the transcript yourself.
2. Compare the existing expected main points against your extracted ones and the transcript.
3. Assess the existing points on:
   - Factual accuracy (are they true to the text?)
   - Coverage (do they cover the core ideas necessary for a summary, or do they focus on details/miss key points?)
   - Conciseness (are they simple, clear, and distinct?)
4. Determine a final status: "pass" or "needs_revision".

Return ONLY a JSON response in this exact schema, with no markdown code blocks or wrapper text:
{
  "gemmaExtractedPoints": ["point 1", "point 2", "point 3"],
  "factualAccuracy": "brief comment on factual correctness",
  "coverage": "brief comment on whether key ideas are covered or missed",
  "conciseness": "brief comment on clarity and lack of repetition",
  "status": "pass" | "needs_revision",
  "issues": ["issue 1", "issue 2"],
  "notes": "additional summary observations"
}

Do NOT wrap in markdown code fences (like \`\`\`json). Output raw valid JSON only.`;
}

async function callOllama(prompt) {
  const response = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      prompt,
      options: { temperature: 0.1 },
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
  }
  
  const payload = await response.json();
  let text = String(payload.response || '').trim();
  
  // Clean potential markdown wrappers
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  
  try {
    return JSON.parse(text);
  } catch (err) {
    // Attempt fallback extraction if JSON format was slightly malformed
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (_) {}
    }
    throw new Error(`Failed to parse Gemma response as JSON. Raw response: ${text.slice(0, 300)}...`);
  }
}

async function main() {
  console.log('====================================================');
  console.log('   SST Main Points Analysis Script (Gemma 4)');
  console.log('====================================================');
  console.log(`Workbook Path: ${WORKBOOK_PATH}`);
  console.log(`Model: ${OLLAMA_MODEL}`);
  console.log(`Start index: ${startArg}, Limit: ${limitArg}`);
  console.log('====================================================\n');

  if (!fs.existsSync(WORKBOOK_PATH)) {
    console.error(`Error: Excel file not found at ${WORKBOOK_PATH}`);
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(WORKBOOK_PATH);
  const worksheet = workbook.worksheets[0];

  const allQuestions = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip headers
    const id = String(row.getCell(1).value || '').trim();
    const title = String(row.getCell(2).value || '').trim();
    const transcript = String(row.getCell(3).value || '').trim();
    const mainPointsRaw = String(row.getCell(4).value || '').trim();
    
    if (id && title && transcript) {
      allQuestions.push({
        id,
        title,
        transcript,
        existingPoints: parseMainPoints(mainPointsRaw)
      });
    }
  });

  console.log(`Loaded ${allQuestions.length} questions from SST database.`);
  
  // Slice to the requested subset
  const subset = allQuestions.slice(startArg, startArg + limitArg);
  console.log(`Processing subset of ${subset.length} questions (indices ${startArg} to ${startArg + subset.length - 1})...\n`);

  const results = [];
  let passedCount = 0;
  let needsRevisionCount = 0;

  for (let i = 0; i < subset.length; i++) {
    const q = subset[i];
    console.log(`[${i + 1}/${subset.length}] Analyzing Q${q.id}: "${q.title}"`);
    
    const prompt = buildAuditPrompt(q.title, q.transcript, q.existingPoints);
    let evaluation;
    try {
      evaluation = await callOllama(prompt);
      
      const status = evaluation.status || 'pass';
      if (status === 'pass') passedCount++;
      else needsRevisionCount++;

      console.log(`  -> Status: ${status.toUpperCase()}`);
    } catch (error) {
      console.error(`  -> Failed to analyze Q${q.id}: ${error.message}`);
      evaluation = {
        status: 'error',
        error: error.message,
        factualAccuracy: 'N/A',
        coverage: 'N/A',
        conciseness: 'N/A',
        gemmaExtractedPoints: [],
        issues: ['Failed to run Gemma audit script']
      };
    }

    results.push({
      question: q,
      evaluation
    });
    
    // Tiny sleep to rest Ollama
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Create report directory if not exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Save raw JSON results
  fs.writeFileSync(JSON_OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf-8');

  // Format Markdown Report
  let md = `# Summarize Spoken Text (SST) Main Points Audit Report

**Date of Audit:** ${new Date().toLocaleDateString()}
**Audit Tool:** Local Gemma AI (\`${OLLAMA_MODEL}\` on Ollama)
**Database Audited:** \`${path.basename(WORKBOOK_PATH)}\` (with ${allQuestions.length} total questions)
**Audited Sample size:** ${subset.length} questions (Start index: ${startArg}, Limit: ${limitArg})

## Executive Summary

- **Total Audited:** ${subset.length}
- **Pass (High Quality):** ${passedCount} (${((passedCount / subset.length) * 100).toFixed(1)}%)
- **Needs Revision:** ${needsRevisionCount} (${((needsRevisionCount / subset.length) * 100).toFixed(1)}%)

---

## Individual Question Evaluation Breakdown

`;

  results.forEach(({ question, evaluation }) => {
    const statusBadge = evaluation.status === 'pass' 
      ? '🟢 PASS' 
      : evaluation.status === 'needs_revision' 
        ? '🟡 NEEDS REVISION' 
        : '🔴 ERROR';

    md += `### Question ${question.id}: ${question.title}

- **Status:** ${statusBadge}
- **Factual Accuracy:** ${evaluation.factualAccuracy || 'N/A'}
- **Coverage:** ${evaluation.coverage || 'N/A'}
- **Conciseness:** ${evaluation.conciseness || 'N/A'}

#### Existing Expected Points (in database)
${question.existingPoints.map(p => `- ${p}`).join('\n') || '*None*'}

#### Gemma 4 Extracted Main Points
${evaluation.gemmaExtractedPoints?.map(p => `- ${p}`).join('\n') || '*None/Failed*'}

${evaluation.issues && evaluation.issues.length ? `#### Flagged Issues\n${evaluation.issues.map(iss => `- ⚠️ ${iss}`).join('\n')}\n` : ''}
${evaluation.notes ? `#### Notes\n${evaluation.notes}\n` : ''}
---

`;
  });

  fs.writeFileSync(REPORT_PATH, md, 'utf-8');
  console.log('\n====================================================');
  console.log('   Analysis Completed Successfully!');
  console.log('====================================================');
  console.log(`Markdown Report Saved to: ${REPORT_PATH}`);
  console.log(`JSON Data Saved to: ${JSON_OUTPUT_PATH}`);
  console.log(`Passes: ${passedCount}, Needs Revision: ${needsRevisionCount}`);
  console.log('====================================================');
}

main().catch(err => {
  console.error('Fatal error during execution:', err);
  process.exit(1);
});
