// Asset intake contract and validation for BEL Blocky 3D Art Direction (BEL-ART-01 v1.0)
'use strict';

const ART_DIRECTION_ID = 'BEL-ART-01';
const ART_DIRECTION_VERSION = '1.0';

const BLOCKER_REASONS = {
  WAITING_FOR_CLAUDE_ASSETS: 'WAITING_FOR_CLAUDE_ASSETS',
  CLAUDE_ASSET_INCOMPATIBLE: 'CLAUDE_ASSET_INCOMPATIBLE',
  CLAUDE_ASSET_STYLE_MISMATCH: 'CLAUDE_ASSET_STYLE_MISMATCH',
  WAITING_FOR_VISUAL_APPROVAL: 'WAITING_FOR_VISUAL_APPROVAL'
};

const STAGES = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5'];

const MATERIAL_ROUGHNESS_BOUNDS = {
  plaster: { min: 0.80, max: 0.95, desc: 'Quiet, softly lit enclosure (walls)' },
  timber: { min: 0.55, max: 0.80, desc: 'Directional surface character, restrained highlights (floor, planks)' },
  fabric: { min: 0.85, max: 1.00, desc: 'Soft-looking, matte separation from wood (upholstery)' },
  paintedFurniture: { min: 0.55, max: 0.80, desc: 'Clean planes without plastic-toy glare' },
  metal: { min: 0.30, max: 0.55, desc: 'Small material accents only, not a metallic room' }
};

const LIGHTING_PASSES = [
  { id: 'L0', name: 'Neutral material view', question: 'Are base colors, normals, symbols, and proportions correct without atmosphere?' },
  { id: 'L1', name: 'Main light', question: 'Do top and side planes separate without losing faces or required marks?' },
  { id: 'L2', name: 'Fill/environment', question: 'Can the four avatars and all essential objects be distinguished?' },
  { id: 'L3', name: 'Grounding', question: 'Do contacts follow movement and avoid obvious floating, acne, or detached shadows?' },
  { id: 'L4', name: 'Material response', question: 'Do timber, cloth, walls and limited metal read differently without glare?' },
  { id: 'L5', name: 'Optional refinement', question: 'Is there a visible benefit at real size, and does the four-window budget still pass?' }
];

const ART_AUDIT_CHECKS = {
  'ART-01': {
    name: 'Theme and source identity',
    requiredEvidence: 'Original BEL reference beside the new equivalent.',
    failCondition: 'Robot/armor/sci-fi architecture, changed setting, new lore, or altered room inventory.'
  },
  'ART-02': {
    name: 'Block geometry',
    requiredEvidence: 'Neutral front/side/game views and optional geometry inspection.',
    failCondition: 'Main silhouettes remain spherical/capsule dolls or a pixel filter substitutes for geometric translation.'
  },
  'ART-03': {
    name: 'Semantic shapes and variants',
    requiredEvidence: 'All original plank/cube/shape marks and profile variants under neutral and final lighting.',
    failCondition: 'Ambiguity, remapping, early text exposure or shared mutable appearance state.'
  },
  'ART-04': {
    name: 'Environment completeness',
    requiredEvidence: 'Full Room F and representative G view at actual gameplay framing.',
    failCondition: 'Submitted final-art scene remains only plain slabs with little representation of its actual room.'
  },
  'ART-05': {
    name: 'Geometry/affordance alignment',
    requiredEvidence: 'Debug collision view paired with clean view; partial/complete bridge and door/seat tests.',
    failCondition: 'Apparent solid support over an unwalkable gap or visually missing support on a valid floor.'
  },
  'ART-06': {
    name: 'Lighting and surface separation',
    requiredEvidence: 'Same camera/pose under neutral and final lighting; lights/effects disabled individually for diagnosis.',
    failCondition: 'Washed-out semantic colors, invisible faces, detached shadows, flat finishes everywhere or obscured routes.'
  },
  'ART-07': {
    name: 'Camera and UI readability',
    requiredEvidence: 'Normal and actual tiled-window screenshots, source modal scrolled to its end, I choices and F HUD visible.',
    failCondition: 'Required camera manipulation, clipped functional space or pixelated content.'
  },
  'ART-08': {
    name: 'Motion and attachments',
    requiredEvidence: 'Normal-speed video of every delivered required pose/transition, four independent actors and carried props.',
    failCondition: 'Drift, sliding while stopped, detached items, clipped grips or new mandatory animation waits.'
  },
  'ART-09': {
    name: 'Preview/runtime agreement',
    requiredEvidence: 'Asset hashes, pinned engine, camera, lighting and output preset alongside equivalent preview/runtime captures.',
    failCondition: 'Mismatched versions, unsupported effects or beauty shots that the runtime cannot reproduce.'
  },
  'ART-10': {
    name: 'Four-window robustness',
    requiredEvidence: 'Headed Chrome logs, real input/actions, resource/frame traces, low/reduced-motion and fallback checks.',
    failCondition: 'Isolated-preview performance is substituted for the real game or original behavior regresses.'
  }
};

