const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const {
  normalizeTimingSegments,
  parseRawMultipartRequest,
  validateCorpusMetadata,
  validateManualReviewMetadata,
  buildManualReviewRecord,
  validateWavBuffer
} = require('./pronunciation-corpus');

const TASK_COLLECTION = 'pronunciationSegmentationStudyTasks';
const RESERVATION_COLLECTION = 'pronunciationSegmentationStudyReservations';
const CORPUS_COLLECTION = 'pronunciationCorpusSamples';
const AUDIO_HASH_COLLECTION = 'pronunciationSegmentationStudyAudioHashes';
const STUDY_VERSION = 'study-v2';
const PUBLIC_STUDY_VERSION = 'v2';
const VERSION_REGISTRY = Object.freeze({
  v1: Object.freeze({ publicVersion: 'v1', internalVersion: 'study-v1', studyId: 'segmentation-study-v1', active: false, manifestVersion: '1.0.0' }),
  'study-v1': Object.freeze({ publicVersion: 'v1', internalVersion: 'study-v1', studyId: 'segmentation-study-v1', active: false, manifestVersion: '1.0.0' }),
  v2: Object.freeze({ publicVersion: 'v2', internalVersion: 'study-v2', studyId: 'segmentation-study-v2', active: true, manifestVersion: '2.0.0' }),
  'study-v2': Object.freeze({ publicVersion: 'v2', internalVersion: 'study-v2', studyId: 'segmentation-study-v2', active: true, manifestVersion: '2.0.0' })
});
const TASK_ID_RE = /^[a-z0-9][a-z0-9-]{0,120}$/;
const SESSION_ID_RE = /^[a-z0-9][a-z0-9_-]{11,79}$/i;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_METADATA_BYTES = 640 * 1024;
const MAX_TASKS = 200;
const CLAIM_MINUTES = 10;
const MAX_MANIFEST_ENTRIES = 1000;
const CAPTURE_CONSTRAINTS_REQUESTED = Object.freeze({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
const REFERENCE_LABEL_PROVENANCE = 'explicit-reviewed-en-US-v1';
const AUTOMATIC_JUDGMENT_SCHEMA_VERSION = 'segmentation-study-automatic-judgment-v1';

function cleanString(value, maxLength = 200) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function normalizeIpa(value) {
  return cleanString(value, 320).normalize('NFC');
}

function timestampMillis(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function serializeTimestamp(value) {
  const millis = timestampMillis(value);
  return millis ? new Date(millis).toISOString() : (value || null);
}

function serializeData(value) {
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date || typeof value.toDate === 'function' || typeof value.toMillis === 'function') {
    return serializeTimestamp(value);
  }
  if (Array.isArray(value)) return value.map(serializeData);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeData(item)]));
}

function normalizeReferenceSyllables(value, count) {
  if (!Array.isArray(value)) return null;
  const syllables = value.map((item) => cleanString(item, 120)).filter(Boolean);
  return syllables.length === count ? syllables : null;
}

function normalizeTransitionClasses(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanString(item, 80)).filter(Boolean).slice(0, 32);
}

function normalizeManifestEntry(entry, index, studyVersion = STUDY_VERSION) {
  const value = entry && typeof entry === 'object' ? entry : {};
  const targetWord = cleanString(value.targetWord || value.word, 120).toLowerCase();
  const targetSyllableCount = Number(value.targetSyllableCount || value.syllableCount);
  if (!targetWord || !Number.isInteger(targetSyllableCount) || targetSyllableCount < 2 || targetSyllableCount > 5) {
    return null;
  }
  const order = Number.isInteger(value.order) && value.order >= 0 ? value.order : index;
  const taskId = cleanString(value.taskId || `${studyVersion === 'study-v2' ? 'segmentation-study-v2' : studyVersion}-${String(order + 1).padStart(4, '0')}`, 128).toLowerCase();
  if (!TASK_ID_RE.test(taskId)) return null;
  const split = value.split === 'holdout' ? 'holdout' : (value.split === 'development' ? 'development' : (order < 70 ? 'development' : 'holdout'));
  return {
    taskId,
    order,
    split,
    targetWord,
    referenceIpa: cleanString(value.referenceIpa || value.ipa, 300),
    referenceSyllableIpa: normalizeReferenceSyllables(value.referenceSyllableIpa || value.referenceSyllables, targetSyllableCount),
    targetSyllableCount,
    expectedObservedCount: Number.isInteger(value.expectedObservedCount) ? value.expectedObservedCount : targetSyllableCount,
    transitionClasses: normalizeTransitionClasses(value.transitionClasses || value.transitionTypes || value.transitionFamilies || value.boundaryContexts),
    ipaSource: cleanString(value.ipaSource, 120) || null,
    category: cleanString(value.category, 40) || 'clean',
    speakerCohort: cleanString(value.speakerCohort, 80) || `${studyVersion}-clean`,
    labelProvenance: cleanString(value.labelProvenance, 80) || 'deterministic-transform',
    source: cleanString(value.source || `segmentation-study-manifest-${studyVersion}`, 160),
    dialect: cleanString(value.dialect, 40) || 'en-US',
    referenceLabelProvenance: safeJson(value.referenceLabelProvenance || value.referenceProvenance || value.referenceSource || null, 2000)
  };
}

function normalizeManifest(value, studyVersion = STUDY_VERSION) {
  const entries = Array.isArray(value) ? value : (Array.isArray(value?.entries) ? value.entries : []);
  const seen = new Set();
  return entries
    .map((entry, index) => normalizeManifestEntry(entry, index, studyVersion))
    .filter((entry) => {
      if (!entry || seen.has(entry.taskId) || seen.has(`word:${entry.targetWord}`)) return false;
      seen.add(entry.taskId);
      seen.add(`word:${entry.targetWord}`);
      return true;
    })
    .sort((left, right) => left.order - right.order || left.taskId.localeCompare(right.taskId))
    .slice(0, MAX_MANIFEST_ENTRIES)
    .map((entry, index) => ({ ...entry, order: index }));
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function manifestMetadata(manifest, source, registry) {
  const value = source && typeof source === 'object' ? source : {};
  const manifestVersion = cleanString(value.manifestVersion || value.version || manifest.manifestVersion || registry.manifestVersion, 120) || registry.manifestVersion;
  const suppliedHash = cleanString(value.manifestSha256 || manifest.manifestSha256, 128).toLowerCase();
  const manifestSha256 = /^[a-f0-9]{64}$/.test(suppliedHash) ? suppliedHash : sha256(JSON.stringify(canonicalJson(manifest)));
  const dialect = cleanString(value.dialect || manifest.dialect, 40) || 'en-US';
  return { manifestVersion, manifestSha256, dialect };
}

function attachManifestMetadata(manifest, metadata) {
  Object.defineProperties(manifest, {
    manifestVersion: { value: metadata.manifestVersion, enumerable: false },
    manifestSha256: { value: metadata.manifestSha256, enumerable: false },
    dialect: { value: metadata.dialect, enumerable: false }
  });
  return manifest;
}

function readManifestFile(filePath, studyVersion) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const manifest = normalizeManifest(parsed, studyVersion);
    const metadata = manifestMetadata(manifest, parsed, VERSION_REGISTRY[studyVersion] || VERSION_REGISTRY.v2);
    attachManifestMetadata(manifest, metadata);
    return manifest.length ? manifest : null;
  } catch (_) {
    return null;
  }
}

function resolveStudyManifest(deps, version = PUBLIC_STUDY_VERSION) {
  const registry = VERSION_REGISTRY[version] || VERSION_REGISTRY.v2;
  let supplied = deps.studyManifests?.[registry.publicVersion] || deps.studyManifests?.[registry.internalVersion] || deps.studyManifest;
  if (typeof supplied === 'function') supplied = supplied(registry.publicVersion, registry.internalVersion);
  if (supplied && typeof supplied === 'object' && !Array.isArray(supplied) && supplied[registry.publicVersion]) supplied = supplied[registry.publicVersion];
  if (supplied) {
    const manifest = normalizeManifest(supplied, registry.internalVersion);
    const metadata = manifestMetadata(manifest, supplied, registry);
    attachManifestMetadata(manifest, metadata);
    if (manifest.length) return manifest;
  }

  const candidateFiles = [
    path.resolve(__dirname, `../../data/segmentation-study-${registry.publicVersion}.json`),
    path.resolve(process.cwd(), `scripts/data/segmentation-study-${registry.publicVersion}.json`),
    path.resolve(process.cwd(), `test-results/segmentation-study-${registry.publicVersion}.json`),
    path.resolve(__dirname, `../../../../scripts/data/segmentation-study-${registry.publicVersion}.json`),
    path.resolve(__dirname, '../../../../tests/fixtures/pronunciation-segmentation/manifest.json')
  ];
  for (const candidate of candidateFiles) {
    const manifest = readManifestFile(candidate, registry.internalVersion);
    if (manifest?.length) {
      // The legacy corpus manifest can contain repeated recordings of the same
      // word. Keep the first deterministic entry for each word and cap the
      // study at the requested 100 entries when a study manifest is absent.
      const filteredManifest = manifest.filter((entry) => entry.targetSyllableCount >= 2 && entry.targetSyllableCount <= 5).slice(0, 100);
      return attachManifestMetadata(filteredManifest, {
        manifestVersion: manifest.manifestVersion,
        manifestSha256: manifest.manifestSha256,
        dialect: manifest.dialect
      });
    }
  }
  throw new Error(`The fixed ${registry.internalVersion} manifest is unavailable. Run the study manifest sync before starting or deploying Functions.`);
}

function claimExpiry(now = Date.now()) {
  return new Date(now + CLAIM_MINUTES * 60 * 1000);
}

function claimIsActive(task, now = Date.now()) {
  return task?.status === 'reserved' && timestampMillis(task.claimExpiresAt) > now;
}

function ownerMatches(task, operatorName, sessionId) {
  return task?.claim?.operatorName === operatorName && task?.claim?.sessionId === sessionId;
}

function reservationDocId(studyVersion, operatorName, sessionId) {
  return sha256(`${studyVersion}\n${operatorName}\n${sessionId}`);
}

function reservationIsActive(reservation, now = Date.now()) {
  return reservation?.status === 'reserved' && timestampMillis(reservation.claimExpiresAt) > now;
}

function normalizeIdentity(body) {
  const operatorName = cleanString(body?.operatorName, 80);
  const sessionId = cleanString(body?.sessionId, 80);
  if (!operatorName) throw Object.assign(new Error('operatorName is required.'), { status: 400, code: 'VALIDATION_ERROR' });
  if (!SESSION_ID_RE.test(sessionId)) throw Object.assign(new Error('sessionId must contain 12-80 letters, numbers, hyphens, or underscores.'), { status: 400, code: 'VALIDATION_ERROR' });
  return { operatorName, sessionId };
}

