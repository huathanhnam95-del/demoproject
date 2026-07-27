const assert = require('node:assert/strict');
const fs = require('node:fs');

const apiApp = fs.readFileSync('functions/src/apiApp.js', 'utf8');
const routes = fs.readFileSync('functions/src/essay-ai/admin-routes.js', 'utf8');
const html = fs.readFileSync('public/crm-admin.html', 'utf8');
const js = fs.readFileSync('public/crm-admin.js', 'utf8');
const dashboardWorkspace = fs.readFileSync('public/js/crm/dashboard-workspace.js', 'utf8');

assert.match(apiApp, /createEssayAiAdminRouter/);
assert.match(apiApp, /app\.use\('\/api\/admin\/essay-ai', essayAiAdminRouter\)/);
assert.match(routes, /router\.post\('\/preview'/);
assert.match(routes, /router\.post\('\/trigger'/);
assert.match(routes, /where\('status', '==', 'pending'\)/);
assert.match(html, /id="btn-essay-ai-trigger"/);
assert.match(html, /id="btn-essay-ai-preview"/);
assert.match(js, /dashboardController\?\.activate/);
assert.match(js, /dashboardController\?\.dispose/);
assert.match(dashboardWorkspace, /startEssayAiPreview/);
assert.match(dashboardWorkspace, /triggerEssayAiBackfill/);

console.log('essay-ai admin contract passed');
