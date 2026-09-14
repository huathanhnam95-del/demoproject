import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';
import {GROUPS,VOICES} from '../../public/prototypes/bel-working-as-equals-demo/content/source.mjs';
const manifest=JSON.parse(fs.readFileSync(new URL('../../public/prototypes/bel-working-as-equals-demo/presentation/source-manifest.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
test('native and approved-art input bytes match declared source provenance',()=>{for(const f of manifest.inputs)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(f.path)).digest('hex'),f.sha256,f.url);});
test('only approved presentation bindings and exact five portrait/source identities',()=>{
  assert.deepEqual(GROUPS,{A:[1,3],C:[4,9],E:[10,16],G:[17,18],I:[19,20],J:[21,21]});
  const html=fs.readFileSync(manifest.inputs.find(f=>f.url==='/native/deck.html').path,'utf8');
  VOICES.forEach((name,i)=>assert(html.includes(`data-label="${name}" data-screen-label="${i+10}"`)));
  for(const name of ['nextPhase','nextH4','nextH5','nextH6','showQuotes','showFolio','photoTreatment'])assert(html.includes(name));
});
test('the nine independently transcribed route passages match the canonical HTML',()=>{
  const expected=JSON.parse(fs.readFileSync(new URL('../fixtures/bel-demo/expected-content.json',import.meta.url),'utf8'));
  const html=fs.readFileSync(manifest.inputs.find(f=>f.url==='/native/deck.html').path,'utf8');
  const text=s=>s.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
  for(const [index,route]of ['B1','B2','B3'].entries()){
    const section=html.match(new RegExp(`<section[^>]*data-screen-label="0${index+4}"[\\s\\S]*?<\\/section>`))[0];
    const paragraphs=[...section.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].slice(0,3).map(m=>text(m[1]));assert.deepEqual(paragraphs,expected[route]);
  }
});