function serializeTask(snapshotOrData, fallbackId = null) {
  const data = typeof snapshotOrData?.data === 'function' ? (snapshotOrData.data() || {}) : (snapshotOrData || {});
  const id = snapshotOrData?.id || data.taskId || fallbackId;
  return serializeData({
    ...data,
    id,
    taskId: data.taskId || id,
    claimExpiresAt: data.claimExpiresAt || null,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    completedAt: data.completedAt || null
  });
}

function safeJson(value, maxBytes = 450 * 1024) {
  if (value == null) return null;
  try {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > maxBytes) return null;
    return value;
  } catch (_) {
    return null;
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
}

function completionFingerprint(sourceHash, metadata) {
  return crypto.createHash('sha256')
    .update(sourceHash)
    .update('\n')
    .update(JSON.stringify(canonicalJson(metadata)))
    .digest('hex');
}

function firstTimingArray(...values) {
  for (const value of values) {
    if (!Array.isArray(value) || !value.length) continue;
    try {
      return normalizeTimingSegments(value, 'automaticSegments');
    } catch (_) {
      // A malformed candidate is not copied into the authoritative corpus
      // fields; the original comparison remains available under analysis.
    }
  }
  return [];
}

function extractAnalysisVariant(metadata, version) {
  const comparison = metadata.comparison || metadata.analysis || null;
  const v3 = comparison?.v3?.analysis || comparison?.analysis?.v3 || comparison?.v3 || null;
  const variants = v3?.partitionVariants || comparison?.partitionVariants || {};
  const direct = metadata[version];
  return direct || variants?.[version] || (version === 'v2' ? comparison?.v2?.analysis || comparison?.v2 : null) || null;
}

const CAPTURE_SETTING_IDS = new Set(['deviceid', 'groupid', 'device_id', 'group_id']);

function sanitizeCaptureSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const clean = {};
  Object.entries(value).slice(0, 64).forEach(([key, item]) => {
    const normalized = String(key).trim();
    if (!normalized || CAPTURE_SETTING_IDS.has(normalized.toLowerCase())) return;
    if (typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item)) || typeof item === 'string') {
      clean[normalized] = typeof item === 'string' ? item.slice(0, 200) : item;
    }
  });
  return clean;
}

function requireCaptureSettings(metadata) {
  const requested = metadata.captureConstraintsRequested;
  const requestedExact = requested && requested.echoCancellation === false
    && requested.noiseSuppression === false && requested.autoGainControl === false
    && Object.keys(requested).every((key) => Object.prototype.hasOwnProperty.call(CAPTURE_CONSTRAINTS_REQUESTED, key));
  if (!requestedExact || metadata.captureEligibility !== true) {
    throw Object.assign(new Error('captureConstraintsRequested and captureEligibility must prove raw capture was requested and eligible.'), { status: 400, code: 'CAPTURE_CONSTRAINTS_REQUIRED' });
  }
  const source = metadata.captureSettings || metadata.getSettings || metadata.audioCaptureSettings;
  const clean = sanitizeCaptureSettings(source);
  if (!clean || clean.echoCancellation !== false
    || clean.noiseSuppression !== false || clean.autoGainControl !== false) {
    throw Object.assign(new Error('captureSettings must include echoCancellation, noiseSuppression, and autoGainControl set to false.'), { status: 400, code: 'CAPTURE_SETTINGS_REQUIRED' });
  }
  return clean;
}

function requireVariantProvenance(metadata, versions) {
  const supplied = metadata.variantProvenance;
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) {
    throw Object.assign(new Error('variantProvenance for V2, V3, and V4 is required.'), { status: 400, code: 'ANALYSIS_PROVENANCE_REQUIRED' });
  }
  const seenVersions = new Set();
  const seenSources = new Set();
  for (const version of ['v2', 'v3', 'v4']) {
    const item = supplied[version];
    const analysisVersion = cleanString(item?.analysisVersion || item?.analysis_version, 160);
    const source = cleanString(item?.source || item?.provenance?.source, 160);
    const schemaVersion = cleanString(item?.schemaVersion || item?.schema_version, 120);
    const variant = cleanString(item?.variant, 20);
    if (!analysisVersion || !source || analysisVersion !== versions[version].analysisVersion || source !== versions[version].source
      || (schemaVersion && schemaVersion !== versions[version].schemaVersion)
      || (variant && variant !== version)
      || seenVersions.has(analysisVersion) || seenSources.has(source)) {
      throw Object.assign(new Error(`Distinct ${version.toUpperCase()} variant provenance is required.`), { status: 400, code: 'ANALYSIS_PROVENANCE_REQUIRED' });
    }
    seenVersions.add(analysisVersion);
    seenSources.add(source);
  }
  return Object.fromEntries(['v2', 'v3', 'v4'].map((version) => [version, {
    schemaVersion: versions[version].schemaVersion,
    variant: version,
    analysisVersion: cleanString(supplied[version].analysisVersion || supplied[version].analysis_version, 160),
    source: versions[version].source,
    comparisonId: versions[version].comparisonId,
    count: versions[version].count
  }]));
}

function normalizeSpanList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((span) => ({
    startTime: Number(span?.startTime ?? span?.start_time ?? span?.start),
    endTime: Number(span?.endTime ?? span?.end_time ?? span?.end)
  })).filter((span) => Number.isFinite(span.startTime) && Number.isFinite(span.endTime) && span.endTime > span.startTime);
}

function analysisCandidate(comparison, version) {
  if (!comparison || typeof comparison !== 'object') return null;
  if (version === 'v2') return comparison.v2?.analysis || comparison.v2 || null;
  if (version === 'v3') {
    return comparison.v3?.analysis?.partitionVariants?.v3
      ? { ...(comparison.v3.analysis), observed_syllables: comparison.v3.analysis.partitionVariants.v3 }
      : comparison.v3?.analysis || comparison.v3 || null;
  }
  const v3 = comparison.v3?.analysis || comparison.v3 || {};
  const partition = v3.partitionVariants?.v4;
  const v4AnalysisVersion = v3.partitionVariants?.v4AnalysisVersion || v3.partitionVariants?.v4_analysis_version;
  if (!partition || !v4AnalysisVersion) return null;
  return {
    ...v3,
    analysisVersion: v4AnalysisVersion,
    observed_syllables: partition
  };
}

function requireAuthoritativeV4(comparison, partitionVariants) {
  if (!comparison || comparison.v4 == null) return;
  const directWrapper = comparison.v4;
  const direct = directWrapper?.analysis || directWrapper;
  const authoritativeSpans = normalizeSpanList(partitionVariants.v4);
  const directSpans = normalizeSpanList(direct?.observed_syllables || direct?.observed?.syllables || direct?.syllables);
  const spansMatch = directSpans.length === authoritativeSpans.length
    && directSpans.every((span, index) => span.startTime === authoritativeSpans[index].startTime && span.endTime === authoritativeSpans[index].endTime);
  const authoritativeVersion = cleanString(partitionVariants.v4AnalysisVersion || partitionVariants.v4_analysis_version, 160);
  const directVersions = [direct?.analysisVersion, direct?.analysis_version, directWrapper?.analysisVersion, directWrapper?.analysis_version]
    .map((value) => cleanString(value, 160)).filter(Boolean);
  const directSources = [direct?.source, direct?.provenance?.source, directWrapper?.source, directWrapper?.provenance?.source]
    .map((value) => cleanString(value, 160)).filter(Boolean);
  const directSchemas = [direct?.schemaVersion, direct?.schema_version, direct?.partitionSchemaVersion, direct?.partition_schema_version,
    direct?.provenance?.schemaVersion, direct?.provenance?.schema_version, directWrapper?.schemaVersion, directWrapper?.schema_version,
    directWrapper?.partitionSchemaVersion, directWrapper?.partition_schema_version, directWrapper?.provenance?.schemaVersion, directWrapper?.provenance?.schema_version]
    .map((value) => cleanString(value, 120)).filter(Boolean);
  const directVariants = [direct?.variant, direct?.provenance?.variant, directWrapper?.variant, directWrapper?.provenance?.variant]
    .map((value) => cleanString(value, 20)).filter(Boolean);
  const allMatch = (values, expected) => values.length > 0 && values.every((value) => value === expected);
  if (!spansMatch || !allMatch(directVersions, authoritativeVersion) || !allMatch(directSources, 'partitionVariants.v4')
    || !allMatch(directSchemas, partitionVariants.schemaVersion) || !allMatch(directVariants, 'v4')) {
    throw Object.assign(new Error('Supplied direct V4 analysis does not exactly match authoritative partitionVariants.v4.'), { status: 400, code: 'ANALYSIS_V4_MISMATCH' });
  }
}

function v4StructuralPayload(provenance) {
  const rawSyllables = Array.isArray(provenance?.syllables) ? provenance.syllables : [];
  const syllables = rawSyllables.map((item, index) => ({
    index: Number.isInteger(item?.index) ? item.index : index,
    syllableId: item?.syllableId || item?.syllable_id || `v4-syllable-${index + 1}`,
    ipa: String(item?.ipa || item?.syllableIpa || ''),
    onset: Array.isArray(item?.onset) ? item.onset : [],
    nucleus: String(item?.nucleus || ''),
    coda: Array.isArray(item?.coda) ? item.coda : [],
    stress: item?.stress ?? null,
    phoneIndexes: item?.phoneIndexes || item?.phone_indexes || [],
    phoneOwnership: item?.phoneOwnership || item?.phone_ownership || { indexes: item?.phoneIndexes || item?.phone_indexes || [] },
    alignmentTokenRange: item?.alignmentTokenRange || item?.alignment_token_range || {},
    timingSpanIndex: Number(item?.timingSpanIndex ?? item?.timing_span_index ?? index),
    rule: item?.rule || 'maximal-legal-onset',
    ambiguity: item?.ambiguity || { status: 'deterministic', candidates: [] }
  }));
  const displaySyllabification = provenance.displaySyllabification
    || provenance.exactSyllabification
    || `/${syllables.map((item) => item.ipa).join('.')}/`;
  return {
    schemaVersion: 'pronunciation-syllabification-v1',
    analysisVersion: 'pronunciation-analysis-v4.1',
    ruleVersion: 'pronunciation-syllabification-v1/en-US-weight-first-max-onset-v1',
    onsetInventoryVersion: 'en-US-onsets-v1',
    dialect: provenance.dialect,
    originalIpa: provenance.originalIpa,
    normalizedIpa: provenance.normalizedIpa,
    displayIpa: provenance.displayIpa,
    displaySyllabification,
    exactSyllabification: displaySyllabification,
    rule: {
      id: provenance.rule?.id || 'weighted-maximal-onset',
      stressPolicy: provenance.rule?.stressPolicy || 'primary-secondary-stressed-lax',
      onsetPolicy: provenance.rule?.onsetPolicy || 'maximal-legal-onset'
    },
    ambiguity: provenance.ambiguity || { status: 'deterministic', candidates: [] },
    timingSpanContractVersion: provenance.timingSpanContractVersion || 'ctc-alignment-v2',
    syllables
  };
}

