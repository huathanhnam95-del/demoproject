/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function resolveExcelJS() {
  try {
    return require('exceljs');
  } catch (err) {
    const workspacePkg = path.resolve(__dirname, '../../tools/release-workspace/package.json');
    if (fs.existsSync(workspacePkg)) {
      try {
        const wsRequire = require('module').createRequire(workspacePkg);
        return wsRequire('exceljs');
      } catch (wsErr) {
        throw err;
      }
    }
    throw err;
  }
}
const ExcelJS = resolveExcelJS();

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const PUBLIC_ROOT = path.join(PROJECT_ROOT, 'public');
const DEFAULT_WORKBOOK_PATH = path.join(PUBLIC_ROOT, 'database', 'RA', 'RA.xlsx');
const DEFAULT_AUDIO_MANIFEST_PATH = path.join(PUBLIC_ROOT, 'database', 'RA', 'Voice', 'audio', 'manifest.json');
const DEFAULT_PUBLIC_INDEX_PATH = path.join(PUBLIC_ROOT, 'database', 'RA', 'connected-speech-index.json');
const DEFAULT_FEATURED_PROMPTS_PATH = path.join(PUBLIC_ROOT, 'database', 'RA', 'connected-speech-featured-prompts.json');
const DEFAULT_FUNCTIONS_INDEX_PATH = path.join(PROJECT_ROOT, 'functions', 'src', 'data', 'read-aloud-connected-speech-index.json');
const DEFAULT_COVERAGE_DIR = path.join(PROJECT_ROOT, 'docs', 'audits', 'read-aloud-connected-speech', '2026-03-26-coverage');
const INDEX_VERSION = '1';
const REQUIRED_HEADERS = ['ID', 'TITLE', 'ANSWER', 'ANSWER FOR COMPARE OR TRANSCRIPT', 'Word count'];

function compareStableStrings(left, right) {
  const leftText = String(left ?? '');
  const rightText = String(right ?? '');
  if (leftText === rightText) return 0;
  return leftText < rightText ? -1 : 1;
}

