import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DOCS = path.join(ROOT, 'docs', 'echo-forge');
const CONTRACT_PATH = path.join(DOCS, 'visual-contract.v1.json');
const SCHEMA_PATH = path.join(DOCS, 'visual-contract.schema.json');
const CLAUDE_PATH = path.join(DOCS, 'CLAUDE_OPUS_VISUAL_HANDOFF.md');
const GEMINI_PATH = path.join(DOCS, 'GEMINI_3_7_FLASH_ASSET_HANDOFF.md');

const REQUIRED_EVENTS = [
  'sandbox.setup.completed',
  'combat.started',
  'player.action.selected',
  'recording.started',
  'recording.stopped',
  'analysis.pending',
  'analysis.resolved',
  'analysis.noop',
  'player.attack.resolved',
  'enemy.intent.presented',
  'player.block.resolved',
  'player.parry.started',
  'player.parry.resolved',
  'combat.damage.applied',
  'combat.focus.changed',
  'combat.resonance.ready',
  'combat.resonance.consumed',
  'combat.victory',
  'combat.defeat',
  'combat.abandoned',
  'telemetry.exported'
];

const ASSET_FIELDS = [
  'assetId',
  'stateEvents',
  'canvas',
  'frameCount',
  'frameOrder',
  'pivot',
  'padding',
  'zOrder',
  'paletteConstraints',
  'staticFallbackFrame',
  'mobileSafeCrop',
  'loop',
  'timingVariable'
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function expectSchemaField(schema, field, type) {
  assert.ok(schema.properties[field], `schema must define ${field}`);
  if (type) assert.equal(schema.properties[field].type, type, `${field} type`);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function resolveLocalRef(schema, rootSchema) {
  if (!schema.$ref) return schema;
  assert.match(schema.$ref, /^#\//, `focused evaluator only supports local refs: ${schema.$ref}`);
  return schema.$ref.slice(2).split('/').reduce((node, segment) => node[segment.replaceAll('~1', '/').replaceAll('~0', '~')], rootSchema);
}

const FOCUSED_SCHEMA_KEYWORDS = new Set([
  '$defs', '$id', '$ref', '$schema', 'additionalProperties', 'const', 'enum',
  'items', 'maxItems', 'maxLength', 'maximum', 'minItems', 'minLength',
  'minimum', 'pattern', 'properties', 'required', 'title', 'type', 'uniqueItems'
]);

function assertFocusedSchemaKeywords(rootSchema) {
  function visit(node, pointer) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const key of Object.keys(node)) {
      assert.ok(FOCUSED_SCHEMA_KEYWORDS.has(key), `${pointer} unsupported keyword ${key}`);
      if (key === 'properties' || key === '$defs') {
        for (const [childKey, childSchema] of Object.entries(node[key])) visit(childSchema, `${pointer}.${key}.${childKey}`);
      } else if (key === 'items') {
        visit(node[key], `${pointer}.items`);
      }
    }
  }
  visit(rootSchema, '$schema');
}

// A deliberately narrow, dependency-free evaluator for this closed contract:
// it implements every validation keyword used by visual-contract.schema.json,
// not general JSON Schema. The keyword-surface guard above makes omissions loud.
function assertFocusedSchemaValid(value, schema, label = '$', rootSchema = schema) {
  assertFocusedSchemaKeywords(rootSchema);
  function visit(node, rawSchema, pointer) {
    const current = resolveLocalRef(rawSchema, rootSchema);
    if (current.const !== undefined) assert.deepEqual(node, current.const, `${pointer} const`);
    if (current.enum) assert.ok(current.enum.some((allowed) => canonical(allowed) === canonical(node)), `${pointer} enum`);
    if (current.type) {
      const typeMatches = {
        object: node !== null && typeof node === 'object' && !Array.isArray(node),
        array: Array.isArray(node),
        string: typeof node === 'string',
        integer: Number.isInteger(node),
        boolean: typeof node === 'boolean'
      };
      assert.equal(typeMatches[current.type], true, `${pointer} type ${current.type}`);
    }
    if (typeof node === 'string') {
      if (current.minLength !== undefined) assert.ok(node.length >= current.minLength, `${pointer} minLength`);
      if (current.maxLength !== undefined) assert.ok(node.length <= current.maxLength, `${pointer} maxLength`);
      if (current.pattern) assert.match(node, new RegExp(current.pattern), `${pointer} pattern`);
    }
    if (typeof node === 'number') {
      if (current.minimum !== undefined) assert.ok(node >= current.minimum, `${pointer} minimum`);
      if (current.maximum !== undefined) assert.ok(node <= current.maximum, `${pointer} maximum`);
    }
    if (Array.isArray(node)) {
      if (current.minItems !== undefined) assert.ok(node.length >= current.minItems, `${pointer} minItems`);
      if (current.maxItems !== undefined) assert.ok(node.length <= current.maxItems, `${pointer} maxItems`);
      if (current.uniqueItems) assert.equal(new Set(node.map(canonical)).size, node.length, `${pointer} uniqueItems`);
      if (current.items) node.forEach((item, index) => visit(item, current.items, `${pointer}[${index}]`));
    }
    if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
      if (current.required) for (const requiredKey of current.required) assert.ok(Object.hasOwn(node, requiredKey), `${pointer}.${requiredKey} required`);
      if (current.additionalProperties === false) {
        for (const key of Object.keys(node)) assert.ok(current.properties && Object.hasOwn(current.properties, key), `${pointer}.${key} unknown`);
      }
      for (const [key, childSchema] of Object.entries(current.properties || {})) {
        if (Object.hasOwn(node, key)) visit(node[key], childSchema, `${pointer}.${key}`);
      }
    }
  }
  visit(value, schema, label);
}

