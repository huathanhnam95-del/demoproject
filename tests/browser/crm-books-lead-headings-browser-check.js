const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.cwd();
const SCREENSHOT_PATH = path.join(ROOT, 'tmp', 'crm-books-lead-headings-browser-check.png');

function installMemoryLocalStorage() {
    const data = new Map();
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key) => data.has(key) ? data.get(key) : null,
            setItem: (key, value) => data.set(key, String(value)),
            removeItem: (key) => data.delete(key)
        }
    });
}

(async () => {
    fs.mkdirSync(path.dirname(SCREENSHOT_PATH), { recursive: true });
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
    const pageErrors = [];

    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.addInitScript(installMemoryLocalStorage);
    await page.setContent(`
      <section class="crm-panel" data-panel="books" style="display:block; width:100%; height:100vh; background:#f4f6f8;">
        <div class="crm-books-workspace" style="height:100%; display:flex;">
          <div class="crm-books-explorer-panel" style="flex:1; overflow-y:auto; padding:24px;">
            <div class="crm-books-detail">
              <div class="crm-books-tab-body">
                <div class="crm-books-page-stage"></div>
              </div>
            </div>
          </div>
        </div>
      </section>
    `);

    await page.addStyleTag({ path: path.join(ROOT, 'public', 'crm-admin.css') });
    await page.addScriptTag({ path: path.join(ROOT, 'public', 'js', 'crm', 'books-workspace.js') });

    // Load actual Harmer page 67 & page 424 texts
    const harmer = JSON.parse(fs.readFileSync(path.join(ROOT, 'tmp', 'harmer_pages.json'), 'utf8'));
    const p67Text = harmer.pages[66];
    const p424Text = harmer.pages[423];

    const results = await page.evaluate(({ p67Text, p424Text }) => {
        const workspace = window.CrmBooksWorkspace;
        const stage = document.querySelector('.crm-books-page-stage');

        // Render Page 67
        const p67Html = workspace.formatPageText(p67Text, (v) => String(v));
        const sheet67 = document.createElement('article');
        sheet67.className = 'crm-books-page-paper crm-books-page-sheet';
        sheet67.innerHTML = `<div class="crm-books-page-content" id="sheet-67">${p67Html}</div>`;
        stage.appendChild(sheet67);

        // Render Page 424
        const p424Html = workspace.formatPageText(p424Text, (v) => String(v));
        const sheet424 = document.createElement('article');
        sheet424.className = 'crm-books-page-paper crm-books-page-sheet';
        sheet424.innerHTML = `<div class="crm-books-page-content" id="sheet-424">${p424Html}</div>`;
        stage.appendChild(sheet424);

        // Query lead terms
        const leadTerms67 = Array.from(sheet67.querySelectorAll('.crm-books-lead-term')).map(el => ({
            text: el.textContent,
            tag: el.tagName,
            color: window.getComputedStyle(el).color,
            fontWeight: window.getComputedStyle(el).fontWeight
        }));

        const leadTerms424 = Array.from(sheet424.querySelectorAll('.crm-books-lead-term')).map(el => ({
            text: el.textContent,
            tag: el.tagName,
            color: window.getComputedStyle(el).color,
            fontWeight: window.getComputedStyle(el).fontWeight
        }));

        return { leadTerms67, leadTerms424 };
    }, { p67Text, p424Text });

    console.log('Page 67 Lead Terms Found:', results.leadTerms67.map(t => t.text));
    console.log('Page 424 Lead Terms Found:', results.leadTerms424.map(t => t.text));

    assert(results.leadTerms67.some(t => t.text === 'Procedure'), 'Procedure must be rendered as .crm-books-lead-term');
    assert(results.leadTerms67.some(t => t.text === 'Technique'), 'Technique must be rendered as .crm-books-lead-term');
    assert(results.leadTerms424.some(t => t.text === 'Multiple-choice questions'), 'Multiple-choice questions must be rendered as .crm-books-lead-term');

    // Verify computed styling
    const procTerm = results.leadTerms67.find(t => t.text === 'Procedure');
    assert.strictEqual(procTerm.tag, 'STRONG');
    assert(parseInt(procTerm.fontWeight, 10) >= 600, 'Lead term font weight must be >= 600');

    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    console.log(`Saved live browser verification screenshot to ${SCREENSHOT_PATH}`);

    assert.strictEqual(pageErrors.length, 0, `Page errors: ${pageErrors.join(', ')}`);
    await browser.close();
    console.log('--- ALL CRM BOOKS LEAD HEADINGS BROWSER CHECKS PASSED ---');
})().catch((err) => {
    console.error('Browser check failed:', err);
    process.exit(1);
});
