/**
 * CRM Enquiry page verification — checks DOM structure only (no auth needed)
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 4488;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

async function main() {
    const server = http.createServer((req, res) => {
        let urlPath = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
        if (urlPath === '/') urlPath = '/index.html';
        const filePath = path.join(__dirname, '..', '..', 'public', urlPath);
        if (!fs.existsSync(filePath)) { res.writeHead(404); res.end(); return; }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
    });
    await new Promise(r => server.listen(PORT, r));

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    // Suppress external resource errors (Firebase, Google Fonts)
    const jsErrors = [];
    page.on('pageerror', e => {
        if (!e.message.includes('firebase') && !e.message.includes('Firebase') && !e.message.includes('auth')) {
            jsErrors.push(e.message);
        }
    });

    await page.goto(`http://localhost:${PORT}/crm-admin.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000); // Let scripts initialize

    let passed = 0;
    let failed = 0;
    function assert(label, condition) {
        if (condition) { console.log(`  ✓ ${label}`); passed++; }
        else { console.log(`  ✗ ${label}`); failed++; }
    }

    // ===== Test 1: New Lead Form Fields =====
    console.log('\n[Test 1] New Lead form fields (DOM structure & 2-column layout)');
    
    const expectedFields = [
        { id: 'lead-name', label: 'Full Name' },
        { id: 'lead-phone', label: 'Phone/Zalo number' },
        { id: 'lead-email', label: 'Email' },
        { id: 'lead-facebook', label: 'Social Media Account Name' },
        { id: 'lead-source', label: 'Source' },
        { id: 'lead-facebook-personal-owner', label: 'Source Account' }
    ];
    
    for (const field of expectedFields) {
        const exists = await page.$(`#${field.id}`) !== null;
        assert(`Field "${field.label}" (${field.id}) exists`, exists);
    }

    // Verify removed fields
    assert('Field "Label" (lead-label) is removed', await page.$('#lead-label') === null);
    assert('Field "Stage" (lead-stage) is removed from composer', await page.$('#lead-composer #lead-stage') === null);
    assert('Field "Probability" (lead-probability) is removed', await page.$('#lead-probability') === null);
    assert('Next Actions & Timeline panels (student-activity-hub) are removed', await page.$('#student-activity-hub') === null);

    // Verify field order inside lead-composer
    const fieldOrder = await page.evaluate(() => {
        const composer = document.getElementById('lead-composer');
        if (!composer) return [];
        const inputs = composer.querySelectorAll('input, select');
        return Array.from(inputs).map(el => el.id);
    });
    
    const expectedOrder = ['lead-salutation-mr', 'lead-salutation-ms', 'lead-name', 'lead-phone', 'lead-email', 'lead-facebook', 'lead-source', 'lead-facebook-personal-owner'];
    assert('Form fields are in correct 2-column order', JSON.stringify(fieldOrder) === JSON.stringify(expectedOrder));

    // Verify Source Account blank default and required
    const ownerValue = await page.$eval('#lead-facebook-personal-owner', el => el.value);
    const ownerRequired = await page.$eval('#lead-facebook-personal-owner', el => el.required);
    assert('Source Account is blank by default', ownerValue === '');
    assert('Source Account requires input (required)', ownerRequired === true);

    // ===== Test 2: Workspace section IDs =====
    console.log('\n[Test 2] Workspace section IDs');
    
    const sectionIds = [
        { id: 'lead-task-section', label: 'Task section' },
        { id: 'lead-activity-section', label: 'Activity section' },
        { id: 'lead-entrance-test-section', label: 'Entrance test section' },
    ];
    
    for (const section of sectionIds) {
        const exists = await page.$(`#${section.id}`) !== null;
        assert(`${section.label} has ID`, exists);
    }

    // ===== Test 3: Section hiding logic (JS code audit) =====
    console.log('\n[Test 3] Section hiding logic in JS');
    
    const leadWorkspaceJs = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'crm', 'lead-workspace.js'), 'utf8');
    const crmAdminJs = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'crm-admin.js'), 'utf8');
    
    assert('lead-workspace.js hides leadTaskSection', leadWorkspaceJs.includes("elements.leadTaskSection") && leadWorkspaceJs.includes("display = 'none'"));
    assert('lead-workspace.js hides leadActivitySection', leadWorkspaceJs.includes("elements.leadActivitySection") && leadWorkspaceJs.includes("display = 'none'"));
    assert('crm-admin.js binds leadTaskSection', crmAdminJs.includes("elements.leadTaskSection = document.getElementById('lead-task-section')"));
    assert('crm-admin.js binds leadActivitySection', crmAdminJs.includes("elements.leadActivitySection = document.getElementById('lead-activity-section')"));
    assert('crm-admin.js binds inputLeadPhone', crmAdminJs.includes("elements.inputLeadPhone = document.getElementById('lead-phone')"));
    assert('crm-admin.js binds inputLeadFacebook', crmAdminJs.includes("elements.inputLeadFacebook = document.getElementById('lead-facebook')"));
    assert('crm-admin.js binds inputLeadFacebookPersonalOwner', crmAdminJs.includes("elements.inputLeadFacebookPersonalOwner = document.getElementById('lead-facebook-personal-owner')"));
    
    // Fallback refresh also hides sections
    assert('crm-admin.js fallback hides taskSection', crmAdminJs.includes("elements.leadTaskSection") && crmAdminJs.includes("display = 'none'"));

    // ===== Test 4: Ghost field cleanup =====
    console.log('\n[Test 4] Ghost field references cleaned');
    
    const leadsJs = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'crm', 'leads.js'), 'utf8');
    
    assert('leads.js uses inputLeadFacebook', leadsJs.includes('inputLeadFacebook'));
    assert('lead-workspace.js no longer references inputLeadFacebookDisplayName', !leadWorkspaceJs.includes('inputLeadFacebookDisplayName'));
    assert('lead-workspace.js no longer references inputLeadMessengerStatus', !leadWorkspaceJs.includes('inputLeadMessengerStatus'));
    assert('lead-workspace.js uses inputLeadFacebook', leadWorkspaceJs.includes('inputLeadFacebook'));

    // Summary
    console.log(`\n---\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    console.log(failed === 0 ? '--- CRM Enquiry Verification PASSED ---' : '--- CRM Enquiry Verification FAILED ---');

    await browser.close();
    server.close();
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
