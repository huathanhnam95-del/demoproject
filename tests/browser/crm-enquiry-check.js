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
    console.log('\n[Test 1] New Lead form fields (DOM structure)');
    
    const expectedFields = [
        { id: 'lead-source', label: 'Source' },
        { id: 'lead-name', label: 'Full Name' },
        { id: 'lead-label', label: 'Label' },
        { id: 'lead-phone', label: 'Phone Number' },
        { id: 'lead-email', label: 'Email' },
        { id: 'lead-zalo', label: 'Zalo Number' },
        { id: 'lead-facebook', label: 'Facebook Name' },
        { id: 'lead-facebook-profile-url', label: "Student's FB link" },
        { id: 'lead-facebook-personal-owner', label: 'FB Personal Account' },
        { id: 'lead-agent-source', label: 'Agent Source' },
        { id: 'lead-stage', label: 'Stage' },
        { id: 'lead-probability', label: 'Probability' }
    ];
    
    for (const field of expectedFields) {
        const exists = await page.$(`#${field.id}`) !== null;
        assert(`Field "${field.label}" (${field.id}) exists`, exists);
    }

    // Verify field order inside lead-composer
    const fieldOrder = await page.evaluate(() => {
        const composer = document.getElementById('lead-composer');
        if (!composer) return [];
        const inputs = composer.querySelectorAll('input, select');
        return Array.from(inputs).map(el => el.id);
    });
    
    const expectedOrder = ['lead-source', 'lead-salutation-mr', 'lead-salutation-ms', 'lead-name', 'lead-label', 'lead-phone', 'lead-email', 'lead-zalo', 'lead-facebook', 'lead-facebook-profile-url', 'lead-facebook-personal-owner', 'lead-agent-source', 'lead-stage', 'lead-probability'];
    assert('Form fields are in correct order', JSON.stringify(fieldOrder) === JSON.stringify(expectedOrder));

    // ===== Test 2: Workspace section IDs =====
    console.log('\n[Test 2] Workspace section IDs');
    
    const sectionIds = [
        { id: 'lead-task-section', label: 'Task section' },
        { id: 'lead-activity-section', label: 'Activity section' },
        { id: 'lead-entrance-test-section', label: 'Entrance test section' },
        { id: 'lead-templates-automations', label: 'Templates & automations grid' }
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
    assert('lead-workspace.js hides leadTemplatesAutomations', leadWorkspaceJs.includes("elements.leadTemplatesAutomations") && leadWorkspaceJs.includes("display = 'none'"));
    
    assert('crm-admin.js binds leadTaskSection', crmAdminJs.includes("elements.leadTaskSection = document.getElementById('lead-task-section')"));
    assert('crm-admin.js binds leadActivitySection', crmAdminJs.includes("elements.leadActivitySection = document.getElementById('lead-activity-section')"));
    assert('crm-admin.js binds leadTemplatesAutomations', crmAdminJs.includes("elements.leadTemplatesAutomations = document.getElementById('lead-templates-automations')"));
    assert('crm-admin.js binds inputLeadLabel', crmAdminJs.includes("elements.inputLeadLabel = document.getElementById('lead-label')"));
    assert('crm-admin.js binds inputLeadZalo', crmAdminJs.includes("elements.inputLeadZalo = document.getElementById('lead-zalo')"));
    assert('crm-admin.js binds inputLeadFacebook', crmAdminJs.includes("elements.inputLeadFacebook = document.getElementById('lead-facebook')"));
    
    // Fallback refresh also hides sections
    assert('crm-admin.js fallback hides taskSection', crmAdminJs.includes("elements.leadTaskSection") && crmAdminJs.includes("display = 'none'"));

    // ===== Test 4: Ghost field cleanup =====
    console.log('\n[Test 4] Ghost field references cleaned');
    
    const leadsJs = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'crm', 'leads.js'), 'utf8');
    
    assert('leads.js uses inputLeadFacebookProfileUrl', leadsJs.includes('inputLeadFacebookProfileUrl'));
    assert('leads.js uses inputLeadFacebook', leadsJs.includes('inputLeadFacebook'));
    assert('leads.js uses inputLeadLabel', leadsJs.includes('inputLeadLabel'));
    assert('leads.js uses inputLeadZalo', leadsJs.includes('inputLeadZalo'));
    
    assert('lead-workspace.js no longer references inputLeadFacebookDisplayName', !leadWorkspaceJs.includes('inputLeadFacebookDisplayName'));
    assert('lead-workspace.js no longer references inputLeadMessengerStatus', !leadWorkspaceJs.includes('inputLeadMessengerStatus'));
    assert('lead-workspace.js uses inputLeadLabel', leadWorkspaceJs.includes('inputLeadLabel'));
    assert('lead-workspace.js uses inputLeadZalo', leadWorkspaceJs.includes('inputLeadZalo'));
    assert('lead-workspace.js uses inputLeadFacebook', leadWorkspaceJs.includes('inputLeadFacebook'));

    // Summary
    console.log(`\n---\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    console.log(failed === 0 ? '--- CRM Enquiry Verification PASSED ---' : '--- CRM Enquiry Verification FAILED ---');

    await browser.close();
    server.close();
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