function assertUniqueAssetIds(contract) {
  const ids = contract.assetSlots.map((slot) => slot.assetId);
  assert.equal(new Set(ids).size, ids.length, 'assetId values must be unique');
}

function assertExactOneToOneAssetIdLinkage(assetSlots, sidecars) {
  assert.equal(sidecars.length, assetSlots.length, 'one sidecar is required for every visual asset');
  const visualIds = assetSlots.map((slot) => slot.assetId);
  const sidecarIds = sidecars.map((sidecar) => sidecar.assetId);
  assert.equal(new Set(visualIds).size, visualIds.length, 'visual asset IDs must be unique');
  assert.equal(new Set(sidecarIds).size, sidecarIds.length, 'provenance sidecar asset IDs must be unique');
  assert.deepEqual([...sidecarIds].sort(), [...visualIds].sort(), 'sidecar asset IDs must exactly match visual asset IDs');
}

function extractJsonExample(markdown, heading) {
  const headingPattern = new RegExp('### ' + heading + '[^\\n]*\\n[\\s\\S]*?```json\\s*([\\s\\S]*?)```', 'i');
  const match = markdown.match(headingPattern);
  assert.ok(match, `missing JSON example for ${heading}`);
  return JSON.parse(match[1]);
}

test('visual contract and schema are valid JSON and expose the approved event set', () => {
  const contract = readJson(CONTRACT_PATH);
  const schema = readJson(SCHEMA_PATH);

  assert.equal(contract.$schema, './visual-contract.schema.json');
  assert.equal(contract.schemaVersion, 'visual-contract-v1');
  assert.deepEqual(contract.eventTypes, REQUIRED_EVENTS);
  assert.equal(new Set(contract.eventTypes).size, REQUIRED_EVENTS.length);
  assert.deepEqual(schema.properties.eventTypes.items.enum, REQUIRED_EVENTS);
});

test('schema closes top-level and asset-slot objects and validates every slot field', () => {
  const contract = readJson(CONTRACT_PATH);
  const schema = readJson(SCHEMA_PATH);
  const slotSchema = schema.$defs.assetSlot;

  assert.equal(schema.additionalProperties, false);
  assert.equal(slotSchema.additionalProperties, false);
  assert.deepEqual(slotSchema.required, ASSET_FIELDS);
  assert.deepEqual(Object.keys(contract.assetSlots[0]).sort(), [...ASSET_FIELDS].sort());
  for (const field of ASSET_FIELDS) assert.ok(slotSchema.properties[field], `slot schema must define ${field}`);
  for (const [field, type] of Object.entries({
    assetId: 'string', stateEvents: 'array', canvas: 'object', frameCount: 'integer',
    frameOrder: 'array', pivot: 'object', padding: 'object', zOrder: 'integer',
    paletteConstraints: 'array', staticFallbackFrame: 'integer', mobileSafeCrop: 'object',
    loop: 'boolean', timingVariable: 'string'
  })) expectSchemaField(slotSchema, field, type);

  assert.ok(contract.assetSlots.length > 0);
  assert.deepEqual(
    [...new Set(contract.assetSlots.flatMap((slot) => slot.stateEvents))].sort(),
    [...REQUIRED_EVENTS].sort(),
    'every event must map to at least one visual slot'
  );
  for (const slot of contract.assetSlots) {
    assert.deepEqual(Object.keys(slot).sort(), [...ASSET_FIELDS].sort(), `${slot.assetId} slot keys`);
    assert.equal(slot.frameOrder.length, slot.frameCount, `${slot.assetId} frame order`);
    assert.ok(slot.staticFallbackFrame < slot.frameCount, `${slot.assetId} fallback frame`);
    assert.ok(slot.pivot.x <= slot.canvas.width && slot.pivot.y <= slot.canvas.height);
    assert.ok(slot.mobileSafeCrop.width <= slot.canvas.width);
    assert.ok(slot.mobileSafeCrop.height <= slot.canvas.height);
    assert.match(slot.timingVariable, /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/);
    for (const eventType of slot.stateEvents) assert.ok(REQUIRED_EVENTS.includes(eventType));
  }
});