const REQUIRED_HANDOFF_FIELDS = [
  'artDirection',
  'producer',
  'batch',
  'representation',
  'sourceBaseline',
  'engine',
  'themeReferences',
  'visualConceptReference',
  'changedAssets',
  'protectedMappings',
  'pivotsUnitsSockets',
  'previewPreset',
  'evidence',
  'technicalStatus',
  'humanVisualStatus',
  'integratedStatus',
  'openDefects'
];

const STYLE_PROHIBITED_PATTERNS = [
  /\bsci[-_ ]?fi\b/i,
  /\brobot(s|ic)?\b/i,
  /\bruins?\b/i,
  /\barmou?r(ed)?\b/i,
  /\bspace[-_ ]?suits?\b/i,
  /\bportals?\b/i,
  /\bmonuments?\b/i,
  /\bfantasy\b/i,
  /\bcombat\b/i,
  /\bweapons?\b/i,
  /\bcyborgs?\b/i,
  /\bcybernetic\b/i,
  /\baliens?\b/i,
  /\bfuturistic\b/i
];

function isProhibitedStyleContent(text) {
  if (typeof text !== 'string') return false;
  return STYLE_PROHIBITED_PATTERNS.some(re => re.test(text));
}

function isReferenceArtifactPath(relPath) {
  if (typeof relPath !== 'string') return false;
  const normalized = relPath.replace(/\\/g, '/');
  return /(?:^|\/)(?:BEL_Visual_References|reference[_-]pack)(?:\/|$)/i.test(normalized) ||
         /(?:^|\/)vesper([_\-./]|$)/i.test(normalized) ||
         /(?:^|\/)bel_batch0_reference/i.test(normalized) ||
         /(?:^|\/)(?:reference|BEL_Art_Direction_Pack)[_-]manifest\.json$/i.test(normalized);
}

function classifyBlocker(input) {
  if (!input || !input.filesSupplied) {
    return {
      status: 'BLOCKED',
      reason: BLOCKER_REASONS.WAITING_FOR_CLAUDE_ASSETS,
      detail: 'Missing required Claude asset files'
    };
  }

  if (input.technicalError) {
    return {
      status: 'BLOCKED',
      reason: BLOCKER_REASONS.CLAUDE_ASSET_INCOMPATIBLE,
      detail: input.technicalError
    };
  }

  if (input.styleMismatch) {
    return {
      status: 'BLOCKED',
      reason: BLOCKER_REASONS.CLAUDE_ASSET_STYLE_MISMATCH,
      detail: input.styleMismatch
    };
  }

  if (input.humanVisualStatus === 'rejected') {
    return {
      status: 'BLOCKED',
      reason: BLOCKER_REASONS.CLAUDE_ASSET_STYLE_MISMATCH,
      detail: 'Asset visual styling was rejected during human review'
    };
  }

  if (input.humanVisualStatus !== 'approved') {
    return {
      status: 'BLOCKED',
      reason: BLOCKER_REASONS.WAITING_FOR_VISUAL_APPROVAL,
      detail: `Human visual approval status is "${input.humanVisualStatus || 'pending'}"`
    };
  }

  return { status: 'READY', reason: null, detail: 'Intake validation passed' };
}