function v4ContentHash(provenance) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalJson(v4StructuralPayload(provenance))))
    .digest('hex');
}

function requireV4Provenance(partitionVariants, expectedReferenceIpa = null, expectedDialect = 'en-US') {
  const alignment = partitionVariants?.v4Alignment;
  const provenance = alignment?.provenance || alignment?.v4Provenance;
  const failProvenance = (message) => {
    throw Object.assign(new Error(message), { status: 400, code: 'ANALYSIS_V4_PROVENANCE_REQUIRED' });
  };
  if (!alignment || alignment.aligned !== true || !provenance || typeof provenance !== 'object') {
    failProvenance('Immutable V4 syllabification provenance is required before completion.');
  }
  if (cleanString(alignment.analysisVersion || alignment.analysis_version, 160) !== 'pronunciation-analysis-v4.1'
    || cleanString(alignment.syllabificationVersion || alignment.syllabification_version, 200) !== 'pronunciation-syllabification-v1/en-US-weight-first-max-onset-v1'
    || cleanString(alignment.dialect, 40) !== expectedDialect
    || cleanString(provenance.schemaVersion, 120) !== 'pronunciation-syllabification-v1'
    || cleanString(provenance.analysisVersion, 160) !== 'pronunciation-analysis-v4.1'
    || cleanString(provenance.ruleVersion, 200) !== 'pronunciation-syllabification-v1/en-US-weight-first-max-onset-v1'
    || cleanString(provenance.onsetInventoryVersion, 160) !== 'en-US-onsets-v1'
    || cleanString(provenance.dialect, 40) !== expectedDialect
    || (expectedReferenceIpa != null && cleanString(provenance.originalIpa, 320) !== cleanString(expectedReferenceIpa, 320))
    || !cleanString(provenance.originalIpa, 320)
    || !cleanString(provenance.normalizedIpa, 320)
    || !cleanString(provenance.displayIpa, 320)
    || !/^[a-f0-9]{64}$/.test(cleanString(provenance.contentHash, 80))
    || v4ContentHash(provenance) !== cleanString(provenance.contentHash, 80)
    || !provenance.rule || typeof provenance.rule !== 'object'
    || !provenance.ambiguity || typeof provenance.ambiguity !== 'object') {
    failProvenance('V4 provenance versions, IPA forms, dialect, and content hash are required.');
  }
  const syllables = provenance.syllables;
  const alignmentSyllables = alignment.syllables;
  if (!Array.isArray(syllables) || !Array.isArray(alignmentSyllables) || !Array.isArray(partitionVariants.v4)
    || syllables.length !== partitionVariants.v4.length || alignmentSyllables.length !== syllables.length) {
    failProvenance('V4 provenance must contain one ordered record per authoritative V4 span.');
  }
  const allPhoneIndexes = [];
  const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const seenSyllableIds = new Set();
  let expectedPhoneIndex = 0;
  syllables.forEach((syllable, index) => {
    const id = cleanString(syllable?.syllableId || syllable?.syllable_id, 120);
    const phoneIndexes = syllable?.phoneIndexes || syllable?.phone_indexes;
    const phoneOwnership = syllable?.phoneOwnership || syllable?.phone_ownership;
    const range = syllable?.alignmentTokenRange || syllable?.alignment_token_range;
    const timingSpanIndex = Number(syllable?.timingSpanIndex ?? syllable?.timing_span_index);
    const rule = cleanString(syllable?.rule, 120);
    const ambiguity = syllable?.ambiguity;
    const source = alignmentSyllables[index];
    const authoritativeSpan = partitionVariants.v4[index];
    const authoritativeId = cleanString(authoritativeSpan?.syllableId || authoritativeSpan?.syllable_id, 120);
    const ownershipIndexes = phoneOwnership?.indexes || phoneOwnership?.phoneIndexes || phoneOwnership?.phone_indexes;
    const rangeStart = Number(range?.start);
    const rangeEnd = Number(range?.endExclusive ?? range?.end);
    const sourcePhoneIndexes = source?.phoneIndexes || source?.phone_indexes;
    const sourcePhoneOwnership = source?.phoneOwnership || source?.phone_ownership;
    const sourceRange = source?.alignmentTokenRange || source?.alignment_token_range;
    const sourceTimingSpanIndex = Number(source?.timingSpanIndex ?? source?.timing_span_index);
    // Raw CTC phone coverage may leave blank frames between syllables. The
    // authoritative V4 comparison uses the contiguous partition candidate;
    // compare that timing when present and preserve raw start/end untouched.
    const sourceStart = Number(source?.partitionStartTime ?? source?.partition_start_time ?? source?.startTime ?? source?.start_time);
    const sourceEnd = Number(source?.partitionEndTime ?? source?.partition_end_time ?? source?.endTime ?? source?.end_time);
    const authoritativeStart = Number(authoritativeSpan?.startTime ?? authoritativeSpan?.start_time);
    const authoritativeEnd = Number(authoritativeSpan?.endTime ?? authoritativeSpan?.end_time);
    const sourceSyllableId = source?.syllableId || source?.syllable_id;
    const sourcePhoneOwnershipIndexes = sourcePhoneOwnership?.indexes || sourcePhoneOwnership?.phoneIndexes || sourcePhoneOwnership?.phone_indexes;
    const ownershipStart = Number(phoneOwnership?.startIndex);
    const ownershipEnd = Number(phoneOwnership?.endIndex);
    const sourceIndex = Number(source?.index);
    const syllableIndex = Number(syllable?.index);
    const expectedIndexes = Array.isArray(phoneIndexes)
      ? phoneIndexes.map((_, itemIndex) => expectedPhoneIndex + itemIndex)
      : null;
    if (!id || !Array.isArray(phoneIndexes) || phoneIndexes.length < 1 || phoneIndexes.some((item) => !Number.isInteger(item))
      || seenSyllableIds.has(id) || !Number.isInteger(syllableIndex) || syllableIndex !== index
      || !Number.isInteger(sourceIndex) || sourceIndex !== index
      || !phoneOwnership || typeof phoneOwnership !== 'object' || !Array.isArray(ownershipIndexes)
      || ownershipIndexes.some((item) => !Number.isInteger(item))
      || ownershipIndexes.length !== phoneIndexes.length || ownershipIndexes.some((item, itemIndex) => item !== phoneIndexes[itemIndex])
      || !Number.isInteger(ownershipStart) || !Number.isInteger(ownershipEnd)
      || ownershipStart !== phoneIndexes[0] || ownershipEnd !== phoneIndexes[phoneIndexes.length - 1] + 1
      || !sameJson(phoneIndexes, expectedIndexes)
      || !range || !Number.isInteger(Number(range.start)) || !Number.isInteger(Number(range.endExclusive ?? range.end))
      || rangeEnd <= rangeStart || rangeStart !== phoneIndexes[0] || rangeEnd !== phoneIndexes[phoneIndexes.length - 1] + 1
      || phoneIndexes.some((item) => item < rangeStart || item >= rangeEnd)
      || timingSpanIndex !== index || !rule || !ambiguity || typeof ambiguity !== 'object'
      || cleanString(source?.syllableId || source?.syllable_id, 120) !== id
      || String(source?.ipa || source?.syllableIpa || '') !== String(syllable?.ipa || syllable?.syllableIpa || '')
      || !sameJson(source?.onset || [], syllable?.onset || [])
      || String(source?.nucleus || '') !== String(syllable?.nucleus || '')
      || !sameJson(source?.coda || [], syllable?.coda || [])
      || (source?.stress ?? null) !== (syllable?.stress ?? null)
      || !sameJson(sourcePhoneIndexes, phoneIndexes)
      || !sameJson(sourcePhoneOwnershipIndexes, phoneIndexes)
      || !sameJson(sourceRange, range)
      || sourceTimingSpanIndex !== index
      || cleanString(source?.rule, 120) !== rule
      || !sameJson(source?.ambiguity, ambiguity)
      || !Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd)
      || !Number.isFinite(authoritativeStart) || !Number.isFinite(authoritativeEnd)
      || Math.abs(sourceStart - authoritativeStart) > 0.000001
      || Math.abs(sourceEnd - authoritativeEnd) > 0.000001
      || (authoritativeId && authoritativeId !== id)) {
      failProvenance(`V4 provenance syllable ${index + 1} is missing ownership, alignment, timing, rule, or ambiguity evidence.`);
    }
    seenSyllableIds.add(id);
    expectedPhoneIndex += phoneIndexes.length;
    allPhoneIndexes.push(...phoneIndexes);
  });
  const sortedPhoneIndexes = allPhoneIndexes.slice().sort((left, right) => left - right);
  if (sortedPhoneIndexes.some((item, index) => item !== index)) {
    failProvenance('V4 provenance phone ownership must cover each reference phone exactly once with no gaps.');
  }
  return provenance;
}

function collectEditOperations(value, operations = [], seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return operations;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => collectEditOperations(item, operations, seen));
    return operations;
  }
  Object.entries(value).forEach(([key, child]) => {
    if ((key === 'edit_operations' || key === 'editOperations') && Array.isArray(child)) {
      operations.push(...child);
    }
    collectEditOperations(child, operations, seen);
  });
  return operations;
}

function hasSubstitutionEvidence(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => hasSubstitutionEvidence(item, seen));
  return Object.entries(value).some(([key, child]) => {
    const normalizedKey = key.toLowerCase().replace(/[_-]/g, '');
    if ((normalizedKey === 'op' || normalizedKey === 'operation') && String(child || '').toLowerCase() === 'substitution') return true;
    if (normalizedKey === 'substitution' || normalizedKey === 'substitutionused') {
      if (child === true || String(child || '').toLowerCase() === 'substitution') return true;
    }
    return hasSubstitutionEvidence(child, seen);
  });
}