test('focused evaluator validates the full contract and rejects unknown or bad nested values', () => {
  const contract = readJson(CONTRACT_PATH);
  const schema = readJson(SCHEMA_PATH);

  assertFocusedSchemaValid(contract, schema, 'contract');
  assertUniqueAssetIds(contract);
  assert.equal(Object.hasOwn(contract, 'provenance'), false, 'contract must remain free of provenance data');

  const unknownTopLevel = structuredClone(contract);
  unknownTopLevel.unexpected = true;
  assert.throws(() => assertFocusedSchemaValid(unknownTopLevel, schema), /unknown/);

  const badNestedValue = structuredClone(contract);
  badNestedValue.assetSlots[0].padding.top = -1;
  assert.throws(() => assertFocusedSchemaValid(badNestedValue, schema), /minimum/);

  const duplicateAssetId = structuredClone(contract);
  duplicateAssetId.assetSlots[1].assetId = duplicateAssetId.assetSlots[0].assetId;
  assert.throws(() => assertUniqueAssetIds(duplicateAssetId), /unique/);
});

test('provenance definitions validate valid and invalid sidecars with exact one-to-one slot linkage', () => {
  const contract = readJson(CONTRACT_PATH);
  const schema = readJson(SCHEMA_PATH);
  const brief = readText(GEMINI_PATH);
  const visualSlotExample = extractJsonExample(brief, 'Schema-bound visual slot record');
  const provenanceExample = extractJsonExample(brief, 'Provenance sidecar');
  const visualSlotSchema = schema.$defs.assetSlot;
  const provenanceRecordSchema = schema.$defs.provenanceRecord;
  const provenanceSidecarSchema = schema.$defs.provenanceSidecar;

  assertFocusedSchemaValid(visualSlotExample, visualSlotSchema, 'visualSlotExample', schema);
  assertFocusedSchemaValid(provenanceExample, provenanceRecordSchema, 'provenanceExample', schema);
  assertFocusedSchemaValid(provenanceExample, provenanceSidecarSchema, 'provenanceExample', schema);

  const linkedSidecars = contract.assetSlots.map((slot) => ({ ...provenanceExample, assetId: slot.assetId }));
  assertExactOneToOneAssetIdLinkage(contract.assetSlots, linkedSidecars);
  for (const sidecar of linkedSidecars) assertFocusedSchemaValid(sidecar, provenanceSidecarSchema, 'linkedSidecar', schema);

  const badHash = { ...provenanceExample, sha256: 'not-a-lowercase-64-character-hash' };
  assert.throws(() => assertFocusedSchemaValid(badHash, provenanceSidecarSchema), /pattern/);
  const unknownProvenanceField = { ...provenanceExample, unexpected: true };
  assert.throws(() => assertFocusedSchemaValid(unknownProvenanceField, provenanceSidecarSchema, 'unknownProvenanceField', schema), /unknown/);
  const unmatchedSidecar = { ...linkedSidecars[0], assetId: 'ef-missing-slot' };
  assert.throws(() => assertExactOneToOneAssetIdLinkage(contract.assetSlots, [unmatchedSidecar, ...linkedSidecars.slice(1)]), /exactly match/);
  const duplicateSidecar = { ...linkedSidecars[1], assetId: linkedSidecars[0].assetId };
  assert.throws(() => assertExactOneToOneAssetIdLinkage(contract.assetSlots, [linkedSidecars[0], duplicateSidecar, ...linkedSidecars.slice(2)]), /unique/);
});

