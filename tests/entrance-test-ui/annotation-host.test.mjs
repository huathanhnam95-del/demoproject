import test from 'node:test';
import assert from 'node:assert/strict';
import { canSaveText } from '../../public/js/crm/entrance-test-ui/annotations-controller.js';
test('comment validation preserves plain Unicode text and rejects blank or oversized text',()=>{assert.equal(canSaveText('Tiếng Việt: tôi muốn sửa phần này.'),true);assert.equal(canSaveText(' \n\t'),false);assert.equal(canSaveText('x'.repeat(2001)),false);assert.equal(canSaveText('<script>alert(1)</script>'),true);});
