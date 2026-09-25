import test from 'node:test';
import assert from 'node:assert/strict';
import { validContext, validRegion, validMessage, contextFor } from '../../public/js/entrance-test-ui/annotation-model.js';
test('exact question/view context rejects unknown and mismatched groups',()=>{
 assert.equal(validContext(contextFor('question','vocab_q4')),true);
 assert.equal(validContext({page:'vocab',view:'question',questionId:'grammar_q1',componentState:''}),false);
 assert.equal(validContext(contextFor('question','vocab_q99')),false);
});
test('bridge binds exact window, origin, generation, revision and payload',()=>{
 const source={}; const session={nonce:'12345678-1234-1234-1234-123456789abc',generation:2};
 const msg={protocol:'etui:annotations:v1',skin:'d',contentVersion:'entrance_test_36plus_v1',visualRevision:'signal-noto-v2',...session,requestId:'12345678-1234-1234-1234-123456789abd',type:'set-mode',payload:{mode:'draw'}};
 const event={source,origin:'http://localhost',data:msg};
 assert.equal(validMessage(event,{source,origin:event.origin,...session}),true);
 for(const patch of [{source:{}},{origin:'https://evil.test'},{data:{...msg,generation:1}},{data:{...msg,extra:true}},{data:{...msg,payload:{mode:'eval'}}}]) assert.equal(validMessage({...event,...patch},{source,origin:event.origin,...session}),false);
});
test('region bounds reject nonfinite geometry and excess/unknown fragments',()=>{
 const region={kind:'content',fragments:{f0:{kind:'element',targetId:'intro/title',rect:{x0:0,y0:0,x1:1,y1:1},text:null}},layoutSignature:'en:100',label:'Title'};
 assert.equal(validRegion(region),true);
 for(const value of [NaN,Infinity,-1,2]) assert.equal(validRegion({...region,fragments:{f0:{...region.fragments.f0,rect:{...region.fragments.f0.rect,x0:value}}}}),false);
 assert.equal(validRegion({...region,fragments:{...region.fragments,f8:region.fragments.f0}}),false);
});