test('contract keeps visual semantics separate from protected backend behavior', () => {
  const contractText = readText(CONTRACT_PATH).toLowerCase();
  const forbidden = [
    'accuracyfactor', 'combo bonus', 'damage =', 'combat formula', 'base damage',
    'production filename', 'creative direction', 'fixed duration', 'submitattempt',
    'firestore', 'account xp', 'mastery mutation'
  ];
  for (const term of forbidden) assert.equal(contractText.includes(term), false, `prohibited term: ${term}`);
  assert.match(contractText, /untrusted/);
  assert.match(contractText, /backend/);
  assert.match(contractText, /protected/);
});

test('Claude brief assigns the approved visual system and approval gate', () => {
  const brief = readText(CLAUDE_PATH);
  for (const requiredPath of [
    'docs/echo-forge/claude/visual-direction-options.md',
    'docs/echo-forge/claude/visual-design.md',
    'docs/echo-forge/claude/ui-state-matrix.md',
    'docs/echo-forge/claude/responsive-layout-spec.md',
    'docs/echo-forge/claude/accessibility-spec.md',
    'docs/echo-forge/claude/motion-spec.draft.json',
    'docs/echo-forge/claude/gemini-asset-request.draft.json',
    'docs/echo-forge/claude/prototype/',
    'docs/echo-forge/claude/motion-spec.v1.json',
    'docs/echo-forge/claude/gemini-asset-request.v1.json'
  ]) assert.match(brief, new RegExp(requiredPath.replaceAll('/', '\\/')), `Claude path: ${requiredPath}`);
  for (const clause of [
    'three', 'HD pixel-art', 'illustrated 2D cutout', 'minimal luminous training arena',
    'responsive', 'accessibility', 'reduced-motion', 'static', 'motion', 'Gemini',
    'written approval', 'untrusted', 'filenames', 'backend contract', '44', 'WCAG'
  ]) assert.match(brief, new RegExp(clause, 'i'), `Claude clause: ${clause}`);
  assert.match(brief, /technical failures.*neutral|neutral.*technical failures/i);
  assert.match(brief, /analysisHold/i);
  assert.match(brief, /unique immutable assetId|assetId.*unique|unique.*assetId/i);
});

test('Gemini brief assigns staged reproducible asset generation after timing gates', () => {
  const brief = readText(GEMINI_PATH);
  for (const requiredPath of [
    'docs/echo-forge/gemini/character-reference-sheets/',
    'docs/echo-forge/gemini/static-poses/',
    'docs/echo-forge/gemini/icon-concepts/',
    'docs/echo-forge/gemini/effect-concepts/',
    'docs/echo-forge/gemini/prompt-log.jsonl',
    'docs/echo-forge/gemini/asset-manifest.draft.json',
    'public/assets/echo-forge/v1/',
    'docs/echo-forge/gemini/asset-manifest.v1.json',
    'docs/echo-forge/gemini/production-report.md'
  ]) assert.match(brief, new RegExp(requiredPath.replaceAll('/', '\\/')), `Gemini path: ${requiredPath}`);
  for (const clause of [
    'Stage A', 'Stage B', 'static', 'timing', 'motion specification', 'reproduc',
    'model', 'prompt', 'negative prompt', 'content hash', 'provenance', 'licens',
    'seed', 'unavailable', 'untrusted', 'filenames', 'backend contract', 'executable',
    'immutable asset ID', 'transparent'
  ]) assert.match(brief, new RegExp(clause, 'i'), `Gemini clause: ${clause}`);
  assert.match(brief, /transparent-background|alpha exports?/i);
  assert.match(brief, /13-field visual slot record/i);
  assert.match(brief, /provenance sidecar/i);
  assert.match(brief, /sidecar keyed by assetId/i);
  assert.match(brief, /Schema-bound visual slot record \(13 fields\)/i);
  assert.match(brief, /Provenance sidecar \(keyed by assetId\)/i);
  assert.match(brief, /visual-slot-example/i);
  assert.match(brief, /provenance-sidecar-example/i);
  assert.match(brief, /visual slot record.*validat/i);
  assert.match(brief, /provenance sidecar.*validat/i);
  assert.match(brief, /final.*animated|animated.*final/i);
  assert.match(brief, /after.*timing|timing.*gate/i);
  assert.match(brief, /unique immutable assetId|assetId.*unique|unique.*assetId/i);
});
