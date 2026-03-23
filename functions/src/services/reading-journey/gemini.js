const { VertexAI } = require('@google-cloud/vertexai');
const { safeJsonParse, countWords, trimToMaxWords } = require('./json');

// Default to the highest-capability Gemini model currently available in Vertex AI.
// Can be overridden via READING_JOURNEY_GEMINI_MODEL in .env.
const DEFAULT_MODEL = 'gemini-2.0-flash';

// Fallback when the primary model is unavailable (quota/rate limits, model not found, etc.).
// Can be overridden via READING_JOURNEY_GEMINI_FALLBACK_MODEL in .env.
const DEFAULT_FALLBACK_MODEL = 'gemini-2.0-flash-lite';
const ALLOWED_LEVELS = new Set(['A2', 'B1', 'B2', 'C1']);

const MAX_INTERACTIVE_BEATS = 3;
const ENDING_BEAT_NUMBER = MAX_INTERACTIVE_BEATS + 1;

const OPEN_PRODUCTION_PROMPT = 'In 1–2 sentences: summarize what happened, then say what you do next (investigate, ask, or wait) and why.';
const CANONICAL_CHOICE_IDS = Object.freeze(['investigate', 'ask', 'wait']);

const TOPIC_TAG_TAXONOMY = Object.freeze([
  'adventure',
  'animals',
  'art',
  'community',
  'cooking',
  'creativity',
  'culture',
  'education',
  'curiosity',
  'environment',
  'family',
  'festival',
  'food',
  'friendship',
  'games',
  'health',
  'hobbies',
  'humor',
  'language_learning',
  'mystery',
  'nature',
  'problem_solving',
  'school',
  'science',
  'space',
  'sports',
  'technology',
  'teamwork',
  'travel',
  'weather',
  'work',
  'writing'
]);

function normalizeScalar(value) {
  return String(value ?? '').trim();
}

function normalizeLevel(level) {
  const value = normalizeScalar(level).toUpperCase();
  return ALLOWED_LEVELS.has(value) ? value : 'B1';
}

function getModelName() {
  const fromEnv = normalizeScalar(process.env.READING_JOURNEY_GEMINI_MODEL);
  return fromEnv || DEFAULT_MODEL;
}

function getFallbackModelName() {
  const fromEnv = normalizeScalar(process.env.READING_JOURNEY_GEMINI_FALLBACK_MODEL);
  return fromEnv || DEFAULT_FALLBACK_MODEL;
}

function getClient() {
  const project = normalizeScalar(process.env.FIREBASE_PROJECT_ID)
    || normalizeScalar(process.env.GCLOUD_PROJECT)
    || normalizeScalar(process.env.GCP_PROJECT)
    || normalizeScalar(process.env.GOOGLE_CLOUD_PROJECT);
  const location = normalizeScalar(process.env.GOOGLE_CLOUD_LOCATION) || 'us-central1';

  if (!project) {
    throw new Error('Missing project ID for Vertex AI — set FIREBASE_PROJECT_ID or GCLOUD_PROJECT');
  }

  return new VertexAI({ project, location });
}

let cachedClient = null;
const modelCacheByName = new Map();

function getCachedClient() {
  if (cachedClient) return cachedClient;
  cachedClient = getClient();
  return cachedClient;
}

function getModelForName(name) {
  const modelName = normalizeScalar(name) || DEFAULT_MODEL;
  const cached = modelCacheByName.get(modelName);
  if (cached) return cached;
  const client = getCachedClient();
  const model = client.getGenerativeModel({ model: modelName });
  modelCacheByName.set(modelName, model);
  return model;
}

function getModel() {
  return getModelForName(getModelName());
}

let forceFallback = false;
let forceFallbackReason = '';

function shouldForceFallback(err) {
  const msg = String(err?.message || err || '');
  if (!msg) return false;
  if (msg.includes('[429') || msg.toLowerCase().includes('quota exceeded')) return true;
  if (msg.includes('[404') || msg.toLowerCase().includes('not found')) return true;
  if (msg.toLowerCase().includes('not supported')) return true;
  return false;
}

function getEffectiveModelName() {
  return forceFallback ? getFallbackModelName() : getModelName();
}

