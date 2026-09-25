import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../../public/js/crm/entrance-test-ui-lab.js', import.meta.url), 'utf8');
function host(store) {
 const context = { window: { location: { origin: 'http://localhost' }, addEventListener() {}, firebase: null }, document: { getElementById() { return null; } }, setTimeout, clearTimeout, URL, URLSearchParams, console };
 if (store) { context.firebase = context.window.firebase = { firestore: Object.assign(() => store, { FieldValue: { serverTimestamp: () => 'SERVER' } }) }; }
 vm.runInNewContext(source.replace(/window\.CrmEntranceTestUiLab = \{ boot: boot[^\n]+/,  'window.test = { state, completion, frameUrl, loadRater, scheduleSave, save, SKINS };'), context);
 return context.window.test;
}
test('A through D remain selectable and 160 valid scores gate results with historical fonts', () => {
 const h = host(); assert.equal(h.state.skin, 'b'); assert.deepEqual(Array.from(h.SKINS, s => s.id), ['a','b','c','d']); assert.equal(h.completion().need, 160);
 for (const skin of ['a','b','c','d']) for (const p of ['intro','miccheck','speaking','vocab','grammar','listening','review','done']) for(const c of ['visual','readability','usability','clarity','trust']) h.state.ratings[`${skin}:${p}:${c}`] = 5;
 assert.equal(h.completion().have, 160);
 h.state.fonts = {vn:['legacy'],en:['legacy']}; assert.equal(h.completion().done, true);
 h.state.ratings['d:intro:visual'] = 99; assert.equal(h.completion().done, false);
 h.state.skin = 'd';
 assert.match(h.frameUrl(), /entrance-test-ui/);
});
test('explicit rating transaction preserves historical maps and creation time, including clearing', async () => {
 let data = {name:'Reviewer', ratings:{'a:intro:visual':4,'d:intro:visual':2,'d:review:trust':3}, fonts:{vn:'legacy',en:['old']},createdAt:123};
 const ref = {get:async()=>({exists:true,data:()=>structuredClone(data)})};
 const store = {collection:()=>({doc:()=>ref}),runTransaction:async fn=>fn({get:ref.get,set:(_r,next)=>{data=structuredClone(next);}})};
 const h = host(store); h.state.rater={id:'reviewer',name:'Reviewer'}; await h.loadRater('reviewer');
 const before=structuredClone(data); h.scheduleSave({kind:'rating',key:'d:intro:visual',value:5}); clearTimeout(h.state.saveTimer); await h.save();
 assert.equal(data.ratings['d:intro:visual'],5); assert.equal(data.createdAt,123); assert.deepEqual(data.fonts,before.fonts); assert.equal(data.ratings['a:intro:visual'],4); assert.equal(data.ratings['d:review:trust'],3);
 h.scheduleSave({kind:'rating',key:'d:intro:visual',value:0}); clearTimeout(h.state.saveTimer); await h.save(); assert.equal(Object.hasOwn(data.ratings,'d:intro:visual'),false);
});
test('failed or stale load never unlocks editing', async()=>{
 let reject; const h=host({collection:()=>({doc:()=>({get:()=>new Promise((_,r)=>{reject=r;})})})});
 h.state.rater={id:'one',name:'One'}; const pending=h.loadRater('one'); assert.equal(h.state.loaded,false); h.state.rater={id:'two',name:'Two'}; reject(new Error('offline')); await pending; assert.equal(h.state.loaded,false);
});