function requireCompleteComparison(metadata, expectedCount) {
  const comparison = metadata.comparison || metadata.analysis;
  if (!comparison || typeof comparison !== 'object') {
    throw Object.assign(new Error('A complete V2/V3/V4 comparison is required before completion.'), { status: 400, code: 'ANALYSIS_REQUIRED' });
  }
  if (comparison.status !== 'complete') {
    throw Object.assign(new Error('The V2/V3/V4 comparison must have status complete.'), { status: 400, code: 'ANALYSIS_INCOMPLETE' });
  }
  if (cleanString(comparison.schemaVersion, 120) !== 'pronunciation-comparison-v2' || !cleanString(comparison.comparisonId, 200)) {
    throw Object.assign(new Error('Comparison schemaVersion and comparisonId are required provenance.'), { status: 400, code: 'ANALYSIS_PROVENANCE_REQUIRED' });
  }
  const partitionVariants = comparison.v3?.analysis?.partitionVariants;
  if (!partitionVariants || cleanString(partitionVariants.schemaVersion, 120) !== 'pronunciation-partition-variants-v2') {
    throw Object.assign(new Error('A recognized V3 partition schema is required for independent V3/V4 variants.'), { status: 400, code: 'ANALYSIS_PROVENANCE_REQUIRED' });
  }
  requireAuthoritativeV4(comparison, partitionVariants);
  const v4Provenance = requireV4Provenance(partitionVariants, metadata.referenceIpa, metadata.dialect || 'en-US');
  const versions = {};
  const editOperations = collectEditOperations(comparison);
  if (editOperations.some((item) => String(item?.op || item?.operation || '').toLowerCase() === 'substitution') || hasSubstitutionEvidence(comparison)) {
    throw Object.assign(new Error('Comparison edit operations contain a substitution operation.'), { status: 400, code: 'ANALYSIS_SUBSTITUTION' });
  }
  for (const version of ['v2', 'v3', 'v4']) {
    const wrapper = comparison[version];
    if (!wrapper || wrapper.status !== 'complete') {
      throw Object.assign(new Error(`${version.toUpperCase()} analysis status must be complete.`), { status: 400, code: 'ANALYSIS_INCOMPLETE' });
    }
    const candidate = analysisCandidate(comparison, version);
    const spans = normalizeSpanList(candidate?.observed_syllables || candidate?.observed?.syllables || candidate?.syllables);
    const analysisVersion = cleanString(candidate?.analysisVersion || candidate?.analysis_version, 160);
    const contiguous = spans.every((span, index) => index === 0 || Math.abs(span.startTime - spans[index - 1].endTime) <= 0.000001);
    if (!candidate || spans.length !== expectedCount || !analysisVersion || !contiguous) {
      throw Object.assign(new Error(`${version.toUpperCase()} analysis must contain exactly ${expectedCount} contiguous observed syllables and an analysis version.`), { status: 400, code: 'ANALYSIS_PROVENANCE_REQUIRED' });
    }
    versions[version] = {
      schemaVersion: version === 'v2' ? comparison.schemaVersion : partitionVariants.schemaVersion,
      variant: version,
      analysisVersion,
      count: spans.length,
      spans,
      source: version === 'v2' ? 'comparison.v2' : `partitionVariants.${version}`,
      comparisonId: cleanString(comparison.comparisonId, 200)
    };
  }
  return { comparison, versions, v4Provenance };
}

function normalizeWordBounds(value, manualSegments, duration) {
  const supplied = value && typeof value === 'object' ? value : {};
  const startTime = Number(supplied.startTime ?? supplied.start ?? manualSegments?.[0]?.startTime);
  const endTime = Number(supplied.endTime ?? supplied.end ?? manualSegments?.at(-1)?.endTime);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < 0 || endTime <= startTime || endTime > duration + 0.02) {
    throw Object.assign(new Error('wordBounds must contain a valid startTime and endTime within the audio.'), { status: 400, code: 'WORD_BOUNDS_REQUIRED' });
  }
  return { startTime: Number(startTime.toFixed(6)), endTime: Number(endTime.toFixed(6)) };
}

function automaticOrderFor(manifestSha256, taskId) {
  return sha256(`${manifestSha256}${taskId}`);
}

function automaticVersionOrderFor(manifestSha256, taskId) {
  const digest = automaticOrderFor(manifestSha256, taskId);
  return ['v2', 'v3', 'v4'].map((version, index) => ({ version, key: digest.slice(index * 16, (index + 1) * 16) }))
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((item) => item.version);
}

function requireVersionExposureLog(value, task) {
  if (!Array.isArray(value) || !value.length) {
    throw Object.assign(new Error('versionExposureLog is required before completion.'), { status: 400, code: 'EXPOSURE_LOG_REQUIRED' });
  }
  const automaticOrder = cleanString(task?.automaticOrder, 64);
  const automaticVersionOrder = Array.isArray(task?.automaticVersionOrder) ? task.automaticVersionOrder : [];
  if (!/^[a-f0-9]{64}$/.test(automaticOrder) || automaticVersionOrder.length !== 3
    || new Set(automaticVersionOrder).size !== 3 || automaticVersionOrder.some((version) => !['v2', 'v3', 'v4'].includes(version))) {
    throw Object.assign(new Error('The claimed task is missing its authoritative automatic version order.'), { status: 400, code: 'EXPOSURE_ORDER_REQUIRED' });
  }
  if (value.length !== automaticVersionOrder.length) {
    throw Object.assign(new Error('versionExposureLog must contain exactly one valid entry for each automatic version.'), { status: 400, code: 'EXPOSURE_LOG_INVALID' });
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || !['v2', 'v3', 'v4'].includes(entry.version)) {
      throw Object.assign(new Error('versionExposureLog contains an unknown automatic version.'), { status: 400, code: 'EXPOSURE_LOG_INVALID' });
    }
    if (entry.version !== automaticVersionOrder[index]) {
      throw Object.assign(new Error('versionExposureLog must exactly follow the server-provided automatic version order.'), { status: 400, code: 'EXPOSURE_ORDER_INVALID' });
    }
    const viewedAt = cleanString(entry.viewedAt, 80);
    if (cleanString(entry.automaticOrder, 64) !== automaticOrder || !viewedAt || !Number.isFinite(Date.parse(viewedAt))) {
      throw Object.assign(new Error('versionExposureLog entries must include the authoritative automaticOrder and viewedAt.'), { status: 400, code: 'EXPOSURE_LOG_INVALID' });
    }
    return {
      version: entry.version,
      automaticOrder,
      viewedAt
    };
  });
}

function requireAutomaticJudgment(value, versionExposureLog) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('A versioned automatic judgment is required after all automatic versions are exposed.'), { status: 400, code: 'AUTOMATIC_JUDGMENT_REQUIRED' });
  }
  if (cleanString(value.schemaVersion, 120) !== AUTOMATIC_JUDGMENT_SCHEMA_VERSION) {
    throw Object.assign(new Error(`automaticJudgment.schemaVersion must be ${AUTOMATIC_JUDGMENT_SCHEMA_VERSION}.`), { status: 400, code: 'AUTOMATIC_JUDGMENT_INVALID' });
  }
  const selectedVersions = Array.isArray(value.selectedVersions)
    ? value.selectedVersions.map((version) => cleanString(version, 20).toLowerCase())
    : [];
  const uniqueVersions = Array.from(new Set(selectedVersions)).sort((left, right) => ['v2', 'v3', 'v4'].indexOf(left) - ['v2', 'v3', 'v4'].indexOf(right));
  const none = value.none === true;
  if (selectedVersions.some((version) => !['v2', 'v3', 'v4'].includes(version))
    || uniqueVersions.length !== selectedVersions.length
    || (none && selectedVersions.length)
    || (!none && selectedVersions.length === 0)) {
    throw Object.assign(new Error('automaticJudgment must select one or more of V2, V3, and V4, or exclusively select None.'), { status: 400, code: 'AUTOMATIC_JUDGMENT_INVALID' });
  }
  const judgedAfterExposureAt = cleanString(value.judgedAfterExposureAt || value.judgedAt, 80);
  const judgedMillis = Date.parse(judgedAfterExposureAt);
  const latestExposureMillis = Math.max(...(Array.isArray(versionExposureLog) ? versionExposureLog.map((entry) => Date.parse(entry.viewedAt) || 0) : [0]));
  if (!judgedAfterExposureAt || !Number.isFinite(judgedMillis) || judgedMillis <= latestExposureMillis) {
    throw Object.assign(new Error('automaticJudgment must include a judgedAfterExposureAt timestamp after the final automatic exposure.'), { status: 400, code: 'AUTOMATIC_JUDGMENT_INVALID' });
  }
  return {
    schemaVersion: AUTOMATIC_JUDGMENT_SCHEMA_VERSION,
    selectedVersions: uniqueVersions,
    none,
    judgedAfterExposureAt
  };
}

