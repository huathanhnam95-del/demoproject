const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const js = read('public/js/crm/books-workspace.js');

// Contract assertions
assert(js.includes('function showDownloadSourceModal('), 'books-workspace.js must define showDownloadSourceModal.');
assert(js.includes('id="crm-books-download-all-cb"'), 'Download source modal must include a Download all checkbox.');
assert(js.includes('class="crm-books-source-item-cb"'), 'Download source modal must render individual item checkboxes.');
assert(js.includes('Download Sources'), 'Download modal header title must be present.');
assert(js.includes('Download ('), 'Modal submit button must display selection count dynamically.');

console.log('crm books download source modal unit tests passed');
