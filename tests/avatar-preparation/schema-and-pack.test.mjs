import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { validateProject, scriptText, readiness } from '../../tools/avatar_preparation/shared/project-schema.mjs';
const pack = JSON.parse(fs.readFileSync(new URL('../../tools/avatar_preparation/shared/capture-pack.v1.json', import.meta.url), 'utf8'));
const blank = () => ({ schemaVersion: 1, id: crypto.randomUUID(), name: 'Tôi luyện tập', subject: '', revision: 1, assets: [], takes: [], scriptDrafts: {}, selected: {}, checks: {} });
test('The authored pack contains seven photo shots and ten complete bilingual guided sessions', () => {
  assert.equal(pack.scenes.filter(s => s.kind === 'photo').length, 7);
  const spoken = pack.scenes.filter(s => s.kind !== 'photo'); assert.equal(spoken.length, 10);
  for (const s of spoken) for (const lang of ['vi', 'en']) {
    assert.ok(s.cues[lang].length >= 2);
    for (const cue of s.cues[lang]) {
      assert.ok(cue.spokenText.length > 15); assert.doesNotMatch(cue.spokenText, /\[(name|script|insert|pause)|lorem|placeholder/i);
      for (const key of ['emotion', 'expression', 'eyeContact', 'posture', 'head', 'hands', 'instruction']) assert.ok(cue[key], `${s.id}/${lang}: ${key}`);
      assert.ok(cue.intensity >= 1 && cue.intensity <= 5); assert.ok(cue.pauseMs > 0); assert.ok(cue.durationTargetSeconds > 0);
    }
    assert.equal(scriptText(s, lang), s.cues[lang].map(c => c.spokenText).join('\n\n'));
  }
  assert.equal(spoken.find(s => s.id === 'steady').group, 'core'); assert.ok(spoken.filter(s => s.group === 'expression').every(s => !s.core));
});
test('Vietnamese Unicode and line breaks remain exact and readiness never invents completed assets', () => {
  const p = blank(); const words = 'Tôi đã thử.\n\nTiếng Việt: ắ, ề, ự.  Không tự sửa!'; p.scriptDrafts['neutral-voice:vi'] = words;
  assert.equal(validateProject(JSON.parse(JSON.stringify(p))).scriptDrafts['neutral-voice:vi'], words);
  assert.equal(readiness(p, pack).length, 8); assert.ok(readiness(p, pack).every(item => item.done === false));
});
test('Unsupported schemas and traversal paths cannot enter portable projects', () => {
  assert.throws(() => validateProject({ ...blank(), schemaVersion: 99 }), /schema/);
  const p = blank(); const id = crypto.randomUUID(); p.assets = [{ id, role: 'original', mime: 'image/png', size: 10, sha256: '0'.repeat(64), path: '../../private.png' }]; assert.throws(() => validateProject(p), /path/);
});

function referenceProject() {
  const p = blank();
  for (const sceneId of ['steady', 'neutral-voice']) for (const language of ['vi', 'en']) {
    const assetId = crypto.randomUUID(); const id = crypto.randomUUID();
    p.assets.push({ id: assetId, role: 'original', mime: sceneId === 'steady' ? 'video/webm' : 'audio/webm', size: 120, sha256: 'a'.repeat(64), path: `media/${assetId}.webm` });
    p.takes.push({ id, assetId, sceneId, language, label: 'Saved reference', expectedTranscript: 'Bản nháp ban đầu.', actualTranscript: '', transcriptReviewed: false, archived: false, durationMs: 20000 });
    p.selected[`${sceneId}:${language}`] = id;
  }
  return validateProject(p);
}

test('Selected Vietnamese and English video/audio references are ready without transcript review or data mutation', () => {
  const p = referenceProject(); const before = structuredClone(p);
  assert.equal(readiness(p, pack).filter(item => item.done).length, 4);
  assert.deepEqual(p, before);
  assert.ok(p.takes.every(t => !t.transcriptReviewed && t.actualTranscript === ''));
  p.takes[0].actualTranscript = 'Lời nói đã được kiểm tra.\nGiữ nguyên nội dung.'; p.takes[0].transcriptReviewed = true;
  const reviewed = structuredClone(p); assert.equal(readiness(p, pack).filter(item => item.done).length, 4); assert.deepEqual(p, reviewed);
});

test('Missing, archived, unselected or wrong-kind references still do not count ready', () => {
  for (const change of [
    p => { delete p.selected['steady:vi']; },
    p => { p.takes[0].archived = true; },
    p => { p.takes.shift(); },
    p => { p.assets.shift(); },
    p => { p.assets[0].mime = 'audio/webm'; },
    p => { p.selected['steady:vi'] = p.takes[1].id; }
  ]) {
    const p = referenceProject(); change(p);
    assert.equal(readiness(p, pack).find(item => item.label === 'Steady reference video · VI').done, false);
    assert.equal(readiness(p, pack).filter(item => item.done).length, 3);
  }
  const p = referenceProject(); p.takes[0].transcriptReviewed = true;
  assert.throws(() => validateProject(p), /actual transcript/, 'Optional review must never imply a fabricated reviewed transcript');
});