function mergeVersionExposureLogs(existing, incoming) {
  const merged = [];
  const seen = new Set();
  [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])].forEach((entry) => {
    if (!entry || !['v2', 'v3', 'v4'].includes(entry.version)) return;
    const normalized = {
      version: entry.version,
      automaticOrder: cleanString(entry.automaticOrder, 64),
      viewedAt: cleanString(entry.viewedAt, 80)
    };
    const key = `${normalized.version}|${normalized.automaticOrder}|${normalized.viewedAt}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(normalized);
  });
  return merged;
}

function sampleIdForTask(taskId, sourceHash) {
  return `${taskId}-${String(sourceHash || '').slice(0, 16)}`.toLowerCase();
}

function uploadMiddleware(deps) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_AUDIO_BYTES, files: 1 }
  });
  return (req, res, next) => {
    const contentType = String(req.headers?.['content-type'] || '').toLowerCase();
    if (contentType.startsWith('multipart/form-data') && Buffer.isBuffer(req.rawBody)) {
      parseRawMultipartRequest(req).then(() => next()).catch((error) => deps.sendError(
        res,
        400,
        'INVALID_AUDIO',
        error?.message || 'Invalid audio upload.'
      ));
      return;
    }
    upload.single('audio')(req, res, (error) => {
      if (error) return deps.sendError(res, 400, 'INVALID_AUDIO', error.message || 'Invalid audio upload.');
      return next();
    });
  };
}

  async function listPreviousSamples(db, deps) {
  const supplied = typeof deps.previousSamples === 'function' ? await deps.previousSamples() : deps.previousSamples;
  const result = [];
  if (Array.isArray(supplied)) result.push(...supplied);

  try {
    const snapshot = await db.collection(CORPUS_COLLECTION).limit(500).get();
    snapshot.docs.forEach((doc) => {
      const data = doc.data() || {};
      if (data.studyPreviousSample === true || data.previousSample === true || data.studySource === 'previous-sample' || data.sourceKind === 'pronounce-local-sample') {
        result.push({ id: doc.id, ...data });
      }
    });
  } catch (_) {
    // A missing optional corpus collection should not make the study queue
    // unavailable; the explicit dependency can still provide prior samples.
  }

  const seen = new Set();
  return result.map((item) => ({
    ...serializeData(item),
    id: item.id || item.sampleId,
    taskId: item.taskId || item.sampleId || item.id,
    status: item.status || item.reviewStatus || (item.manualSegments?.length ? 'complete' : 'available')
  })).filter((item) => {
    const id = String(item.taskId || '').trim();
    const sourceHash = String(item.sourceHash || item.audioSha256 || '').trim().toLowerCase();
    if (!id) return false;
    const key = sourceHash ? `sha256:${sourceHash}` : `id:${id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 200);
}

function registerSegmentationStudyRoutes(router, deps) {
  const { db, sendSuccess, sendError, requireAdminHandlers = [], serverTimestamp } = deps;
  const uploadAudio = uploadMiddleware(deps);
  const manifestCache = new Map();

  async function getManifest(registry) {
    const key = registry.internalVersion;
    if (!manifestCache.has(key)) manifestCache.set(key, await resolveStudyManifest(deps, registry.publicVersion));
    return manifestCache.get(key);
  }

  function validateVersion(version) {
    const normalized = cleanString(version, 40);
    const registry = VERSION_REGISTRY[normalized];
    if (!registry) {
      const error = new Error('Unknown segmentation study version.');
      error.status = 404;
      error.code = 'STUDY_NOT_FOUND';
      throw error;
    }
    return registry;
  }

  function requireWritable(registry) {
    if (!registry.active) {
      throw Object.assign(new Error('Segmentation study v1 is retired; it remains readable but cannot be changed.'), { status: 410, code: 'STUDY_RETIRED' });
    }
  }

  function requireTaskVersion(task, registry) {
    if (task?.studyVersion !== registry.internalVersion) {
      throw Object.assign(new Error('The stored task studyVersion does not match the requested study version.'), { status: 400, code: 'STUDY_VERSION_MISMATCH' });
    }
  }

  function reservationRef(registry, identity) {
    return db.collection(RESERVATION_COLLECTION).doc(reservationDocId(registry.internalVersion, identity.operatorName, identity.sessionId));
  }

  function reservationPatch(registry, identity, taskId, claimExpiresAt, status = 'reserved') {
    return {
      studyVersion: registry.internalVersion,
      studyId: registry.studyId,
      taskId: status === 'reserved' ? taskId : null,
      operatorName: identity.operatorName,
      sessionId: identity.sessionId,
      status,
      claimExpiresAt: status === 'reserved' ? claimExpiresAt : null,
      updatedAt: serverTimestamp()
    };
  }

  function requireCurrentManifestTask(manifest, manifestVersion, manifestSha256, task, taskId, allowHoldout = false) {
    const entry = manifest.find((item) => item.taskId === taskId);
    if (!entry || (task.manifestVersion && task.manifestVersion !== manifestVersion) || (task.manifestSha256 && task.manifestSha256 !== manifestSha256)) {
      throw Object.assign(new Error('The requested task does not belong to the active immutable segmentation manifest.'), { status: 409, code: 'MANIFEST_MISMATCH' });
    }
    if (!allowHoldout && (entry.split === 'holdout' || task.split === 'holdout')) {
      throw Object.assign(new Error('Holdout tasks remain sequential and cannot be explicitly claimed.'), { status: 409, code: 'HOLDOUT_LOCKED' });
    }
    return entry;
  }

  function buildClaim(task, snapshot, registry, manifest, manifestVersion, manifestSha256, identity) {
    const now = Date.now();
    const next = {
      status: 'reserved',
      studyVersion: registry.internalVersion,
      studyId: registry.studyId,
      manifestVersion,
      manifestSha256,
      dialect: manifest.dialect || 'en-US',
      automaticOrder: automaticOrderFor(manifestSha256, snapshot.id),
      automaticVersionOrder: automaticVersionOrderFor(manifestSha256, snapshot.id),
      exposureLog: Array.isArray(task.exposureLog) ? task.exposureLog : [],
      claim: { operatorName: identity.operatorName, sessionId: identity.sessionId, claimedAt: new Date(now) },
      claimExpiresAt: claimExpiry(now),
      updatedAt: serverTimestamp()
    };
    next.exposureLog = next.exposureLog.concat({
      event: 'automatic-boundaries-exposed',
      studyVersion: registry.internalVersion,
      taskId: snapshot.id,
      automaticOrder: next.automaticOrder,
      versions: next.automaticVersionOrder,
      automaticBoundariesVisible: true,
      exposedAt: new Date(now)
    });
    return {
      next,
      claimed: serializeTask({ id: snapshot.id, data: () => ({ ...task, ...next }) }),
      reservation: reservationPatch(registry, identity, snapshot.id, next.claimExpiresAt)
    };
  }

  async function readTasks(registry) {
    const snapshot = await db.collection(TASK_COLLECTION)
      .where('studyVersion', '==', registry.internalVersion)
      .limit(MAX_TASKS)
      .get();
    return snapshot.docs
      .map((doc) => serializeTask(doc))
      .sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
  }

  function buildProgress(tasks) {
    const progress = { available: 0, reserved: 0, completed: 0, uncertain: 0, failed: 0 };
    tasks.forEach((task) => {
      const status = claimIsActive(task) ? 'reserved' : (task.status === 'reserved' ? 'available' : task.status);
      if (Object.prototype.hasOwnProperty.call(progress, status)) progress[status] += 1;
      if (task.certainty === 'uncertain' || task.reviewStatus === 'uncertain') progress.uncertain += 1;
      if (task.analysisStatus === 'analysis_failed' || task.status === 'analysis_failed') progress.failed += 1;
    });
    return progress;
  }

  router.get('/dev/segmentation-study/:studyVersion', ...requireAdminHandlers, async (req, res) => {
    try {
      const registry = validateVersion(req.params.studyVersion);
      const manifest = await getManifest(registry);
      const tasks = await readTasks(registry);
      const identity = req.query?.sessionId ? {
        operatorName: cleanString(req.query.operatorName, 80),
        sessionId: cleanString(req.query.sessionId, 80)
      } : null;
      const currentClaim = identity?.sessionId
        ? tasks.find((task) => claimIsActive(task) && ownerMatches(task, identity.operatorName, identity.sessionId)) || null
        : null;
      return sendSuccess(res, {
        studyVersion: registry.internalVersion,
        studyId: registry.studyId,
        publicStudyVersion: registry.publicVersion,
        manifestVersion: manifest.manifestVersion || registry.manifestVersion,
        manifestSha256: manifest.manifestSha256 || sha256(JSON.stringify(canonicalJson(manifest))),
        dialect: manifest.dialect || 'en-US',
        manifest: manifest.map((entry) => serializeData(entry)),
        tasks,
        previousSamples: await listPreviousSamples(db, deps),
        progress: buildProgress(tasks),
        currentClaim
      });
    } catch (error) {
      const status = error?.status || 500;
      return sendError(res, status, error?.code || 'SEGMENTATION_STUDY_LIST_ERROR', error?.message || 'Failed to load segmentation study.');
    }
  });

  router.get('/dev/segmentation-study/:studyVersion/export', ...requireAdminHandlers, async (req, res) => {
    try {
      const registry = validateVersion(req.params.studyVersion);
      const manifest = await getManifest(registry);
      const manifestVersion = manifest.manifestVersion || registry.manifestVersion;
      const manifestSha256 = manifest.manifestSha256 || sha256(JSON.stringify(canonicalJson(manifest)));
      const tasks = await readTasks(registry);
      const bucket = await deps.getStorageBucket();
      const samples = [];
      for (const task of tasks.filter((item) => item.completedSampleId)) {
        const sampleSnapshot = await db.collection(CORPUS_COLLECTION).doc(task.completedSampleId).get();
        if (!sampleSnapshot.exists) continue;
        const sample = serializeData({ id: sampleSnapshot.id, ...sampleSnapshot.data() });
        let activeReview = null;
        const reviewId = sample.activeManualReviewId;
        if (reviewId) {
          const reviewSnapshot = await db.collection(CORPUS_COLLECTION).doc(sampleSnapshot.id).collection('manualReviews').doc(reviewId).get();
          if (reviewSnapshot.exists) activeReview = serializeData({ id: reviewSnapshot.id, ...reviewSnapshot.data() });
        }
        const audioUrl = bucket && sample.storagePath ? (await bucket.file(sample.storagePath).getSignedUrl({ action: 'read', expires: Date.now() + (15 * 60 * 1000) }))[0] : null;
        const versions = sample.versions || sample.partitionVariants || null;
        const variantProvenance = sample.variantProvenance || null;
        const captureMetadata = sample.captureMetadata || {
          ...(sample.captureSettings || sample.getSettings || {}),
          captureId: sample.captureId || sample.sampleId || sample.id || task.taskId,
          capturedAt: sample.capturedAt || sample.createdAt || null,
          sessionId: sample.operatorSessionId || sample.sessionId || null
        };
        const assistedEvidence = {
          ...(sample.assistedEvidence || sample.assistedMetadata || {}),
          assisted: sample.versionExposureComplete === true,
          annotationProtocol: sample.annotationProtocol || 'automatic-visible-assisted-v1',
          exposureLog: Array.isArray(sample.versionExposureLog) && sample.versionExposureLog.length
            ? sample.versionExposureLog
            : (Array.isArray(sample.exposureLog) ? sample.exposureLog : []),
          reviewer: sample.operatorName || null,
          reviewerSessionId: sample.operatorSessionId || sample.sessionId || null
        };
        const exposureProofComplete = sample.versionExposureComplete === true && assistedEvidence.assisted === true;
        samples.push({
          taskId: task.taskId || task.id || null,
          sampleId: sample.sampleId || sample.id || null,
          targetWord: sample.targetWord || task.targetWord || null,
          studyVersion: registry.internalVersion,
          studyId: registry.studyId,
          manifestVersion,
          manifestSha256,
          dialect: sample.dialect || task.dialect || manifest.dialect || 'en-US',
          certainty: sample.certainty || activeReview?.certainty || null,
          analysisStatus: sample.analysisStatus || null,
          analysisRevision: sample.analysisRevision || null,
          wordStartTime: sample.wordStartTime ?? sample.wordBounds?.startTime ?? null,
          wordEndTime: sample.wordEndTime ?? sample.wordBounds?.endTime ?? null,
          manualSegments: sample.manualSegments || activeReview?.manualSegments || [],
          referenceLabelProvenance: sample.referenceLabelProvenance || task.referenceLabelProvenance || null,
          annotationProtocol: sample.annotationProtocol || activeReview?.annotationProtocol || null,
          automaticJudgment: sample.automaticJudgment || activeReview?.automaticJudgment || null,
          promotionEligible: sample.certainty === 'certain' && sample.needsManualReview !== true
            && exposureProofComplete && sample.captureEligibility === true,
          versionExposureComplete: sample.versionExposureComplete === true,
          captureEligibility: sample.captureEligibility === true,
          captureMetadata,
          assistedEvidence,
          assistedMetadata: assistedEvidence,
          variantProvenance,
          versions,
          task,
          sample,
          activeReview,
          audioUrl,
        });
      }
      return sendSuccess(res, {
        schemaVersion: 'segmentation-study-export-v2',
        studyVersion: registry.internalVersion,
        studyId: registry.studyId,
        manifestVersion,
        manifestSha256,
        samples
      });
    } catch (error) {
      return sendError(res, error?.status || 500, error?.code || 'SEGMENTATION_STUDY_EXPORT_ERROR', error?.message || 'Failed to export the segmentation study.');
    }
  });

  router.post('/dev/segmentation-study/:studyVersion/claim-next', ...requireAdminHandlers, async (req, res) => {
    try {
      const registry = validateVersion(req.params.studyVersion);
      requireWritable(registry);
      const identity = normalizeIdentity(req.body || {});
      const manifest = await getManifest(registry);
      const manifestVersion = manifest.manifestVersion || registry.manifestVersion;
      const manifestSha256 = manifest.manifestSha256 || sha256(JSON.stringify(canonicalJson(manifest)));
      const rawTaskId = req.body?.taskId;
      const requestedTaskId = rawTaskId == null ? null : cleanString(rawTaskId, 128);
      if (rawTaskId != null && (typeof rawTaskId !== 'string' || !TASK_ID_RE.test(requestedTaskId))) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid taskId.');
      }
      const existingTasks = await readTasks(registry);
      const existing = existingTasks.find((task) => claimIsActive(task) && ownerMatches(task, identity.operatorName, identity.sessionId));
      const lockRef = reservationRef(registry, identity);
      if (existing && !requestedTaskId) {
        let resumed = null;
        await db.runTransaction(async (tx) => {
          const [snapshot, lockSnapshot] = await Promise.all([
            tx.get(db.collection(TASK_COLLECTION).doc(existing.taskId)),
            tx.get(lockRef)
          ]);
          if (!snapshot.exists) return;
          const task = snapshot.data() || {};
          if (!claimIsActive(task) || !ownerMatches(task, identity.operatorName, identity.sessionId)) return;
          requireCurrentManifestTask(manifest, manifestVersion, manifestSha256, task, snapshot.id);
          const lock = lockSnapshot.exists ? (lockSnapshot.data() || {}) : null;
          if (reservationIsActive(lock) && lock.taskId !== snapshot.id) {
            throw Object.assign(new Error('This operator already has an active segmentation study reservation.'), { status: 409, code: 'CLAIM_CONFLICT' });
          }
          if (!reservationIsActive(lock) || lock.taskId !== snapshot.id) {
            tx.set(lockRef, reservationPatch(registry, identity, snapshot.id, task.claimExpiresAt), { merge: true });
          }
          resumed = serializeTask(snapshot);
        });
        if (resumed) return sendSuccess(res, { task: resumed, claim: resumed }, 'Existing segmentation study claim resumed.');
      }

      if (requestedTaskId) {
        const ref = db.collection(TASK_COLLECTION).doc(requestedTaskId);
        let claimed = null;
        let resumed = false;
        await db.runTransaction(async (tx) => {
          const [snapshot, lockSnapshot] = await Promise.all([tx.get(ref), tx.get(lockRef)]);
          if (!snapshot.exists) throw Object.assign(new Error('Segmentation study task not found.'), { status: 404, code: 'TASK_NOT_FOUND' });
          const task = snapshot.data() || {};
          requireTaskVersion(task, registry);
          requireCurrentManifestTask(manifest, manifestVersion, manifestSha256, task, requestedTaskId);
          if (task.status === 'completed') throw Object.assign(new Error('This segmentation study task has already been completed.'), { status: 409, code: 'TASK_COMPLETED' });
          if (existing && existing.taskId !== requestedTaskId) {
            throw Object.assign(new Error('This operator already has an active segmentation study reservation.'), { status: 409, code: 'CLAIM_CONFLICT' });
          }
          const lock = lockSnapshot.exists ? (lockSnapshot.data() || {}) : null;
          if (reservationIsActive(lock) && lock.taskId !== requestedTaskId) {
            throw Object.assign(new Error('This operator already has an active segmentation study reservation.'), { status: 409, code: 'CLAIM_CONFLICT' });
          }
          if (claimIsActive(task)) {
            if (ownerMatches(task, identity.operatorName, identity.sessionId)) {
              claimed = serializeTask(snapshot);
              resumed = true;
              if (!reservationIsActive(lock) || lock.taskId !== requestedTaskId) {
                tx.set(lockRef, reservationPatch(registry, identity, requestedTaskId, task.claimExpiresAt), { merge: true });
              }
              return;
            }
            throw Object.assign(new Error('This task reservation belongs to another operator.'), { status: 409, code: 'CLAIM_CONFLICT' });
          }
          if (!['available', 'reserved'].includes(task.status)) {
            throw Object.assign(new Error('This segmentation study task is not available.'), { status: 409, code: 'TASK_UNAVAILABLE' });
          }
          const built = buildClaim(task, snapshot, registry, manifest, manifestVersion, manifestSha256, identity);
          tx.set(ref, built.next, { merge: true });
          tx.set(lockRef, built.reservation, { merge: true });
          claimed = built.claimed;
        });
        return sendSuccess(res, { task: claimed, claim: claimed }, resumed ? 'Existing segmentation study claim resumed.' : 'Segmentation study task reserved.');
      }

      const candidateSnapshots = await db.collection(TASK_COLLECTION)
        .where('studyVersion', '==', registry.internalVersion)
        .where('status', 'in', ['available', 'reserved'])
        .orderBy('order', 'asc')
        .limit(MAX_TASKS)
        .get();
      const candidates = candidateSnapshots.docs
        .map((doc) => ({ doc, task: doc.data() || {} }))
        .sort((left, right) => Number(left.task.order || 0) - Number(right.task.order || 0));

      let holdoutLocked = false;
      let hasValidDevelopmentCandidate = false;
      for (const candidate of candidates) {
        const ref = candidate.doc.ref || db.collection(TASK_COLLECTION).doc(candidate.doc.id);
        let claimed = null;
        await db.runTransaction(async (tx) => {
          const [snapshot, lockSnapshot] = await Promise.all([tx.get(ref), tx.get(lockRef)]);
          if (!snapshot.exists) return;
          const task = snapshot.data() || {};
          let manifestEntry;
          try {
            manifestEntry = requireCurrentManifestTask(manifest, manifestVersion, manifestSha256, task, snapshot.id, true);
          } catch (error) {
            if (error?.code === 'MANIFEST_MISMATCH') return;
            throw error;
          }
          if (manifestEntry.split === 'holdout' || task.split === 'holdout') {
            holdoutLocked = true;
            return;
          }
          hasValidDevelopmentCandidate = true;
          const lock = lockSnapshot.exists ? (lockSnapshot.data() || {}) : null;
          if (reservationIsActive(lock) && lock.taskId !== snapshot.id) return;
          if (task.status === 'completed') return;
          if (claimIsActive(task)) {
            if (!ownerMatches(task, identity.operatorName, identity.sessionId)) return;
            claimed = serializeTask(snapshot);
            if (!reservationIsActive(lock) || lock.taskId !== snapshot.id) {
              tx.set(lockRef, reservationPatch(registry, identity, snapshot.id, task.claimExpiresAt), { merge: true });
            }
            return;
          }
          const built = buildClaim(task, snapshot, registry, manifest, manifestVersion, manifestSha256, identity);
          tx.set(ref, built.next, { merge: true });
          tx.set(lockRef, built.reservation, { merge: true });
          claimed = built.claimed;
        });
        if (claimed) return sendSuccess(res, { task: claimed, claim: claimed }, 'Segmentation study task reserved.');
      }
      if (holdoutLocked && !hasValidDevelopmentCandidate) {
        return sendError(res, 409, 'HOLDOUT_LOCKED', 'Holdout tasks remain locked until development configuration is frozen.');
      }
      return sendError(res, 409, 'NO_TASK_AVAILABLE', 'No segmentation study word is currently available.');
    } catch (error) {
      const status = error?.status || (error?.message?.includes('required') ? 400 : 500);
      return sendError(res, status, error?.code || 'SEGMENTATION_STUDY_CLAIM_ERROR', error?.message || 'Failed to reserve a segmentation study task.');
    }
  });

  router.post('/dev/segmentation-study/:studyVersion/tasks/:taskId/heartbeat', ...requireAdminHandlers, async (req, res) => {
    try {
      const registry = validateVersion(req.params.studyVersion);
      requireWritable(registry);
      const identity = normalizeIdentity(req.body || {});
      const taskId = cleanString(req.params.taskId, 128);
      if (!TASK_ID_RE.test(taskId)) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid taskId.');
      const ref = db.collection(TASK_COLLECTION).doc(taskId);
      const lockRef = reservationRef(registry, identity);
      let result = null;
      await db.runTransaction(async (tx) => {
        const [snapshot, lockSnapshot] = await Promise.all([tx.get(ref), tx.get(lockRef)]);
        if (!snapshot.exists) throw Object.assign(new Error('Segmentation study task not found.'), { status: 404, code: 'TASK_NOT_FOUND' });
        const task = snapshot.data() || {};
        requireTaskVersion(task, registry);
        if (!claimIsActive(task) || !ownerMatches(task, identity.operatorName, identity.sessionId)) {
          throw Object.assign(new Error('This task reservation has expired or belongs to another operator.'), { status: 409, code: 'CLAIM_EXPIRED' });
        }
        const lock = lockSnapshot.exists ? (lockSnapshot.data() || {}) : null;
        if (reservationIsActive(lock) && lock.taskId !== snapshot.id) {
          throw Object.assign(new Error('This operator already has an active segmentation study reservation.'), { status: 409, code: 'CLAIM_CONFLICT' });
        }
        const next = { claimExpiresAt: claimExpiry(), updatedAt: serverTimestamp() };
        tx.set(ref, next, { merge: true });
        tx.set(lockRef, reservationPatch(registry, identity, snapshot.id, next.claimExpiresAt), { merge: true });
        result = serializeTask({ id: snapshot.id, data: () => ({ ...task, ...next }) });
      });
      return sendSuccess(res, { task: result, claim: result }, 'Segmentation study reservation extended.');
    } catch (error) {
      return sendError(res, error?.status || 500, error?.code || 'SEGMENTATION_STUDY_HEARTBEAT_ERROR', error?.message || 'Failed to extend the segmentation study reservation.');
    }
  });

  router.post('/dev/segmentation-study/:studyVersion/tasks/:taskId/release', ...requireAdminHandlers, async (req, res) => {
    try {
      const registry = validateVersion(req.params.studyVersion);
      requireWritable(registry);
      const identity = normalizeIdentity(req.body || {});
      const taskId = cleanString(req.params.taskId, 128);
      if (!TASK_ID_RE.test(taskId)) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid taskId.');
      const ref = db.collection(TASK_COLLECTION).doc(taskId);
      const lockRef = reservationRef(registry, identity);
      let released = null;
      await db.runTransaction(async (tx) => {
        const [snapshot, lockSnapshot] = await Promise.all([tx.get(ref), tx.get(lockRef)]);
        if (!snapshot.exists) throw Object.assign(new Error('Segmentation study task not found.'), { status: 404, code: 'TASK_NOT_FOUND' });
        const task = snapshot.data() || {};
        requireTaskVersion(task, registry);
        if (task.status === 'completed') throw Object.assign(new Error('Completed tasks cannot be released.'), { status: 409, code: 'TASK_COMPLETED' });
        if (!ownerMatches(task, identity.operatorName, identity.sessionId)) {
          throw Object.assign(new Error('This task reservation belongs to another operator.'), { status: 409, code: 'CLAIM_CONFLICT' });
        }
        const lock = lockSnapshot.exists ? (lockSnapshot.data() || {}) : null;
        if (reservationIsActive(lock) && lock.taskId !== snapshot.id) {
          throw Object.assign(new Error('This operator already has an active segmentation study reservation.'), { status: 409, code: 'CLAIM_CONFLICT' });
        }
        const next = {
          status: 'available',
          claim: null,
          claimExpiresAt: null,
          updatedAt: serverTimestamp()
        };
        tx.set(ref, next, { merge: true });
        tx.set(lockRef, reservationPatch(registry, identity, snapshot.id, null, 'released'), { merge: true });
        released = serializeTask({ id: snapshot.id, data: () => ({ ...task, ...next }) });
      });
      return sendSuccess(res, { task: released }, 'Segmentation study task released.');
    } catch (error) {
      return sendError(res, error?.status || 500, error?.code || 'SEGMENTATION_STUDY_RELEASE_ERROR', error?.message || 'Failed to release the segmentation study task.');
    }
  });

  router.post('/dev/segmentation-study/:studyVersion/tasks/:taskId/complete', ...requireAdminHandlers, uploadAudio, async (req, res) => {
    let storagePath = null;
    let transactionCommitted = false;
    try {
      const registry = validateVersion(req.params.studyVersion);
      requireWritable(registry);
      const manifest = await getManifest(registry);
      const taskId = cleanString(req.params.taskId, 128);
      if (!TASK_ID_RE.test(taskId)) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid taskId.');
      if (!req.file?.buffer) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing audio file.');
      const rawMetadata = String(req.body?.metadata || '');
      if (!rawMetadata) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing JSON metadata.');
      if (Buffer.byteLength(rawMetadata, 'utf8') > MAX_METADATA_BYTES) return sendError(res, 400, 'VALIDATION_ERROR', 'Metadata exceeds the 640 KB limit.');
      let metadata;
      try { metadata = JSON.parse(rawMetadata); } catch (_) { return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid JSON metadata.'); }
      const identity = normalizeIdentity({
        operatorName: req.body?.operatorName || metadata.operatorName,
        sessionId: req.body?.sessionId || metadata.sessionId
      });
      if (![registry.internalVersion, registry.publicVersion].includes(cleanString(metadata.studyVersion, 40)) || cleanString(metadata.taskId, 128) !== taskId) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Metadata studyVersion and taskId must match the request.');
      }
      if (metadata.automaticBoundariesVisible !== true) return sendError(res, 400, 'VALIDATION_ERROR', 'automaticBoundariesVisible must be true for study samples.');
      if (metadata.annotationProtocol !== 'automatic-visible-assisted-v1') return sendError(res, 400, 'VALIDATION_ERROR', 'annotationProtocol must be automatic-visible-assisted-v1.');
      if (metadata.playbackConfirmed !== true) return sendError(res, 400, 'PLAYBACK_CONFIRMATION_REQUIRED', 'Reviewer playback confirmation is required before completion.');
      if (metadata.referenceLabelProvenance !== REFERENCE_LABEL_PROVENANCE) return sendError(res, 400, 'REFERENCE_PROVENANCE_REQUIRED', `referenceLabelProvenance must be ${REFERENCE_LABEL_PROVENANCE}.`);
      const certainty = cleanString(metadata.certainty, 20).toLowerCase();
      if (!['certain', 'uncertain'].includes(certainty)) return sendError(res, 400, 'VALIDATION_ERROR', 'certainty must be certain or uncertain.');

      const audio = validateWavBuffer(req.file.buffer);
      const sourceHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
      const requestFingerprint = completionFingerprint(sourceHash, metadata);
      const taskRef = db.collection(TASK_COLLECTION).doc(taskId);
      const lockRef = reservationRef(registry, identity);
      const taskSnapshot = await taskRef.get();
      if (!taskSnapshot.exists) return sendError(res, 404, 'TASK_NOT_FOUND', 'Segmentation study task not found.');
      const task = taskSnapshot.data() || {};
      if (task.status === 'completed') {
        if (task.sourceHash === sourceHash && task.completionFingerprint === requestFingerprint && task.completedSampleId) {
          const sampleSnapshot = await db.collection(CORPUS_COLLECTION).doc(task.completedSampleId).get();
          return sendSuccess(res, { task: serializeTask(taskSnapshot), sample: sampleSnapshot.exists ? serializeData({ id: sampleSnapshot.id, ...sampleSnapshot.data() }) : null, idempotent: true }, 'Segmentation study task was already completed.');
        }
        return sendError(res, 409, 'TASK_COMPLETED', 'This segmentation study task has already been completed.');
      }
      if (!claimIsActive(task) || !ownerMatches(task, identity.operatorName, identity.sessionId)) return sendError(res, 409, 'CLAIM_EXPIRED', 'This task reservation has expired or belongs to another operator.');
      if (task.studyVersion !== registry.internalVersion) return sendError(res, 400, 'VALIDATION_ERROR', 'Task studyVersion does not match the active registry version.');
      if (!normalizeIpa(metadata.referenceIpa) || normalizeIpa(metadata.referenceIpa) !== normalizeIpa(task.referenceIpa)) {
        return sendError(res, 400, 'REFERENCE_PROVENANCE_REQUIRED', 'referenceIpa must match the claimed task reference IPA.');
      }
      const taskDialect = cleanString(task.dialect || manifest.dialect, 40) || 'en-US';
      if (taskDialect !== 'en-US') {
        return sendError(res, 400, 'REFERENCE_PROVENANCE_REQUIRED', 'V4 A2 syllabification currently supports en-US only.');
      }
      if (metadata.dialect != null && cleanString(metadata.dialect, 40) !== taskDialect) {
        return sendError(res, 400, 'REFERENCE_PROVENANCE_REQUIRED', 'dialect must match the claimed task dialect.');
      }
      const incomingVersionExposureLog = requireVersionExposureLog(metadata.versionExposureLog, task);
      const automaticJudgment = requireAutomaticJudgment(metadata.automaticJudgment, incomingVersionExposureLog);
      const versionExposureLog = mergeVersionExposureLogs(task.versionExposureLog, incomingVersionExposureLog);
      const authoritativeExposureLog = Array.isArray(task.exposureLog) ? task.exposureLog : [];
      if (cleanString(metadata.targetWord, 120).toLowerCase() !== cleanString(task.targetWord, 120).toLowerCase()) return sendError(res, 400, 'VALIDATION_ERROR', 'targetWord does not match the claimed task.');
      const targetSyllableCount = Number(task.targetSyllableCount);
      if (Number(metadata.targetSyllableCount) !== targetSyllableCount || Number(metadata.expectedObservedCount) !== targetSyllableCount) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Metadata syllable counts do not match the claimed task.');
      }
      if (metadata.referenceSyllableIpa != null && (!Array.isArray(metadata.referenceSyllableIpa) || metadata.referenceSyllableIpa.length !== targetSyllableCount)) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'referenceSyllableIpa must match the claimed task syllable count.');
      }
      const manualSegments = normalizeTimingSegments(metadata.manualSegments, 'manualSegments');
      if (!manualSegments?.length || manualSegments.length !== targetSyllableCount) return sendError(res, 400, 'VALIDATION_ERROR', 'manualSegments must contain one contiguous segment per target syllable.');
      if (manualSegments.some((segment) => segment.endTime > audio.duration + 0.02)) return sendError(res, 400, 'VALIDATION_ERROR', 'manualSegments must fall within the uploaded audio duration.');
      const captureSettings = requireCaptureSettings(metadata);
      // Bind V4 provenance validation to the server-owned task IPA rather than
      // trusting a client-controlled metadata copy.
      const comparisonResult = requireCompleteComparison({ ...metadata, referenceIpa: task.referenceIpa, dialect: taskDialect }, targetSyllableCount);
      const variantProvenance = requireVariantProvenance(metadata, comparisonResult.versions);
      if (metadata.analysisStatus !== 'complete') return sendError(res, 400, 'ANALYSIS_REQUIRED', 'analysisStatus must be complete before a study task can be saved.');
      const wordBounds = normalizeWordBounds(metadata.wordBounds, manualSegments, audio.duration);
      const manifestVersion = manifest.manifestVersion || registry.manifestVersion;
      const manifestSha256 = manifest.manifestSha256 || sha256(JSON.stringify(canonicalJson(manifest)));
      if (metadata.manifestSha256 && metadata.manifestSha256 !== manifestSha256) return sendError(res, 400, 'VALIDATION_ERROR', 'manifestSha256 does not match the active manifest.');
      if (metadata.manifestVersion && metadata.manifestVersion !== manifestVersion) return sendError(res, 400, 'VALIDATION_ERROR', 'manifestVersion does not match the active manifest.');
      const referenceLabelProvenance = REFERENCE_LABEL_PROVENANCE;

      const corpusMetadata = {
        sampleId: sampleIdForTask(taskId, sourceHash),
        targetWord: task.targetWord,
        referenceIpa: task.referenceIpa || metadata.referenceIpa || `/${task.targetWord}/`,
        expectedObservedCount: targetSyllableCount,
        targetSyllableCount,
        category: 'clean',
        speakerCohort: cleanString(task.speakerCohort, 80) || registry.studyId,
        needsManualReview: certainty === 'uncertain',
        reviewReason: certainty === 'uncertain' ? 'operator_uncertain' : null,
        segmentationConvention: metadata.manualSegmentationConvention || 'ipa-phonological-contiguous-v1',
         referenceSyllableIpa: task.referenceSyllableIpa || metadata.referenceSyllableIpa || null,
         referenceLabelProvenance: safeJson(referenceLabelProvenance, 2000),
         automaticSegmentationConvention: `${registry.internalVersion}-automatic`,
         // The saved automatic analysis is the comparison-only V4.1 result;
         // V3 remains available in ``analysis``/``versions`` but must not be
         // advertised as the revision that produced automaticSegments.
         analysisRevision: 'pronunciation-analysis-v4.1',
         sourceComparisonId: cleanString(metadata.sourceComparisonId || metadata.comparison?.comparisonId, 200) || null,
         manualSegments,
         automaticSegments: comparisonResult.versions.v4.spans
       };
      const normalized = validateCorpusMetadata(corpusMetadata);
      const bucket = await deps.getStorageBucket();
      if (!bucket) return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Storage is not initialized.');
      const sampleId = normalized.sampleId;
      storagePath = `pronunciation-segmentation-corpus/${sampleId}.wav`;
      await bucket.file(storagePath).save(req.file.buffer, {
        resumable: false,
        metadata: { contentType: 'audio/wav', metadata: { sampleId, sourceHash, studyVersion: registry.internalVersion, taskId } }
      });

      const now = serverTimestamp();
      const reviewMetadata = validateManualReviewMetadata({
        manualSegments: normalized.manualSegments,
        manualSegmentationConvention: normalized.segmentationConvention,
        certainty,
        automaticBoundariesVisible: true,
        reviewerName: identity.operatorName,
        reviewerSessionId: identity.sessionId,
        analysisRevision: normalized.analysisRevision
      }, {
        expectedObservedCount: targetSyllableCount,
        durationSeconds: audio.duration
      });
      const reviewRecord = buildManualReviewRecord({
        sampleId,
        normalized: reviewMetadata,
        createdAt: now,
        createdByUid: req.user?.uid || null,
        createdByEmail: req.user?.email || null,
        extra: {
          studyVersion: registry.internalVersion,
          studyId: registry.studyId,
          taskId,
          sourceHash,
          annotationProtocol: 'automatic-visible-assisted-v1',
          manifestVersion,
          manifestSha256,
          dialect: taskDialect,
          referenceLabelProvenance: safeJson(referenceLabelProvenance, 2000),
          wordBounds,
          wordStartTime: wordBounds.startTime,
          wordEndTime: wordBounds.endTime,
          playbackConfirmed: true,
          variantProvenance: safeJson(variantProvenance),
          automaticJudgment
        }
      });
      const sampleRecord = {
        ...normalized,
        studyVersion: registry.internalVersion,
        studyId: registry.studyId,
        taskId,
        studyTaskOrder: Number.isInteger(task.order) ? task.order : null,
        split: task.split || null,
        transitionClasses: Array.isArray(task.transitionClasses) ? task.transitionClasses : [],
        manifestVersion,
        manifestSha256,
        dialect: taskDialect,
        referenceLabelProvenance: safeJson(referenceLabelProvenance, 2000),
        wordBounds,
        wordStartTime: wordBounds.startTime,
        wordEndTime: wordBounds.endTime,
        annotationProtocol: 'automatic-visible-assisted-v1',
        playbackConfirmed: true,
        operatorName: identity.operatorName,
        operatorSessionId: identity.sessionId,
        certainty,
        reviewStatus: certainty === 'uncertain' ? 'uncertain' : 'complete',
        needsManualReview: certainty === 'uncertain',
        reviewReason: certainty === 'uncertain' ? 'operator_uncertain' : null,
        automaticBoundariesVisible: true,
        analysisStatus: 'complete',
        analysisError: null,
        analysis: safeJson(metadata.comparison || metadata.analysis),
        // Keep the immutable V4 structural evidence separate from the
        // timing-only automaticSegments corpus field.
        v4Provenance: safeJson(comparisonResult.v4Provenance),
        versions: safeJson(comparisonResult.versions),
        variantProvenance: safeJson(variantProvenance),
        automaticJudgment,
        partitionVariants: safeJson({ v2: comparisonResult.versions.v2.spans, v3: comparisonResult.versions.v3.spans, v4: comparisonResult.versions.v4.spans }),
        rawCtcSpans: safeJson(metadata.rawCtcSpans || metadata.ctcSpans || metadata.comparison?.v3?.analysis?.observed_syllables || null),
        measurementSpans: safeJson(metadata.measurementSpans || metadata.comparison?.v3?.analysis?.measurementSpans || null),
        captureSettings,
        getSettings: captureSettings,
        captureConstraintsRequested: CAPTURE_CONSTRAINTS_REQUESTED,
        captureEligibility: true,
        automaticOrder: task.automaticOrder || automaticOrderFor(manifestSha256, taskId),
        automaticVersionOrder: task.automaticVersionOrder || automaticVersionOrderFor(manifestSha256, taskId),
        exposureLog: safeJson(authoritativeExposureLog, 12000),
        versionExposureLog: safeJson(incomingVersionExposureLog, 12000),
        versionExposureComplete: true,
        sourceHash,
        completionFingerprint: requestFingerprint,
        storagePath,
        contentType: 'audio/wav',
        bytes: req.file.buffer.length,
        durationSeconds: audio.duration,
        sampleRate: audio.sampleRate,
        channels: audio.channels,
        bitsPerSample: audio.bitsPerSample,
        activeManualReviewId: reviewRecord.reviewId,
        manualReviewCount: 1,
        createdByUid: req.user?.uid || null,
        createdByEmail: req.user?.email || null,
        createdAt: now,
        updatedAt: now
      };
      const sampleRef = db.collection(CORPUS_COLLECTION).doc(sampleId);
      const reviewRef = sampleRef.collection('manualReviews').doc(reviewRecord.reviewId);
      const audioHashRef = db.collection(AUDIO_HASH_COLLECTION).doc(sourceHash);
      let resultTask = null;
      await db.runTransaction(async (tx) => {
        const [currentSnapshot, existingReviewSnapshot, existingAudioHashSnapshot, lockSnapshot] = await Promise.all([
          tx.get(taskRef),
          tx.get(reviewRef),
          tx.get(audioHashRef),
          tx.get(lockRef)
        ]);
        if (!currentSnapshot.exists) throw Object.assign(new Error('Segmentation study task not found.'), { status: 404, code: 'TASK_NOT_FOUND' });
        const currentTask = currentSnapshot.data() || {};
        requireTaskVersion(currentTask, registry);
        if (currentTask.status === 'completed') {
          if (currentTask.sourceHash === sourceHash && currentTask.completionFingerprint === requestFingerprint && currentTask.completedSampleId === sampleId) return;
          throw Object.assign(new Error('This segmentation study task has already been completed.'), { status: 409, code: 'TASK_COMPLETED' });
        }
        if (!claimIsActive(currentTask) || !ownerMatches(currentTask, identity.operatorName, identity.sessionId)) {
          throw Object.assign(new Error('This task reservation has expired or belongs to another operator.'), { status: 409, code: 'CLAIM_EXPIRED' });
        }
        const lock = lockSnapshot.exists ? (lockSnapshot.data() || {}) : null;
        if (reservationIsActive(lock) && lock.taskId !== currentSnapshot.id) {
          throw Object.assign(new Error('This operator already has an active segmentation study reservation.'), { status: 409, code: 'CLAIM_CONFLICT' });
        }
        if (existingReviewSnapshot.exists) {
          throw Object.assign(new Error('This manual review already exists for the claimed sample.'), { status: 409, code: 'REVIEW_CONFLICT' });
        }
        if (existingAudioHashSnapshot.exists && existingAudioHashSnapshot.data()?.sampleId !== sampleId) {
          throw Object.assign(new Error('This WAV is already assigned to another segmentation study sample.'), { status: 409, code: 'DUPLICATE_AUDIO' });
        }
        const currentAuthoritativeExposureLog = Array.isArray(currentTask.exposureLog) ? currentTask.exposureLog : [];
        const currentVersionExposureLog = mergeVersionExposureLogs(currentTask.versionExposureLog, incomingVersionExposureLog);
        sampleRecord.exposureLog = safeJson(currentAuthoritativeExposureLog, 12000);
        sampleRecord.versionExposureLog = safeJson(incomingVersionExposureLog, 12000);
        tx.set(audioHashRef, {
          sourceHash,
          sampleId,
          studyVersion: registry.internalVersion,
          studyId: registry.studyId,
          taskId,
          createdAt: now
        }, { merge: false });
        tx.set(reviewRef, reviewRecord, { merge: false });
        tx.set(sampleRef, sampleRecord, { merge: false });
        const taskPatch = {
          status: 'completed',
          claim: null,
          claimExpiresAt: null,
          completedSampleId: sampleId,
          sourceHash,
          completionFingerprint: requestFingerprint,
          certainty,
          reviewStatus: certainty === 'uncertain' ? 'uncertain' : 'complete',
          analysisStatus: 'complete',
          manifestVersion,
          manifestSha256,
          automaticOrder: sampleRecord.automaticOrder,
          automaticVersionOrder: sampleRecord.automaticVersionOrder,
          exposureLog: sampleRecord.exposureLog,
          versionExposureLog: safeJson(currentVersionExposureLog, 12000),
          completedAt: now,
          updatedAt: now
        };
        tx.set(taskRef, taskPatch, { merge: true });
        tx.set(lockRef, reservationPatch(registry, identity, taskId, null, 'released'), { merge: true });
        resultTask = serializeTask({ id: currentSnapshot.id, data: () => ({ ...currentTask, ...taskPatch }) });
      });
      transactionCommitted = true;
      const [audioUrl] = await bucket.file(storagePath).getSignedUrl({ action: 'read', expires: Date.now() + (15 * 60 * 1000) });
      const responseSample = {
        ...sampleRecord,
        id: sampleId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      return sendSuccess(res, { task: resultTask, sample: serializeData(responseSample), sampleId, audioUrl }, 'Segmentation study sample saved.');
    } catch (error) {
      if (storagePath && !transactionCommitted) {
        try { const bucket = await deps.getStorageBucket(); await bucket?.file(storagePath).delete(); } catch (_) { /* best effort cleanup */ }
      }
      const status = error?.status || (error?.name === 'CorpusValidationError' ? 400 : 500);
      return sendError(res, status, error?.code || (status === 400 ? 'SEGMENTATION_STUDY_VALIDATION_ERROR' : 'SEGMENTATION_STUDY_COMPLETE_ERROR'), error?.message || 'Failed to complete the segmentation study task.');
    }
  });
}

module.exports = registerSegmentationStudyRoutes;
module.exports.TASK_COLLECTION = TASK_COLLECTION;
module.exports.CORPUS_COLLECTION = CORPUS_COLLECTION;
module.exports.AUDIO_HASH_COLLECTION = AUDIO_HASH_COLLECTION;
module.exports.STUDY_VERSION = STUDY_VERSION;
module.exports.PUBLIC_STUDY_VERSION = PUBLIC_STUDY_VERSION;
module.exports.normalizeManifest = normalizeManifest;
module.exports.resolveStudyManifest = resolveStudyManifest;
module.exports.claimIsActive = claimIsActive;
module.exports.automaticOrderFor = automaticOrderFor;
module.exports.automaticVersionOrderFor = automaticVersionOrderFor;
module.exports.sanitizeCaptureSettings = sanitizeCaptureSettings;
module.exports.requireAutomaticJudgment = requireAutomaticJudgment;
module.exports.AUTOMATIC_JUDGMENT_SCHEMA_VERSION = AUTOMATIC_JUDGMENT_SCHEMA_VERSION;
module.exports.v4ContentHash = v4ContentHash;