/**
 * Extract text from a Vertex AI response object.
 * The @google-cloud/vertexai SDK (v1.x) does not expose response.text().
 * Text lives at response.candidates[0].content.parts[0].text.
 */
function extractText(response) {
  // Forward-compat: if a future SDK adds .text(), use it.
  if (typeof response.text === 'function') return response.text();
  // Vertex AI SDK v1.x structure
  const parts = response?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts) && parts.length > 0) {
    return parts.map(p => p.text || '').join('');
  }
  throw new Error('No text found in Vertex AI response');
}

async function generateJson(prompt, { temperature = 0.7 } = {}) {
  const primaryModelName = getModelName();
  const fallbackModelName = getFallbackModelName();
  let activeModelName = forceFallback ? fallbackModelName : primaryModelName;
  let lastErr = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const attemptTemp = attempt === 0 ? temperature : 0.2;
    const attemptPrompt = attempt === 0
      ? prompt
      : `${prompt}\n\nIMPORTANT: Your previous response was invalid JSON. Return ONLY valid raw JSON (no markdown, no comments). Ensure all strings are JSON-escaped.`;

    let text = '';
    try {
      const model = getModelForName(activeModelName);
      // eslint-disable-next-line no-await-in-loop
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: attemptPrompt }] }],
        generationConfig: {
          temperature: attemptTemp,
          // Encourage strict JSON rendering when supported by the model/API.
          responseMimeType: 'application/json'
        }
      });
      const response = await result.response;
      text = extractText(response);
    } catch (e) {
      if (!forceFallback && activeModelName === primaryModelName && fallbackModelName && fallbackModelName !== primaryModelName && shouldForceFallback(e)) {
        forceFallback = true;
        forceFallbackReason = String(e?.message || e);
        activeModelName = fallbackModelName;

        try {
          const model = getModelForName(activeModelName);
          // eslint-disable-next-line no-await-in-loop
          const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: attemptPrompt }] }],
            generationConfig: {
              temperature: attemptTemp,
              responseMimeType: 'application/json'
            }
          });
          const response = await result.response;
          text = extractText(response);
        } catch (e2) {
          lastErr = e2;
          continue;
        }
      } else {
        lastErr = e;
        continue;
      }
    }

    try {
      return safeJsonParse(text);
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error('Failed to parse JSON from Gemini response');
}

async function generateTopicTags({ keywords, level = 'B1', language = 'en', temperature } = {}) {
  const safeLevel = normalizeLevel(level);
  const safeLanguage = normalizeScalar(language) || 'en';
  const keywordList = Array.isArray(keywords) ? keywords : [keywords];
  const keywordText = keywordList.map((k) => normalizeScalar(k)).filter(Boolean).slice(0, 12).join(', ');

  const taxonomyList = TOPIC_TAG_TAXONOMY.join(', ');

  const prompt = [
    'Return raw JSON only.',
    'Task: pick 3 to 6 topic tags from the taxonomy that best match the user keywords.',
    `Language: ${safeLanguage}. CEFR: ${safeLevel}.`,
    `Taxonomy (use only these): [${taxonomyList}]`,
    `User keywords: ${keywordText || '(none)'}`,
    'JSON schema:',
    '{ "topicTags": ["tag1","tag2","tag3"] }'
  ].join('\n');

  const requestedTemp = Number(temperature);
  const safeTemp = Number.isFinite(requestedTemp) ? requestedTemp : 0.2;
  const json = await generateJson(prompt, { temperature: safeTemp });
  const tags = Array.isArray(json?.topicTags) ? json.topicTags : [];
  const normalized = tags
    .map((t) => normalizeScalar(t).toLowerCase().replace(/\s+/g, '_'))
    .filter((t) => TOPIC_TAG_TAXONOMY.includes(t));

  const unique = Array.from(new Set(normalized));
  if (unique.length >= 3) return unique.slice(0, 6);
  return ['mystery', 'friendship', 'adventure'];
}

