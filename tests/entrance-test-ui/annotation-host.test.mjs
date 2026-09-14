import test from 'node:test';
import assert from 'node:assert/strict';
import { canSaveText, shouldShowAnnotationMarks } from '../../public/js/crm/entrance-test-ui/annotations-controller.js';
test('comment validation preserves plain Unicode text and rejects blank or oversized text',()=>{assert.equal(canSaveText('Tiếng Việt: tôi muốn sửa phần này.'),true);assert.equal(canSaveText(' \n\t'),false);assert.equal(canSaveText('x'.repeat(2001)),false);assert.equal(canSaveText('<script>alert(1)</script>'),true);});
test('review mode reveals feedback regions without changing the explicit marks preference',()=>{
 assert.equal(shouldShowAnnotationMarks(false,true),true);
 assert.equal(shouldShowAnnotationMarks(false,false),false);
 assert.equal(shouldShowAnnotationMarks(true,false),true);
});
