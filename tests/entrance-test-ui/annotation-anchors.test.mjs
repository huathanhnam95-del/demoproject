import test from 'node:test';
import assert from 'node:assert/strict';
import { relativeRect, absoluteRect, fingerprint } from '../../public/js/entrance-test-ui/annotation-anchors.js';
test('local fractions roundtrip in CSS pixels independent of device scale',()=>{
 const target={left:20,top:100,width:240,height:80}; const selected={left:40,top:110,right:200,bottom:160};
 const local=relativeRect(selected,target); const restored=absoluteRect(local,target);
 for(const k of ['left','top','right','bottom']) assert.ok(Math.abs(restored[k]-selected[k])<.00001);
 const moved=absoluteRect(local,{...target,top:0}); assert.equal(moved.top,10);
});
test('text fingerprint detects altered immutable text',()=>{assert.equal(fingerprint('Tiếng Việt'),fingerprint('Tiếng Việt'));assert.notEqual(fingerprint('hello'),fingerprint('Hello'));});