async function generateOutline({ keywords, topicTags, level = 'B1', language = 'en', temperature } = {}) {
  const safeLevel = normalizeLevel(level);
  const safeLanguage = normalizeScalar(language) || 'en';
  const keywordList = Array.isArray(keywords) ? keywords : [keywords];
  const keywordText = keywordList.map((k) => normalizeScalar(k)).filter(Boolean).slice(0, 12).join(', ');
  const safeTags = Array.isArray(topicTags) ? topicTags : [];

  const prompt = [
    'Return raw JSON only.',
    'You are a careful story designer for English reading practice.',
    `Language: ${safeLanguage}. Target CEFR: ${safeLevel}.`,
    'Safety rules:',
    '- Keep content PG and classroom-safe.',
    '- Do not use real celebrities, politicians, or brands as characters.',
    '- Avoid graphic violence, explicit sexual content, and hate.',
    'Design rules:',
    '- Create a locked 3-beat outline. Each beat must have a clear milestone.',
    '- Choose one setting (place + time) and keep it consistent across all beats.',
    '- Keep one central problem/goal that develops and resolves in beat 3.',
    '- Each beat must clearly follow from the previous beat (cause-and-effect).',
    '- Keep milestones simple and coherent (no random topic shifts).',
    `User keywords (inspiration): ${keywordText || '(none)'}`,
    `Chosen topic tags (must use these): ${safeTags.join(', ') || '(none)'}`,
    'JSON schema:',
    '{',
    '  "title": "string",',
    '  "premise": "string",',
    '  "setting": "string",',
    '  "topicTags": ["tag1","tag2","tag3"],',
    '  "characters": [{"name":"string","role":"string","goal":"string"}],',
    '  "beatOutline": [',
    '    {"beat":1,"milestone":"..."},',
    '    {"beat":2,"milestone":"..."},',
    '    {"beat":3,"milestone":"..."}',
    '  ]',
    '}'
  ].join('\n');

  const requestedTemp = Number(temperature);
  const safeTemp = Number.isFinite(requestedTemp) ? requestedTemp : 0.6;
  const json = await generateJson(prompt, { temperature: safeTemp });

  const title = normalizeScalar(json?.title) || 'Reading Journey';
  const premiseFallback = safeTags.length ? `A story about ${safeTags.join(', ')}.` : 'A short classroom-safe story.';
  const premise = normalizeScalar(json?.premise) || premiseFallback;
  const setting = normalizeScalar(json?.setting) || 'a familiar place';
  const tags = Array.isArray(json?.topicTags) ? json.topicTags : safeTags;
  const normalizedTags = Array.from(new Set(tags.map((t) => normalizeScalar(t).toLowerCase().replace(/\s+/g, '_'))))
    .filter(Boolean)
    .slice(0, 6);
  const characters = Array.isArray(json?.characters) ? json.characters : [];
  const beatOutline = Array.isArray(json?.beatOutline) ? json.beatOutline : [];

  const normalizedBeats = beatOutline
    .map((b) => ({ beat: Number(b?.beat), milestone: normalizeScalar(b?.milestone) }))
    .filter((b) => Number.isFinite(b.beat) && b.beat >= 1 && b.beat <= MAX_INTERACTIVE_BEATS && b.milestone)
    .sort((a, b) => a.beat - b.beat);

  if (normalizedBeats.length !== MAX_INTERACTIVE_BEATS) {
    throw new Error('Invalid beatOutline from Gemini');
  }

  const normalizedCharacters = characters
    .map((c) => ({
      name: normalizeScalar(c?.name) || 'Maya',
      role: normalizeScalar(c?.role) || 'friend',
      goal: normalizeScalar(c?.goal) || 'solve a small mystery'
    }))
    .slice(0, 3);

  return {
    formatVersion: 2,
    title,
    premise,
    setting,
    topicTags: normalizedTags.length ? normalizedTags : safeTags,
    characters: normalizedCharacters.length ? normalizedCharacters : [{ name: 'Maya', role: 'friend', goal: 'solve a small mystery' }],
    beatOutline: normalizedBeats
  };
}

