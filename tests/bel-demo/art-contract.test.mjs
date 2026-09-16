import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ART_DIRECTION_ID,
  ART_DIRECTION_VERSION,
  BLOCKER_REASONS,
  STAGES,
  MATERIAL_ROUGHNESS_BOUNDS,
  LIGHTING_PASSES,
  ART_AUDIT_CHECKS,
  REQUIRED_HANDOFF_FIELDS,
  isProhibitedStyleContent,
  isReferenceArtifactPath,
  classifyBlocker,
  validateHandoffRecord,
  validateMaterialSettings,
  validateLightingPreset
} from '../../scripts/bel-demo/asset-contract.cjs';

test('BEL-ART-01 specification constants, checks, and handoff schema completeness', () => {
  assert.equal(ART_DIRECTION_ID, 'BEL-ART-01');
  assert.equal(ART_DIRECTION_VERSION, '1.0');
  assert.deepEqual(STAGES, ['S0', 'S1', 'S2', 'S3', 'S4', 'S5']);

  // All 10 ART checks present
  for (let i = 1; i <= 10; i++) {
    const id = `ART-${String(i).padStart(2, '0')}`;
    assert(ART_AUDIT_CHECKS[id], `Missing ${id}`);
    assert(ART_AUDIT_CHECKS[id].name.length > 0);
    assert(ART_AUDIT_CHECKS[id].requiredEvidence.length > 0);
    assert(ART_AUDIT_CHECKS[id].failCondition.length > 0);
  }

  // All 6 lighting passes L0-L5 present
  assert.equal(LIGHTING_PASSES.length, 6);
  const passIds = LIGHTING_PASSES.map(p => p.id);
  assert.deepEqual(passIds, ['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);

  // Material roughness bounds defined for all 5 families
  const families = ['plaster', 'timber', 'fabric', 'paintedFurniture', 'metal'];
  for (const f of families) {
    const b = MATERIAL_ROUGHNESS_BOUNDS[f];
    assert(b, `Missing material family: ${f}`);
    assert(b.min >= 0 && b.max <= 1 && b.min <= b.max);
  }

  // All 17 handoff fields required
  assert.equal(REQUIRED_HANDOFF_FIELDS.length, 17);
  assert(REQUIRED_HANDOFF_FIELDS.includes('artDirection'));
  assert(REQUIRED_HANDOFF_FIELDS.includes('producer'));
  assert(REQUIRED_HANDOFF_FIELDS.includes('previewPreset'));
  assert(REQUIRED_HANDOFF_FIELDS.includes('humanVisualStatus'));
});

test('blocker classification enforces exact blocker reasons and precedence', () => {
  // 1. Missing files
  const r1 = classifyBlocker({ filesSupplied: false });
  assert.equal(r1.status, 'BLOCKED');
  assert.equal(r1.reason, BLOCKER_REASONS.WAITING_FOR_CLAUDE_ASSETS);

  // 2. Technical error
  const r2 = classifyBlocker({ filesSupplied: true, technicalError: 'Export syntax error' });
  assert.equal(r2.status, 'BLOCKED');
  assert.equal(r2.reason, BLOCKER_REASONS.CLAUDE_ASSET_INCOMPATIBLE);

  // 3. Style mismatch
  const r3 = classifyBlocker({ filesSupplied: true, styleMismatch: 'Robotic armor model rejected' });
  assert.equal(r3.status, 'BLOCKED');
  assert.equal(r3.reason, BLOCKER_REASONS.CLAUDE_ASSET_STYLE_MISMATCH);

  // 4. Pending visual approval
  const r4 = classifyBlocker({ filesSupplied: true, humanVisualStatus: 'pending' });
  assert.equal(r4.status, 'BLOCKED');
  assert.equal(r4.reason, BLOCKER_REASONS.WAITING_FOR_VISUAL_APPROVAL);

  // 5. Ready when approved and no errors
  const r5 = classifyBlocker({ filesSupplied: true, humanVisualStatus: 'approved' });
  assert.equal(r5.status, 'READY');
  assert.equal(r5.reason, null);
});

test('prohibited style content detection rejects sci-fi, robots, armor and ruins (including plurals and variants)', () => {
  assert.equal(isProhibitedStyleContent('Standard human colleague model with shirt and pants'), false);
  assert.equal(isProhibitedStyleContent('Timber platform and painted desk'), false);

  // Singular and plural forms
  assert.equal(isProhibitedStyleContent('Futuristic robot character with visor'), true);
  assert.equal(isProhibitedStyleContent('Two robots conversing'), true);
  assert.equal(isProhibitedStyleContent('Robotic limb mechanics'), true);
  assert.equal(isProhibitedStyleContent('Post-apocalyptic ruins courtyard'), true);
  assert.equal(isProhibitedStyleContent('Ancient stone ruin'), true);
  assert.equal(isProhibitedStyleContent('Cybernetic armor and spacesuit'), true);
  assert.equal(isProhibitedStyleContent('Armored vehicle and body armour'), true);
  assert.equal(isProhibitedStyleContent('Space suit accessories'), true);
  assert.equal(isProhibitedStyleContent('Space-suit helmet'), true);
  assert.equal(isProhibitedStyleContent('Interdimensional portal gateway'), true);
  assert.equal(isProhibitedStyleContent('Multiple portals in scene'), true);
  assert.equal(isProhibitedStyleContent('Towering fantasy monument'), true);
  assert.equal(isProhibitedStyleContent('Ancient monuments'), true);
  assert.equal(isProhibitedStyleContent('Combat weapons'), true);
  assert.equal(isProhibitedStyleContent('Cyborg colleague model'), true);
  assert.equal(isProhibitedStyleContent('Alien landscape backdrop'), true);
});

test('reference artifact detector protects documentary images from runtime usage across path formats', () => {
  assert.equal(isReferenceArtifactPath('BEL_Visual_References/vesper_game_reference.png'), true);
  assert.equal(isReferenceArtifactPath('BEL_Visual_References/bel_batch0_reference.png'), true);
  assert.equal(isReferenceArtifactPath('models/vesper_block_construction.png'), true);
  assert.equal(isReferenceArtifactPath('art/vesper-screen.png'), true);
  assert.equal(isReferenceArtifactPath('art/vesper.png'), true);
  assert.equal(isReferenceArtifactPath('models/vesper/scene.png'), true);
  assert.equal(isReferenceArtifactPath('art/bel_batch0_reference.png'), true);
  assert.equal(isReferenceArtifactPath('art/reference-manifest.json'), true);
  assert.equal(isReferenceArtifactPath('BEL_Art_Direction_Pack_Manifest.json'), true);

  // Windows backslash paths
  assert.equal(isReferenceArtifactPath('art\\vesper_game_reference.png'), true);
  assert.equal(isReferenceArtifactPath('BEL_Visual_References\\bel_batch0_reference.png'), true);

  // Normal runtime assets pass
  assert.equal(isReferenceArtifactPath('art/A.png'), false);
  assert.equal(isReferenceArtifactPath('models/room-f.mjs'), false);
  assert.equal(isReferenceArtifactPath('models/avatar.mjs'), false);
});

test('Batch 0 diagnostic sample is recognized and rejected as final art', () => {
  const baseRecord = {
    artDirection: 'BEL-ART-01 v1.0',
    producer: 'Claude',
    batch: 'Batch0',
    representation: 'THREE_MODULE',
    sourceBaseline: '249a8fc86b5a293f82008b0db07c64aeca4ad2bd',
    engine: 'three@0.128.0',
    themeReferences: ['home', 'reception', 'A', 'F'],
    visualConceptReference: 'Vesper visual construction reference only',
    changedAssets: ['models/avatar_sample.mjs', 'models/plank_sample.mjs'],
    protectedMappings: ['circle', 'triangle', 'profile_variants'],
    pivotsUnitsSockets: 'standard',
    previewPreset: { camera: 'orthographic' },
    evidence: ['preview.png'],
    technicalStatus: 'PASS',
    humanVisualStatus: 'approved',
    integratedStatus: 'pending',
    openDefects: [],
    isFinalArt: true // claiming final art!
  };

  // Rejects Batch 0 if explicitly claimed as final production art
  const resFinal = validateHandoffRecord(baseRecord);
  assert.equal(resFinal.valid, false);
  assert.equal(resFinal.blocker.reason, BLOCKER_REASONS.CLAUDE_ASSET_STYLE_MISMATCH);
  assert(resFinal.blocker.detail.includes('Batch 0 is an isolated compatibility sample'));

  // Rejects Batch 0 even if isFinalArt is omitted/false but humanVisualStatus is 'approved'
  delete baseRecord.isFinalArt;
  baseRecord.humanVisualStatus = 'approved';
  const resApproved = validateHandoffRecord(baseRecord);
  assert.equal(resApproved.valid, false);
  assert.equal(resApproved.blocker.reason, BLOCKER_REASONS.CLAUDE_ASSET_STYLE_MISMATCH);

  // When treated properly as diagnostic sample pending S1 visual redesign:
  baseRecord.humanVisualStatus = 'pending';
  const resDiag = validateHandoffRecord(baseRecord);
  assert.equal(resDiag.valid, false);
  assert.equal(resDiag.blocker.reason, BLOCKER_REASONS.WAITING_FOR_VISUAL_APPROVAL);

  // When rejected during visual review:
  baseRecord.humanVisualStatus = 'rejected';
  const resRej = validateHandoffRecord(baseRecord);
  assert.equal(resRej.valid, false);
  assert.equal(resRej.blocker.reason, BLOCKER_REASONS.CLAUDE_ASSET_STYLE_MISMATCH);
});

test('material roughness validation enforces BEL-ART-01 ranges, numeric finiteness, and non-metal limits', () => {
  // Plaster walls: [0.80, 0.95]
  assert.equal(validateMaterialSettings('plaster', { roughness: 0.85 }).valid, true);
  assert.equal(validateMaterialSettings('plaster', { roughness: 0.50 }).valid, false);

  // Timber floor/planks: [0.55, 0.80]
  assert.equal(validateMaterialSettings('timber', { roughness: 0.65 }).valid, true);
  assert.equal(validateMaterialSettings('timber', { roughness: 0.90 }).valid, false);

  // Fabric upholstery: [0.85, 1.00]
  assert.equal(validateMaterialSettings('fabric', { roughness: 0.90 }).valid, true);
  assert.equal(validateMaterialSettings('fabric', { roughness: 0.70 }).valid, false);

  // Painted furniture: [0.55, 0.80], metalness <= 0.15
  assert.equal(validateMaterialSettings('paintedFurniture', { roughness: 0.70, metalness: 0.05 }).valid, true);
  assert.equal(validateMaterialSettings('paintedFurniture', { roughness: 0.70, metalness: 0.50 }).valid, false);

  // Metal details: [0.30, 0.55]
  assert.equal(validateMaterialSettings('metal', { roughness: 0.40, metalness: 0.8 }).valid, true);
  assert.equal(validateMaterialSettings('metal', { roughness: 0.20 }).valid, false);

  // Rejection of non-finite numbers (NaN, Infinity)
  assert.throws(() => validateMaterialSettings('timber', { roughness: NaN }), /finite numeric roughness/);
  assert.throws(() => validateMaterialSettings('timber', { roughness: Infinity }), /finite numeric roughness/);
  assert.equal(validateMaterialSettings('paintedFurniture', { roughness: 0.70, metalness: NaN }).valid, false);
  assert.equal(validateMaterialSettings('paintedFurniture', { roughness: 0.70, metalness: -0.1 }).valid, false);
});

test('lighting preset validation enforces passes L0-L4, format flexibility, and interior no-fog rule', () => {
  const validPresetObjects = {
    isInterior: true,
    fog: false,
    passes: [
      { id: 'L0', name: 'Neutral' },
      { id: 'L1', name: 'Main' },
      { id: 'L2', name: 'Fill' },
      { id: 'L3', name: 'Grounding' },
      { id: 'L4', name: 'Material' }
    ]
  };
  assert.equal(validateLightingPreset(validPresetObjects).valid, true);

  // String passes format
  const validPresetStrings = {
    isInterior: true,
    fog: false,
    passes: ['L0', 'L1', 'L2', 'L3', 'L4']
  };
  assert.equal(validateLightingPreset(validPresetStrings).valid, true);

  // Missing grounding pass L3
  const missingL3 = {
    isInterior: true,
    fog: false,
    passes: ['L0', 'L1', 'L2', 'L4']
  };
  assert.equal(validateLightingPreset(missingL3).valid, false);

  // Interior with fog set to true fails
  const fogPreset = { ...validPresetStrings, fog: true };
  assert.equal(validateLightingPreset(fogPreset).valid, false);
  assert(validateLightingPreset(fogPreset).error.includes('no fog'));
});

test('handoff record validation enforces schema, producer, art direction, presets, evidence, and prohibited terms', () => {
  const validRecord = {
    artDirection: 'BEL-ART-01 v1.0',
    producer: 'Claude',
    batch: 'Batch1-S1',
    representation: 'THREE_MODULE',
    sourceBaseline: '249a8fc86b5a293f82008b0db07c64aeca4ad2bd',
    engine: 'three@0.128.0',
    themeReferences: ['home', 'reception', 'A', 'F'],
    visualConceptReference: 'Vesper visual construction reference only',
    changedAssets: ['models/avatar_blocky.mjs', 'models/plank_timber.mjs'],
    protectedMappings: ['circle', 'triangle', 'profile_variants'],
    pivotsUnitsSockets: 'standard unchanged',
    previewPreset: { camera: 'orthographic', passes: ['L0', 'L1', 'L2', 'L3', 'L4'] },
    evidence: ['neutral.png', 'lit.png', 'walk.webm'],
    technicalStatus: 'PASS',
    humanVisualStatus: 'approved',
    integratedStatus: 'pending',
    openDefects: []
  };

  const res = validateHandoffRecord(validRecord);
  assert.equal(res.valid, true);
  assert.equal(res.blocker.status, 'READY');

  // Throws on missing required field
  const { previewPreset, ...missingField } = validRecord;
  assert.throws(() => validateHandoffRecord(missingField), /missing required fields/);

  // Throws on wrong producer
  assert.throws(() => validateHandoffRecord({ ...validRecord, producer: 'Gemini' }), /Invalid producer/);

  // Throws on wrong art direction
  assert.throws(() => validateHandoffRecord({ ...validRecord, artDirection: 'BEL-ART-02' }), /Invalid artDirection/);

  // Rejects sci-fi / robot content in handoff record
  const sciFiRecord = { ...validRecord, visualConceptReference: 'Sci-fi robot character with armor' };
  const resSciFi = validateHandoffRecord(sciFiRecord);
  assert.equal(resSciFi.valid, false);
  assert.equal(resSciFi.blocker.reason, BLOCKER_REASONS.CLAUDE_ASSET_STYLE_MISMATCH);

  // Rejects empty evidence array
  const noEvidenceRecord = { ...validRecord, evidence: [] };
  const resNoEv = validateHandoffRecord(noEvidenceRecord);
  assert.equal(resNoEv.valid, false);
  assert.equal(resNoEv.blocker.reason, BLOCKER_REASONS.WAITING_FOR_CLAUDE_ASSETS);

  // Rejects invalid lighting passes in previewPreset
  const badLightRecord = { ...validRecord, previewPreset: { passes: ['L0', 'L1'] } };
  const resBadLight = validateHandoffRecord(badLightRecord);
  assert.equal(resBadLight.valid, false);
  assert.equal(resBadLight.blocker.reason, BLOCKER_REASONS.CLAUDE_ASSET_INCOMPATIBLE);
});

test('packaging and serving scripts block reference pack and Vesper files from release across platforms', async () => {
  const { isBlocked } = await import('../../scripts/bel-demo/package.cjs');
  assert.equal(isBlocked('BEL_Visual_References/vesper_game_reference.png'), true);
  assert.equal(isBlocked('reference-pack/START_HERE_BEL_Blocky_3D.md'), true);
  assert.equal(isBlocked('art/vesper_foliage.png'), true);
  assert.equal(isBlocked('models/vesper_block_construction.png'), true);
  assert.equal(isBlocked('art/vesper-preview.png'), true);
  assert.equal(isBlocked('art/vesper.png'), true);
  assert.equal(isBlocked('models/vesper/scene.png'), true);
  assert.equal(isBlocked('art/bel_batch0_reference.png'), true);
  assert.equal(isBlocked('art/reference-manifest.json'), true);
  assert.equal(isBlocked('BEL_Art_Direction_Pack_Manifest.json'), true);

  // Windows path separators
  assert.equal(isBlocked('art\\vesper_game_reference.png'), true);
  assert.equal(isBlocked('BEL_Visual_References\\bel_batch0_reference.png'), true);

  // Normal valid runtime assets pass
  assert.equal(isBlocked('presentation/frame.mjs'), false);
  assert.equal(isBlocked('art/F.png'), false);
  assert.equal(isBlocked('models/avatar.mjs'), false);
});