function normalizeGeneratedAt(value) {
  if (value == null) {
    return new Date().toISOString();
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('generatedAt must be a non-empty ISO-8601 timestamp.');
  }
  const normalizedValue = value.trim();
  const match = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) {
    throw new Error('generatedAt must be a full ISO-8601 timestamp with Z or an explicit offset.');
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offset] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offset === 'Z' ? 0 : Number(offset.slice(1, 3));
  const offsetMinute = offset === 'Z' ? 0 : Number(offset.slice(4, 6));
  const daysInMonth = month >= 1 && month <= 12
    ? new Date(Date.UTC(year, month, 0)).getUTCDate()
    : 0;
  if (day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    throw new Error(`Invalid generatedAt timestamp: ${value}`);
  }
  const timestamp = new Date(normalizedValue);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Invalid generatedAt timestamp: ${value}`);
  }
  return timestamp.toISOString();
}

function normalizeCell(value) {
  if (value == null) return '';
  if (typeof value === 'object' && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text || '').join('');
  }
  return String(value).trim();
}

function normalizeKeyText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[\u2018\u2019]/g, '\'')
    .trim()
    .toLowerCase();
}

function getQuestionId(row) {
  const id = normalizeCell(row?.ID);
  return id || null;
}

function getRowKey(row) {
  const questionId = getQuestionId(row);
  if (questionId) {
    return `id:${questionId}`;
  }
  const promptText = normalizeKeyText(normalizeCell(row?.['ANSWER FOR COMPARE OR TRANSCRIPT'] || row?.ANSWER || ''));
  return promptText ? `prompt:${promptText}` : '';
}

function getReferenceText(row) {
  return normalizeCell(row?.['ANSWER FOR COMPARE OR TRANSCRIPT'] || row?.ANSWER || '');
}

function getTitle(row) {
  return normalizeCell(row?.TITLE || '');
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJsonIfChanged(filePath, data) {
  ensureDir(filePath);
  const next = `${JSON.stringify(data, null, 2)}\n`;
  if (fs.existsSync(filePath)) {
    const current = fs.readFileSync(filePath, 'utf8');
    if (current === next) {
      return false;
    }
  }
  fs.writeFileSync(filePath, next, 'utf8');
  return true;
}

async function loadWorkbookRows(workbookPath = DEFAULT_WORKBOOK_PATH) {
  const workbook = new ExcelJS.Workbook();
  const workbookBuffer = fs.readFileSync(workbookPath);
  await workbook.xlsx.load(workbookBuffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('Read Aloud workbook has no worksheets.');
  }

  const headerRow = worksheet.getRow(1);
  const headers = headerRow.values.slice(1).map((value) => String(value || '').trim());
  REQUIRED_HEADERS.forEach((header, index) => {
    if (headers[index] !== header) {
      throw new Error(`Workbook header mismatch at column ${index + 1}: expected "${header}", got "${headers[index] || ''}"`);
    }
  });
  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const entry = {};
    headers.forEach((header, index) => {
      entry[header] = row.getCell(index + 1).value;
    });
    rows.push(entry);
  });

  return {
    workbook,
    worksheet,
    headers,
    rows,
    workbookBuffer
  };
}

function loadAudioManifest(audioManifestPath = DEFAULT_AUDIO_MANIFEST_PATH) {
  const raw = fs.readFileSync(audioManifestPath, 'utf8');
  return JSON.parse(raw);
}

function loadReadAloudLinkingApi() {
  require(path.join(PUBLIC_ROOT, 'js', 'read-aloud-prompt-grammar.js'));
  require(path.join(PUBLIC_ROOT, 'js', 'read-aloud-spoken-forms.js'));
  require(path.join(PUBLIC_ROOT, 'js', 'read-aloud-connected-speech-rules.js'));
  require(path.join(PUBLIC_ROOT, 'js', 'read-aloud-linking.js'));
  const api = globalThis.ReadAloudLinking;
  if (!api || typeof api.analyzePrompt !== 'function') {
    throw new Error('Failed to load Read Aloud linking analysis helpers.');
  }
  return api;
}

function isEligibleBoundary(boundary) {
  return !!boundary
    && !boundary.blocked
    && (boundary.confidence === 'high' || boundary.confidence === 'medium');
}

function boundaryExample(boundary, family, index) {
  const left = normalizeCell(boundary.leftDisplay || boundary.leftWord || '');
  const right = normalizeCell(boundary.rightDisplay || boundary.rightWord || '');
  const phrase = normalizeCell(`${left} ${right}`);
  return {
    family,
    type: 'boundary',
    id: boundary.id || `${family}-${index}`,
    guideTarget: `boundary-${boundary.id || `${family}-${index}`}`,
    text: phrase,
    leftWord: left,
    rightWord: right,
    subtype: boundary.subtype || null,
    category: boundary.category || null,
    confidence: boundary.confidence || null,
    markerText: boundary.markerText || null
  };
}

function tokenExample(annotation, family, index) {
  return {
    family,
    type: 'token',
    id: annotation.id || `${family}-${index}`,
    guideTarget: `token-${annotation.id || `${family}-${index}`}`,
    text: normalizeCell(annotation.display || annotation.word || ''),
    word: normalizeCell(annotation.word || ''),
    spokenAs: annotation.spokenAs || null,
    subtype: annotation.subtype || null,
    confidence: annotation.confidence || null,
    markerText: annotation.legendLabel || null
  };
}

function collectLinkingData(analysis) {
  const eligible = Array.isArray(analysis?.boundaries)
    ? analysis.boundaries.filter(isEligibleBoundary)
    : [];
  const linkingBoundaries = eligible.filter((boundary) => String(boundary.layer || 'linking') !== 'assimilation');
  const examples = linkingBoundaries.slice(0, 4).map((boundary, index) => boundaryExample(boundary, 'linking', index));
  return {
    hasLinking: linkingBoundaries.length > 0,
    linkingCount: linkingBoundaries.length,
    examples
  };
}

function collectReducedWordData(analysis) {
  const annotations = Array.isArray(analysis?.tokenAnnotations)
    ? analysis.tokenAnnotations.filter((annotation) => annotation && annotation.layer === 'weak_forms')
    : [];
  const examples = annotations.slice(0, 4).map((annotation, index) => tokenExample(annotation, 'reduced_words', index));
  return {
    hasReducedWords: annotations.length > 0,
    reducedWordCount: annotations.length,
    examples
  };
}

function collectSoundChangeData(analysis) {
  const eligible = Array.isArray(analysis?.boundaries)
    ? analysis.boundaries.filter(isEligibleBoundary)
    : [];
  const soundChangeBoundaries = eligible.filter((boundary) => String(boundary.layer || '') === 'assimilation');
  const subtypeCounts = new Map();
  soundChangeBoundaries.forEach((boundary) => {
    const subtype = normalizeCell(boundary.subtype || boundary.category || 'unknown') || 'unknown';
    subtypeCounts.set(subtype, (subtypeCounts.get(subtype) || 0) + 1);
  });
  const examples = soundChangeBoundaries.slice(0, 4).map((boundary, index) => boundaryExample(boundary, 'sound_changes', index));
  return {
    hasSoundChanges: soundChangeBoundaries.length > 0,
    soundChangeCount: soundChangeBoundaries.length,
    soundChangeSubtypes: Array.from(subtypeCounts.keys()).sort(),
    soundChangeSubtypeCounts: subtypeCounts,
    examples
  };
}

function buildPromptRecord(row, manifest, analysisMap) {
  const questionId = getQuestionId(row);
  const rowKey = getRowKey(row);
  const referenceText = getReferenceText(row);
  const title = getTitle(row);
  const audioEntry = questionId ? manifest?.[questionId] : null;
  const hasSampleAudio = !!audioEntry && Object.keys(audioEntry).some((voiceKey) => {
    const voiceEntry = audioEntry[voiceKey];
    return voiceEntry && typeof voiceEntry === 'object' && voiceEntry.files && Object.keys(voiceEntry.files).length > 0;
  });

  const linking = collectLinkingData(analysisMap.v1_linking);
  const reducedWords = collectReducedWordData(analysisMap.v2_reduced_words);
  const soundChanges = collectSoundChangeData(analysisMap.v3_sound_changes);
  const representativeExamples = [
    ...linking.examples,
    ...reducedWords.examples,
    ...soundChanges.examples
  ];
  const previewExamplesByCategory = {
    linking: linking.examples,
    reduced_words: reducedWords.examples,
    sound_changes: soundChanges.examples
  };

  return {
    rowKey,
    questionId,
    title,
    referenceText,
    wordCount: Number.parseInt(normalizeCell(row['Word count'] || row.wordCount || 0), 10) || null,
    hasSampleAudio,
    hasAnyConnectedSpeech: linking.hasLinking || reducedWords.hasReducedWords || soundChanges.hasSoundChanges,
    hasLinking: linking.hasLinking,
    linkingCount: linking.linkingCount,
    hasReducedWords: reducedWords.hasReducedWords,
    reducedWordCount: reducedWords.reducedWordCount,
    hasSoundChanges: soundChanges.hasSoundChanges,
    soundChangeCount: soundChanges.soundChangeCount,
    soundChangeSubtypes: soundChanges.soundChangeSubtypes,
    previewExamplesByCategory,
    representativeExamples
  };
}

function buildCoverageSummary(index) {
  const prompts = Array.isArray(index?.prompts) ? index.prompts : [];
  const summary = {
    promptCount: prompts.length,
    promptsWithSampleAudio: 0,
    anyConnectedCount: 0,
    linkingCount: 0,
    reducedWordCount: 0,
    soundChangeCount: 0,
    soundChangeSubtypeCounts: {},
    samplePrompts: []
  };

  prompts.forEach((prompt) => {
    if (prompt.hasSampleAudio) summary.promptsWithSampleAudio += 1;
    if (prompt.hasAnyConnectedSpeech) summary.anyConnectedCount += 1;
    if (prompt.hasLinking) summary.linkingCount += 1;
    if (prompt.hasReducedWords) summary.reducedWordCount += 1;
    if (prompt.hasSoundChanges) summary.soundChangeCount += 1;
    (prompt.soundChangeSubtypes || []).forEach((subtype) => {
      summary.soundChangeSubtypeCounts[subtype] = (summary.soundChangeSubtypeCounts[subtype] || 0) + 1;
    });
  });

  summary.samplePrompts = prompts
    .slice()
    .sort((left, right) => {
      const leftScore = (left.hasSoundChanges ? 3 : 0) + (left.hasReducedWords ? 2 : 0) + (left.hasLinking ? 1 : 0);
      const rightScore = (right.hasSoundChanges ? 3 : 0) + (right.hasReducedWords ? 2 : 0) + (right.hasLinking ? 1 : 0);
      if (rightScore !== leftScore) return rightScore - leftScore;
      return compareStableStrings(left.questionId || left.rowKey || '', right.questionId || right.rowKey || '');
    })
    .slice(0, 12)
    .map((prompt) => ({
      rowKey: prompt.rowKey,
      questionId: prompt.questionId,
      title: prompt.title,
      hasSampleAudio: prompt.hasSampleAudio,
      hasLinking: prompt.hasLinking,
      hasReducedWords: prompt.hasReducedWords,
      hasSoundChanges: prompt.hasSoundChanges,
      soundChangeSubtypes: prompt.soundChangeSubtypes || []
    }));

  return summary;
}

function buildCoverageMarkdown(index, coverage) {
  const lines = [];
  lines.push('# Read Aloud Connected Speech Coverage');
  lines.push('');
  lines.push(`- Generated at: ${index.generatedAt}`);
  lines.push(`- Index version: ${index.indexVersion}`);
  lines.push(`- Source workbook SHA-256: ${index.sourceWorkbookSha256}`);
  lines.push(`- Audio manifest SHA-256: ${index.audioManifestSha256}`);
  lines.push('');
  lines.push('## Totals');
  lines.push(`- Prompts: ${coverage.promptCount}`);
  lines.push(`- Prompts with sample audio: ${coverage.promptsWithSampleAudio}`);
  lines.push(`- Prompts with any connected speech: ${coverage.anyConnectedCount}`);
  lines.push(`- Prompts with linking: ${coverage.linkingCount}`);
  lines.push(`- Prompts with reduced words: ${coverage.reducedWordCount}`);
  lines.push(`- Prompts with sound changes: ${coverage.soundChangeCount}`);
  lines.push('');
  lines.push('## Sound Change Subtypes');
  const subtypeEntries = Object.entries(coverage.soundChangeSubtypeCounts || {}).sort((left, right) => right[1] - left[1] || compareStableStrings(left[0], right[0]));
  if (subtypeEntries.length === 0) {
    lines.push('- None found');
  } else {
    subtypeEntries.forEach(([subtype, count]) => {
      lines.push(`- ${subtype}: ${count}`);
    });
  }
  lines.push('');
  lines.push('## Sample Prompts');
  if (!coverage.samplePrompts.length) {
    lines.push('- None');
  } else {
    coverage.samplePrompts.forEach((prompt) => {
      const flags = [];
      if (prompt.hasLinking) flags.push('linking');
      if (prompt.hasReducedWords) flags.push('reduced words');
      if (prompt.hasSoundChanges) flags.push(`sound changes: ${prompt.soundChangeSubtypes.join(', ') || 'yes'}`);
      if (prompt.hasSampleAudio) flags.push('audio');
      const flagText = flags.length ? ` (${flags.join('; ')})` : '';
      lines.push(`- [${prompt.questionId || prompt.rowKey}] ${prompt.title || prompt.referenceText || 'Untitled'}${flagText}`);
    });
  }
  return `${lines.join('\n')}\n`;
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const text = String(value || '').trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    result.push(text);
  });
  return result;
}

function buildFeaturedPromptCuration(index, coverage) {
  const prompts = Array.isArray(index?.prompts) ? index.prompts : [];
  const sampleIds = uniqueStrings((coverage?.samplePrompts || []).map((prompt) => prompt.questionId));
  const firstSoundChangeIds = uniqueStrings(
    prompts
      .filter((prompt) => prompt && prompt.hasSoundChanges)
      .slice()
      .sort((left, right) => (
        (right.soundChangeCount || 0) - (left.soundChangeCount || 0)
        || compareStableStrings(left.questionId || '', right.questionId || '')
      ))
      .map((prompt) => prompt.questionId)
  );

  const buildFamilyList = (predicates, fallbackIds, limit = 12) => {
    const collected = [];
    const pushId = (questionId) => {
      const id = String(questionId || '').trim();
      if (!id || collected.includes(id)) return;
      collected.push(id);
    };

    fallbackIds.forEach(pushId);
    if (collected.length < limit) {
      prompts.forEach((prompt) => {
        if (predicates(prompt)) {
          pushId(prompt.questionId);
        }
      });
    }
    return collected.slice(0, limit);
  };

  const families = {
    any_connected: buildFamilyList((prompt) => !!prompt?.hasAnyConnectedSpeech, sampleIds),
    linking: buildFamilyList((prompt) => !!prompt?.hasLinking, sampleIds),
    reduced_words: buildFamilyList((prompt) => !!prompt?.hasReducedWords, sampleIds),
    sound_changes: buildFamilyList((prompt) => !!prompt?.hasSoundChanges, firstSoundChangeIds)
  };

  const subtypes = {};
  prompts.forEach((prompt) => {
    if (!prompt?.hasSoundChanges) return;
    (prompt.soundChangeSubtypes || []).forEach((subtype) => {
      const key = String(subtype || 'unknown').trim() || 'unknown';
      if (!subtypes[key]) subtypes[key] = [];
      if (subtypes[key].length < 8) {
        const id = String(prompt.questionId || '').trim();
        if (id && !subtypes[key].includes(id)) {
          subtypes[key].push(id);
        }
      }
    });
  });

  return {
    version: index?.indexVersion || INDEX_VERSION,
    updatedAt: index?.generatedAt || new Date().toISOString(),
    families,
    subtypes: {
      sound_changes: subtypes
    }
  };
}

async function analyzePromptVariants(linkingApi, text) {
  const [v1_linking, v2_reduced_words, v3_sound_changes] = await Promise.all([
    linkingApi.analyzePrompt(text, { connectedSpeechLevel: 'v1_linking' }),
    linkingApi.analyzePrompt(text, { connectedSpeechLevel: 'v2_reduced_words' }),
    linkingApi.analyzePrompt(text, { connectedSpeechLevel: 'v3_sound_changes' })
  ]);
  return { v1_linking, v2_reduced_words, v3_sound_changes };
}

async function buildConnectedSpeechIndex(options = {}) {
  const workbookPath = options.workbookPath || DEFAULT_WORKBOOK_PATH;
  const audioManifestPath = options.audioManifestPath || DEFAULT_AUDIO_MANIFEST_PATH;
  const publicIndexPath = options.publicIndexPath || DEFAULT_PUBLIC_INDEX_PATH;
  const featuredPromptsPath = options.featuredPromptsPath || DEFAULT_FEATURED_PROMPTS_PATH;
  const functionsIndexPath = options.functionsIndexPath || DEFAULT_FUNCTIONS_INDEX_PATH;
  const coverageDir = options.coverageDir || DEFAULT_COVERAGE_DIR;
  const indexVersion = String(options.indexVersion || INDEX_VERSION);
  const generatedAt = normalizeGeneratedAt(options.generatedAt ?? options.timestamp);
  const linkingApi = options.linkingApi || loadReadAloudLinkingApi();

  const workbookSha256 = hashFile(workbookPath);
  const audioManifestSha256 = hashFile(audioManifestPath);
  const { rows } = await loadWorkbookRows(workbookPath);
  const audioManifest = loadAudioManifest(audioManifestPath);

  const prompts = [];
  const concurrency = Math.max(1, Number(options.concurrency || 4));
  let cursor = 0;

  async function worker() {
    while (cursor < rows.length) {
      const currentIndex = cursor;
      cursor += 1;
      const row = rows[currentIndex];
      const referenceText = getReferenceText(row);
      const analysisMap = referenceText
        ? await analyzePromptVariants(linkingApi, referenceText)
        : { v1_linking: null, v2_reduced_words: null, v3_sound_changes: null };
      prompts[currentIndex] = buildPromptRecord(row, audioManifest, analysisMap);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, rows.length || 1) }, () => worker());
  await Promise.all(workers);

  const index = {
    indexVersion,
    generatedAt,
    sourceWorkbookSha256: workbookSha256,
    audioManifestSha256,
    prompts
  };

  const coverage = buildCoverageSummary(index);
  const featuredPrompts = buildFeaturedPromptCuration(index, coverage);
  const summaryMarkdown = buildCoverageMarkdown(index, coverage);

  writeJsonIfChanged(publicIndexPath, index);
  writeJsonIfChanged(featuredPromptsPath, featuredPrompts);
  writeJsonIfChanged(functionsIndexPath, index);
  ensureDir(path.join(coverageDir, 'summary.md'));
  fs.mkdirSync(coverageDir, { recursive: true });
  fs.writeFileSync(path.join(coverageDir, 'coverage.json'), `${JSON.stringify({ ...coverage, indexVersion, generatedAt: index.generatedAt }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(coverageDir, 'summary.md'), summaryMarkdown, 'utf8');

  return { index, coverage, publicIndexPath, featuredPromptsPath, functionsIndexPath, coverageDir };
}