function validateHandoffRecord(record) {
  if (!record || typeof record !== 'object') {
    throw new Error('Handoff record must be a non-null object');
  }

  const missing = REQUIRED_HANDOFF_FIELDS.filter(f => !(f in record));
  if (missing.length > 0) {
    throw new Error(`Handoff record missing required fields: ${missing.join(', ')}`);
  }

  if (record.artDirection !== `${ART_DIRECTION_ID} v${ART_DIRECTION_VERSION}`) {
    throw new Error(`Invalid artDirection: expected "${ART_DIRECTION_ID} v${ART_DIRECTION_VERSION}", got "${record.artDirection}"`);
  }

  if (record.producer !== 'Claude') {
    throw new Error(`Invalid producer: expected "Claude", got "${record.producer}"`);
  }

  if (record.representation !== 'THREE_MODULE' && record.representation !== 'GLB') {
    throw new Error(`Invalid representation: expected "THREE_MODULE" or "GLB", got "${record.representation}"`);
  }

  const validVisualStatuses = ['pending', 'approved', 'rejected'];
  if (!validVisualStatuses.includes(record.humanVisualStatus)) {
    throw new Error(`Invalid humanVisualStatus: must be one of ${validVisualStatuses.join(', ')}`);
  }

  // Check for prohibited style terms in metadata descriptions
  const inspectable = JSON.stringify(record);
  if (isProhibitedStyleContent(inspectable)) {
    return {
      valid: false,
      blocker: {
        status: 'BLOCKED',
        reason: BLOCKER_REASONS.CLAUDE_ASSET_STYLE_MISMATCH,
        detail: 'Handoff record contains prohibited sci-fi/robot/ruins terminology'
      }
    };
  }

  // Batch 0 special constraint: compatibility sample only, cannot be approved as final art
  if (record.batch === 'Batch0') {
    if (record.isFinalArt === true || record.humanVisualStatus === 'approved') {
      return {
        valid: false,
        blocker: {
          status: 'BLOCKED',
          reason: BLOCKER_REASONS.CLAUDE_ASSET_STYLE_MISMATCH,
          detail: 'Batch 0 is an isolated compatibility sample and cannot be accepted as final art (rounded avatars and bare slabs require S1 blocky redesign)'
        }
      };
    }
  }

  // Evidence validation: evidence cannot be empty
  if (!record.evidence || (Array.isArray(record.evidence) && record.evidence.length === 0)) {
    return {
      valid: false,
      blocker: {
        status: 'BLOCKED',
        reason: BLOCKER_REASONS.WAITING_FOR_CLAUDE_ASSETS,
        detail: 'Handoff record must include non-empty evidence files or test results'
      }
    };
  }

  // Lighting preset validation if preview preset defines passes
  if (record.previewPreset && record.previewPreset.passes) {
    const lightCheck = validateLightingPreset(record.previewPreset);
    if (!lightCheck.valid) {
      return {
        valid: false,
        blocker: {
          status: 'BLOCKED',
          reason: BLOCKER_REASONS.CLAUDE_ASSET_INCOMPATIBLE,
          detail: lightCheck.error
        }
      };
    }
  }

  const blocker = classifyBlocker({
    filesSupplied: true,
    technicalError: record.technicalStatus !== 'PASS' ? (record.technicalDetail || 'Technical check failed') : null,
    styleMismatch: null,
    humanVisualStatus: record.humanVisualStatus
  });

  return {
    valid: blocker.status === 'READY',
    blocker
  };
}

function validateMaterialSettings(family, settings) {
  const bounds = MATERIAL_ROUGHNESS_BOUNDS[family];
  if (!bounds) {
    throw new Error(`Unknown material family: ${family}. Allowed: ${Object.keys(MATERIAL_ROUGHNESS_BOUNDS).join(', ')}`);
  }

  if (typeof settings.roughness !== 'number' || !Number.isFinite(settings.roughness)) {
    throw new Error(`Material ${family} must define finite numeric roughness`);
  }

  if (settings.roughness < bounds.min || settings.roughness > bounds.max) {
    return {
      valid: false,
      error: `Roughness ${settings.roughness} out of bounds for ${family} [${bounds.min}, ${bounds.max}]`
    };
  }

  // Check metalness: non-metals should not have high metalness
  if (family !== 'metal' && typeof settings.metalness === 'number') {
    if (!Number.isFinite(settings.metalness) || settings.metalness > 0.15 || settings.metalness < 0) {
      return {
        valid: false,
        error: `Non-metal family ${family} has invalid or excessive metalness (${settings.metalness}); must be in [0, 0.15]`
      };
    }
  }

  if (family === 'metal' && typeof settings.metalness === 'number') {
    if (!Number.isFinite(settings.metalness) || settings.metalness < 0 || settings.metalness > 1) {
      return {
        valid: false,
        error: `Metal family has invalid metalness (${settings.metalness}); must be in [0, 1]`
      };
    }
  }

  return { valid: true };
}

function validateLightingPreset(preset) {
  if (!preset || typeof preset !== 'object') {
    throw new Error('Lighting preset must be an object');
  }

  if (!preset.passes || !Array.isArray(preset.passes)) {
    throw new Error('Lighting preset must specify passes array (L0-L4/L5)');
  }

  const requiredPassIds = ['L0', 'L1', 'L2', 'L3', 'L4'];
  const passIds = preset.passes.map(p => typeof p === 'string' ? p : p?.id);
  const missingPasses = requiredPassIds.filter(id => !passIds.includes(id));
  if (missingPasses.length > 0) {
    return {
      valid: false,
      error: `Lighting preset missing required passes: ${missingPasses.join(', ')}`
    };
  }

  // Interior default rule: no fog
  if (preset.isInterior !== false && preset.fog === true) {
    return {
      valid: false,
      error: 'Interiors must default to no fog per BEL-ART-01 Section 9.2'
    };
  }

  return { valid: true };
}

module.exports = {
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
};