async function generateBeat({
  outline,
  beatNumber,
  path,
  questionType,
  storySoFar,
  level = 'B1',
  language = 'en',
  temperature,
  choiceIds
} = {}) {
  const safeLevel = normalizeLevel(level);
  const safeLanguage = normalizeScalar(language) || 'en';
  const safeBeat = Number(beatNumber);
  if (!Number.isFinite(safeBeat) || safeBeat < 1 || safeBeat > ENDING_BEAT_NUMBER) {
    throw new Error('Invalid beatNumber');
  }

  const beatOutline = Array.isArray(outline?.beatOutline) ? outline.beatOutline : [];
  const milestoneBeat = safeBeat > MAX_INTERACTIVE_BEATS ? MAX_INTERACTIVE_BEATS : safeBeat;
  const milestone = beatOutline.find((b) => Number(b?.beat) === milestoneBeat)?.milestone || '';
  if (!milestone) throw new Error('Missing milestone for beat');

  const pathList = Array.isArray(path) ? path : [];
  const safePath = pathList.map((c) => normalizeScalar(c)).filter(Boolean).slice(0, MAX_INTERACTIVE_BEATS);

  const characters = Array.isArray(outline?.characters) ? outline.characters : [];
  const characterText = characters
    .map((c) => `${normalizeScalar(c?.name) || 'Maya'} (${normalizeScalar(c?.role) || 'friend'}: ${normalizeScalar(c?.goal) || 'goal'})`)
    .join('; ');

  const shouldEnd = safeBeat === ENDING_BEAT_NUMBER;
  const safeQuestionType = shouldEnd
    ? 'end'
    : (normalizeScalar(questionType).toLowerCase() === 'open' ? 'open' : 'mcq');

  const storyContextRaw = normalizeScalar(storySoFar);
  const storyContext = storyContextRaw ? storyContextRaw.slice(0, 1800) : '';

  const outlineTags = Array.isArray(outline?.topicTags) ? outline.topicTags : [];
  const tagText = outlineTags.map((t) => normalizeScalar(t)).filter(Boolean).slice(0, 6).join(', ');

  const promptParts = [
    'Return raw JSON only.',
    'You are writing a cohesive, engaging interactive English reading story.',
    `Language: ${safeLanguage}. Target CEFR: ${safeLevel}.`,
    'Hard constraints:',
    '- Segment must be 50 to 60 words.',
    '- Recap must be 20 words or fewer.',
    `- This is beat ${safeBeat}/${ENDING_BEAT_NUMBER}.`,
    `- questionType must be "${safeQuestionType}".`,
    '- If questionType is "end", set shouldEnd=true and include endWrap (20 to 30 words).',
    '- Otherwise set shouldEnd=false.',
    '- Keep content PG and classroom-safe. No real celebrities, politicians, or brands.',
    'Continuity rules:',
    '- Continue directly from the story so far; keep the same setting and characters.',
    '- Maintain clear cause-and-effect across beats; avoid sudden topic shifts.',
    '- Reuse important objects and problems; do not invent a new unrelated goal.',
    '- Use a connector (After that, Because of this, Then) to link to the previous beat.',
    '- Mention at least one concrete detail from the most recent scene.',
    'Story contract:',
    `- Title: ${normalizeScalar(outline?.title) || 'Reading Journey'}`,
    `- Setting: ${normalizeScalar(outline?.setting) || '(not provided)'}`,
    `- Premise: ${normalizeScalar(outline?.premise) || '(not provided)'}`,
    `- Topic tags: ${tagText || '(none)'}`,
    `- Characters: ${characterText || '(none)'}`,
    `- Locked milestone for this beat (${milestoneBeat}/${MAX_INTERACTIVE_BEATS}): ${milestone}`,
    `- User choices so far (IDs): ${safePath.join(', ') || '(none yet)'}`,
    'Now generate this beat.'
  ];

  if (storyContext) {
    promptParts.push('Story so far (continue from this, do not restart):', storyContext);
  }

  // Determine which choice IDs to use for this beat.
  const effectiveChoiceIds = Array.isArray(choiceIds) && choiceIds.length > 0
    ? choiceIds
    : CANONICAL_CHOICE_IDS;

  if (safeQuestionType === 'mcq') {
    const choiceIdList = effectiveChoiceIds.join(', ');
    promptParts.push(
      'MCQ rules:',
      `- Include choiceQuestion with exactly ${effectiveChoiceIds.length} options.`,
      `- Use ONLY these option IDs: ${choiceIdList}.`,
      '- Each option.label must be 6-12 words, CEFR-appropriate, and fit the current milestone.',
      '- Do NOT include productionPrompt.'
    );
  } else if (safeQuestionType === 'open') {
    promptParts.push(
      'Open question rules:',
      '- Do NOT include choiceQuestion.',
      `- Include productionPrompt.question EXACTLY: "${OPEN_PRODUCTION_PROMPT}"`,
      '- Do NOT include choiceQuestion.'
    );
  } else {
    promptParts.push(
      'Ending rules:',
      '- Do NOT include choiceQuestion or productionPrompt.',
      '- Resolve the story clearly and naturally.'
    );
  }

  promptParts.push(
    'JSON schema:',
    '{',
    '  "formatVersion": 2,',
    '  "questionType": "mcq|open|end",',
    '  "segment": "string",',
    '  "recap": "string",',
    '  "highlights": ["word or phrase", "...up to 6 items"],',
    '  "choiceQuestion": { "question": "What do you do next?", "options": [ ' + effectiveChoiceIds.map(id => `{"id":"${id}","label":"..."}`).join(', ') + ' ] },',
    '  "productionPrompt": { "question": "string" },',
    '  "shouldEnd": true/false,',
    '  "endWrap": "string"',
    '}',
    'Highlights rules:',
    '- Pick 3 to 6 words or short phrases (1-3 words each) from the segment.',
    '- Choose the most important vocabulary, key topic terms, or main-idea phrases.',
    '- Do NOT include grammar words (the, and, is, etc.).',
    '- Return them as exact substrings of the segment (case-insensitive match is fine).'
  );

  const prompt = promptParts.join('\n');

  const requestedTemp = Number(temperature);
  const safeTemp = Number.isFinite(requestedTemp) ? requestedTemp : 0.6;
  const json = await generateJson(prompt, { temperature: safeTemp });

  const segment = normalizeScalar(json?.segment);
  const recap = normalizeScalar(json?.recap);
  const endWrap = normalizeScalar(json?.endWrap);

  // Normalize highlights: array of short strings, max 6, non-empty
  const rawHighlights = Array.isArray(json?.highlights) ? json.highlights : [];
  const highlights = rawHighlights
    .map((h) => normalizeScalar(h))
    .filter((h) => h.length > 0 && h.length <= 40)
    .slice(0, 6);

  const rawChoiceQuestion = (safeQuestionType === 'mcq' && !shouldEnd && json?.choiceQuestion && typeof json.choiceQuestion === 'object')
    ? {
      question: normalizeScalar(json.choiceQuestion.question) || 'What do you do next?',
      options: Array.isArray(json.choiceQuestion.options) ? json.choiceQuestion.options : []
    }
    : null;

  const normalizedOptions = (rawChoiceQuestion?.options || [])
    .map((opt) => ({
      id: normalizeScalar(opt?.id).toLowerCase(),
      label: normalizeScalar(opt?.label)
    }))
    .filter((opt) => effectiveChoiceIds.includes(opt.id) && opt.label)
    .slice(0, 6);

  const optionById = new Map();
  normalizedOptions.forEach((opt) => optionById.set(opt.id, opt));
  const fallbackById = {
    investigate: 'Investigate carefully and look for a clear clue.',
    ask: 'Ask someone nearby for help or information.',
    wait: 'Wait quietly, watch closely, and stay calm.'
  };

  const canonicalOptions = effectiveChoiceIds.map((id) => ({
    id,
    label: optionById.get(id)?.label || fallbackById[id] || `Choose ${id}`
  }));

  const normalizedChoiceQuestion = (safeQuestionType === 'mcq' && !shouldEnd)
    ? {
      question: rawChoiceQuestion?.question || 'What do you do next?',
      options: canonicalOptions
    }
    : null;

  const productionPrompt = (safeQuestionType === 'open' && !shouldEnd)
    ? { question: OPEN_PRODUCTION_PROMPT }
    : null;

  let finalSegment = segment;
  const segmentWords = countWords(finalSegment);
  if (segmentWords > 60) {
    finalSegment = trimToMaxWords(finalSegment, 60);
  }

  // If too short, retry once with a stronger instruction.
  if (countWords(finalSegment) < 50 || countWords(finalSegment) > 60) {
    const retryPrompt = `${prompt}\n\nRewrite segment to be 50-60 words, keeping the same meaning. Return JSON only.`;
    const retryJson = await generateJson(retryPrompt, { temperature: 0.6 });
    const retrySegment = normalizeScalar(retryJson?.segment);
    if (retrySegment) {
      finalSegment = retrySegment;
      if (countWords(finalSegment) > 60) finalSegment = trimToMaxWords(finalSegment, 60);
    }
  }

  const final = {
    formatVersion: 2,
    questionType: safeQuestionType,
    segment: finalSegment,
    recap: recap ? trimToMaxWords(recap, 20) : '',
    highlights,
    choiceQuestion: normalizedChoiceQuestion,
    productionPrompt,
    shouldEnd
  };

  if (shouldEnd) {
    let wrap = endWrap;
    const wrapWords = countWords(wrap);
    if (!wrap || wrapWords < 20 || wrapWords > 30) {
      const wrapPrompt = [
        'Return raw JSON only.',
        'Write a 20-30 word wrap-up ending for this story.',
        `Title: ${normalizeScalar(outline?.title) || 'Reading Journey'}`,
        `Milestone: ${milestone}`,
        `Choices (IDs): ${safePath.join(', ') || '(none)'}`,
        'JSON schema: { "endWrap": "string" }'
      ].join('\n');
      const wrapJson = await generateJson(wrapPrompt, { temperature: 0.7 });
      wrap = normalizeScalar(wrapJson?.endWrap) || wrap || 'The mystery ends with a calm lesson, and you feel proud of your choice.';
      if (countWords(wrap) > 30) wrap = trimToMaxWords(wrap, 30);
    }
    final.endWrap = wrap;
  }

  return final;
}

