/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

function normalizeCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(normalizeCell).join('');
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => normalizeCell(part?.text || '')).join('');
    }
    if (typeof value.text === 'string') return value.text.trim();
  }
  return String(value).trim();
}

function normalizeWhitespace(value) {
  return normalizeCell(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function normalizeQuestionId(value) {
  const raw = normalizeCell(value);
  if (!raw) return '';
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed)) {
    return String(parsed).padStart(4, '0');
  }
  return raw;
}

function normalizeDifficulty(value) {
  const text = normalizeCell(value).toLowerCase();
  if (text.includes('a1') || text.includes('a2') || text.includes('beginner') || text.includes('easy')) {
    return 'easy';
  }
  if (text.includes('c1') || text.includes('c2') || text.includes('expert') || text.includes('hard')) {
    return 'hard';
  }
  if (text.includes('b1') || text.includes('b2') || text.includes('intermediate') || text.includes('medium')) {
    return 'medium';
  }
  return 'medium';
}

function mapDifficultyToLevel(value) {
  const text = normalizeCell(value).toLowerCase();
  if (text.includes('a1') || text.includes('a2') || text.includes('beginner')) return 1;
  if (text.includes('b1') || text.includes('b2') || text.includes('intermediate')) return 2;
  if (text.includes('c1') || text.includes('c2') || text.includes('expert') || text.includes('hard')) return 3;
  return 2;
}

function mapDifficultyToMultiplier(value) {
  const difficulty = normalizeDifficulty(value);
  if (difficulty === 'easy') return 1.0;
  if (difficulty === 'hard') return 2.0;
  return 1.5;
}

function splitParagraphs(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];
  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function parseAnswerParagraph(paragraph) {
  const raw = normalizeWhitespace(paragraph);
  const parts = [];
  let blankIndex = 0;
  let cursor = 0;
  const blankPattern = /__([^_]+?)__/g;
  let match;

  while ((match = blankPattern.exec(raw)) !== null) {
    const before = raw.slice(cursor, match.index);
    if (before) {
      parts.push({ type: 'text', text: before });
    }

    const options = String(match[1] || '')
      .split('/')
      .map((option) => option.trim())
      .filter(Boolean);

    parts.push({
      type: 'blank',
      blankIndex: blankIndex,
      correctAnswer: options[0] || '',
      options
    });
    blankIndex += 1;
    cursor = match.index + match[0].length;
  }

  const after = raw.slice(cursor);
  if (after) {
    parts.push({ type: 'text', text: after });
  }

  return {
    rawText: raw,
    parts,
    blankCount: blankIndex
  };
}

function parseAnswerText(answerText) {
  return splitParagraphs(answerText).map((paragraph) => parseAnswerParagraph(paragraph));
}

function countBlanks(answerText) {
  return parseAnswerText(answerText).reduce((sum, paragraph) => sum + paragraph.blankCount, 0);
}

function countBlankDelimiters(answerText) {
  const normalized = normalizeWhitespace(answerText);
  if (!normalized) return 0;
  const matches = normalized.match(/__/g);
  return Array.isArray(matches) ? matches.length : 0;
}

function normalizeCandidateKey(value) {
  return normalizeCell(value).replace(/\s+/g, ' ').toLowerCase();
}

function parseBlockingVocab(value) {
  const text = normalizeCell(value);
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const word = normalizeCell(entry.word || entry.displayText || entry.lemma || '');
        if (!word) return null;
        return {
          word,
          us_ipa: normalizeCell(entry.us_ipa || entry.usIpa || ''),
          contextual_definition: normalizeCell(entry.contextual_definition || entry.definition || ''),
          entryType: /\s/.test(word) ? 'phrase' : 'word'
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function scanAudioManifest(audioDir) {
  const result = new Map();
  if (!fs.existsSync(audioDir)) return result;

  const fileNames = fs.readdirSync(audioDir).filter((name) => /\.mp3$/i.test(name));
  const pattern = /^(\d{4})_(Full|Beg|Inter)_(M|F)_(100|80)\.mp3$/i;

  for (const fileName of fileNames) {
    const match = fileName.match(pattern);
    if (!match) continue;
    const [, id, variant, voice, speed] = match;
    const entry = result.get(id) || {
      full: { male100: null, female100: null, male80: null, female80: null },
      beginner: { male80: null, female80: null },
      intermediate: { male80: null, female80: null }
    };

    if (variant === 'Full') {
      entry.full[`${voice === 'M' ? 'male' : 'female'}${speed}`] = fileName;
    } else if (variant === 'Beg') {
      entry.beginner[`${voice === 'M' ? 'male' : 'female'}${speed}`] = fileName;
    } else if (variant === 'Inter') {
      entry.intermediate[`${voice === 'M' ? 'male' : 'female'}${speed}`] = fileName;
    }
    result.set(id, entry);
  }

  return result;
}

async function readWorkbookRows(workbookPath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('Workbook has no worksheets.');
  }

  const headers = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    headers[columnNumber - 1] = normalizeCell(cell.value);
  });

  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const entry = {};
    headers.forEach((header, index) => {
      if (!header) return;
      entry[header] = row.getCell(index + 1).value;
    });
    rows.push(entry);
  });

  return rows;
}