async function reportConnectedSpeechCoverage(options = {}) {
  const publicIndexPath = options.publicIndexPath || DEFAULT_PUBLIC_INDEX_PATH;
  const coverageDir = options.coverageDir || DEFAULT_COVERAGE_DIR;
  if (!fs.existsSync(publicIndexPath)) {
    throw new Error(`Connected speech index not found: ${publicIndexPath}`);
  }
  const index = JSON.parse(fs.readFileSync(publicIndexPath, 'utf8'));
  const coverage = buildCoverageSummary(index);
  const summaryMarkdown = buildCoverageMarkdown(index, coverage);
  fs.mkdirSync(coverageDir, { recursive: true });
  fs.writeFileSync(path.join(coverageDir, 'coverage.json'), `${JSON.stringify({ ...coverage, indexVersion: index.indexVersion, generatedAt: index.generatedAt }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(coverageDir, 'summary.md'), summaryMarkdown, 'utf8');
  return { index, coverage, publicIndexPath, coverageDir };
}

module.exports = {
  INDEX_VERSION,
  DEFAULT_WORKBOOK_PATH,
  DEFAULT_AUDIO_MANIFEST_PATH,
  DEFAULT_PUBLIC_INDEX_PATH,
  DEFAULT_FEATURED_PROMPTS_PATH,
  DEFAULT_FUNCTIONS_INDEX_PATH,
  DEFAULT_COVERAGE_DIR,
  normalizeCell,
  normalizeKeyText,
  compareStableStrings,
  normalizeGeneratedAt,
  getQuestionId,
  getRowKey,
  getReferenceText,
  loadWorkbookRows,
  loadAudioManifest,
  loadReadAloudLinkingApi,
  buildPromptRecord,
  buildCoverageSummary,
  buildCoverageMarkdown,
  buildFeaturedPromptCuration,
  buildConnectedSpeechIndex,
  reportConnectedSpeechCoverage
};