async function assessStory({ storyText, level = 'B1' }) {
  const safeLevel = normalizeLevel(level);
  const text = normalizeScalar(storyText);
  if (!text) throw new Error('Missing storyText');

  const prompt = [
    'Return raw JSON only.',
    'You are evaluating an English learner reading story.',
    `Target CEFR level: ${safeLevel}.`,
    'Score each category from 1 to 5 (5 is best).',
    'Evaluate: coherence, cohesion, grammar, vocabulary.',
    'Also estimate cefrFit (A2|B1|B2|C1).',
    'Flags:',
    '- tooHard: true if vocabulary/grammar is above target by a lot',
    '- tooEasy: true if far below target',
    '- unsafe: true if content is not classroom-safe',
    'Keep notes short (1-3 sentences).',
    'JSON schema:',
    '{',
    '  "coherence": 1,',
    '  "cohesion": 1,',
    '  "grammar": 1,',
    '  "vocabulary": 1,',
    '  "cefrFit": "B1",',
    '  "notes": "string",',
    '  "flags": { "tooHard": false, "tooEasy": false, "unsafe": false }',
    '}',
    'Story text:',
    text.slice(0, 6000)
  ].join('\n');

  const json = await generateJson(prompt, { temperature: 0.2 });
  return {
    coherence: Number(json?.coherence) || 1,
    cohesion: Number(json?.cohesion) || 1,
    grammar: Number(json?.grammar) || 1,
    vocabulary: Number(json?.vocabulary) || 1,
    cefrFit: normalizeScalar(json?.cefrFit) || safeLevel,
    notes: normalizeScalar(json?.notes) || '',
    flags: {
      tooHard: Boolean(json?.flags?.tooHard),
      tooEasy: Boolean(json?.flags?.tooEasy),
      unsafe: Boolean(json?.flags?.unsafe)
    }
  };
}

module.exports = {
  TOPIC_TAG_TAXONOMY,
  normalizeLevel,
  getModelName,
  getFallbackModelName,
  getEffectiveModelName,
  getForceFallbackReason: () => forceFallbackReason,
  generateTopicTags,
  generateOutline,
  generateBeat,
  assessStory
};