function buildRfibCandidateList(answerText, blockingVocab = []) {
  const paragraphs = parseAnswerText(answerText);
  const seen = new Map();
  const candidates = [];

  const addCandidate = (value, extra = {}) => {
    const word = normalizeCell(value);
    const key = normalizeCandidateKey(word);
    if (!word || !key) return;

    const entryType = extra.entryType || (/\s/.test(word) ? 'phrase' : 'word');
    const candidate = {
      key,
      word,
      displayText: word,
      entryType,
      definition: normalizeCell(extra.definition || ''),
      example: normalizeCell(extra.example || ''),
      sentence: normalizeCell(extra.sentence || ''),
      allowedModes: Array.isArray(extra.allowedModes)
        ? [...extra.allowedModes]
        : (entryType === 'phrase' ? ['cloze'] : undefined),
      phraseAudioKey: extra.phraseAudioKey || null,
      selectedByDefault: true
    };

    const existing = seen.get(key);
    if (existing) {
      if (!existing.definition && candidate.definition) existing.definition = candidate.definition;
      if (!existing.example && candidate.example) existing.example = candidate.example;
      if (!existing.sentence && candidate.sentence) existing.sentence = candidate.sentence;
      if (!existing.allowedModes && candidate.allowedModes) existing.allowedModes = candidate.allowedModes;
      if (!existing.phraseAudioKey && candidate.phraseAudioKey) existing.phraseAudioKey = candidate.phraseAudioKey;
      return;
    }

    seen.set(key, candidate);
    candidates.push(candidate);
  };

  paragraphs.forEach((paragraph) => {
    paragraph.parts.forEach((part) => {
      if (part.type !== 'blank' || !part.correctAnswer) return;
      addCandidate(part.correctAnswer, {
        sentence: paragraph.rawText,
        entryType: /\s/.test(part.correctAnswer) ? 'phrase' : 'word'
      });
    });
  });

  blockingVocab.forEach((entry) => {
    addCandidate(entry.word, {
      definition: entry.contextual_definition || '',
      example: '',
      sentence: '',
      entryType: /\s/.test(entry.word) ? 'phrase' : 'word',
      allowedModes: /\s/.test(entry.word) ? ['cloze'] : undefined
    });
  });

  return candidates;
}

function buildRfibDataset(rows, audioManifest) {
  const items = [];
  const reviewMetadata = {};
  const firestoreDocs = [];
  const validation = {
    structuralErrors: [],
    contentWarnings: [],
    hasStructuralErrors: false
  };

  const addStructuralError = (id, title, message) => {
    validation.structuralErrors.push({
      id,
      title,
      message
    });
  };

  const addContentWarning = (id, title, message) => {
    validation.contentWarnings.push({
      id,
      title,
      message
    });
  };

  for (const row of rows) {
    const id = normalizeQuestionId(row.ID || row.id || row['Question ID'] || row['ID']);
    if (!id) continue;

    const title = normalizeCell(row.TITLE || row.Title || row.title || `Question ${id}`);
    const answerText = normalizeWhitespace(row.ANSWER || row.Answer || row.answer || '');
    const fullText = normalizeWhitespace(row['Full Text'] || row.fullText || row.full_text || '');
    if (!answerText || !fullText) continue;

    const beginnerText = normalizeWhitespace(row['Beginner Ver'] || row.beginner || row.beginnerText || '');
    const intermediateText = normalizeWhitespace(row['Inter Ver'] || row.intermediate || row.intermediateText || '');
    const topic = normalizeCell(row.Topic || row.topic || '');
    const difficultySource = row.Enrichment_Difficulty || row.difficulty || row.Level || row.level || '';
    const blankAnalysis = row.Enrichment_Blank_Analysis || row.blankAnalysis || '';
    const blockingVocab = parseBlockingVocab(row.Enrichment_Blocking_Vocab || row.blockingVocab || '');
    const paragraphs = parseAnswerText(answerText);
    const blankCount = paragraphs.reduce((sum, paragraph) => sum + paragraph.blankCount, 0);
    const paragraphPayload = paragraphs.map((paragraph) => ({
      rawText: paragraph.rawText,
      parts: paragraph.parts
    }));
    const delimiterCount = countBlankDelimiters(answerText);

    const audio = audioManifest.get(id) || {
      full: { male100: null, female100: null, male80: null, female80: null },
      beginner: { male80: null, female80: null },
      intermediate: { male80: null, female80: null }
    };
    const hasAudioEntries = (variant) => {
      if (!variant || typeof variant !== 'object') return false;
      return Object.values(variant).some(Boolean);
    };

    const level = mapDifficultyToLevel(difficultySource);
    const difficultyTag = normalizeDifficulty(difficultySource);
    const difficultyMultiplier = mapDifficultyToMultiplier(difficultySource);

    if (delimiterCount > 0 && delimiterCount !== blankCount * 2) {
      addStructuralError(id, title, 'Unbalanced blank delimiters.');
    }
    if (blankCount <= 0) {
      addStructuralError(id, title, 'No parsed blanks were found in ANSWER text.');
    }
    paragraphs.forEach((paragraph, paragraphIndex) => {
      paragraph.parts.forEach((part, partIndex) => {
        if (part.type !== 'blank') return;
        if (!part.correctAnswer) {
          addStructuralError(id, title, `Blank ${paragraphIndex + 1}.${partIndex + 1} has no correct answer.`);
        } else if (!Array.isArray(part.options) || part.options.length < 2) {
          addStructuralError(id, title, `Blank ${paragraphIndex + 1}.${partIndex + 1} must have at least two options.`);
        } else {
          const normalizedOptions = part.options.map((option) => normalizeCandidateKey(option));
          if (new Set(normalizedOptions).size !== normalizedOptions.length) {
            addStructuralError(id, title, `Blank ${paragraphIndex + 1}.${partIndex + 1} has duplicate options.`);
          }
        }
      });
    });
    if (!beginnerText) {
      addContentWarning(id, title, 'Missing Beginner version text.');
    }
    if (!intermediateText) {
      addContentWarning(id, title, 'Missing Intermediate version text.');
    }
    if (beginnerText && !hasAudioEntries(audio.beginner)) {
      addContentWarning(id, title, 'Missing Beginner audio.');
    }
    if (intermediateText && !hasAudioEntries(audio.intermediate)) {
      addContentWarning(id, title, 'Missing Intermediate audio.');
    }
    if (blockingVocab.length === 0) {
      addContentWarning(id, title, 'Missing blocking vocabulary metadata.');
    }

    items.push({
      id: Number.parseInt(id, 10),
      title,
      topic: topic || null,
      level,
      cefr: normalizeCell(difficultySource) || null,
      difficultyTag,
      difficultyMultiplier,
      blankCount,
      answerText,
      fullText,
      paragraphs: paragraphPayload,
      beginnerText: beginnerText || null,
      intermediateText: intermediateText || null,
      audio: {
        full: audio.full,
        beginner: audio.beginner,
        intermediate: audio.intermediate
      }
    });

    reviewMetadata[id] = {
      blockingVocab,
      blankAnalysis: normalizeCell(blankAnalysis) || null
    };

    const gaps = [];
    let gapIndex = 0;
    paragraphs.forEach((paragraph) => {
      paragraph.parts.forEach((part) => {
        if (part.type !== 'blank') return;
        gaps.push({
          index: gapIndex,
          answers: part.correctAnswer ? [part.correctAnswer] : []
        });
        gapIndex += 1;
      });
    });

    firestoreDocs.push({
      id,
      docId: `rfib_${id}`,
      text: fullText,
      answerText,
      paragraphs: paragraphPayload,
      gaps,
      blankCount,
      difficultyTag,
      difficultyMultiplier,
      topic: topic || null
    });
  }

  items.sort((a, b) => a.id - b.id);
  firestoreDocs.sort((a, b) => Number(a.id) - Number(b.id));
  validation.hasStructuralErrors = validation.structuralErrors.length > 0;

  return {
    items,
    reviewMetadata,
    firestoreDocs,
    validation,
    stats: {
      totalItems: items.length,
      audioQuestions: Array.from(audioManifest.keys()).length,
      warningCount: validation.contentWarnings.length,
      structuralErrorCount: validation.structuralErrors.length
    }
  };
}

async function buildRfibDatasetFromWorkbook(workbookPath, audioDir) {
  const rows = await readWorkbookRows(workbookPath);
  const audioManifest = scanAudioManifest(audioDir);
  return buildRfibDataset(rows, audioManifest);
}

module.exports = {
  normalizeCell,
  normalizeWhitespace,
  normalizeQuestionId,
  normalizeDifficulty,
  mapDifficultyToLevel,
  mapDifficultyToMultiplier,
  splitParagraphs,
  parseAnswerParagraph,
  parseAnswerText,
  countBlanks,
  parseBlockingVocab,
  scanAudioManifest,
  readWorkbookRows,
  buildRfibCandidateList,
  buildRfibDataset,
  buildRfibDatasetFromWorkbook
};
