const { chromium } = require('playwright');

async function main() {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent(`
      <html>
        <head>
          <style>
            .crm-result-pdf-question-unified {
              page-break-inside: avoid;
              break-inside: avoid;
              border-bottom: 2px dashed #edf2f7;
            }
            .content {
              font-size: 24px;
              line-height: 1.6;
            }
          </style>
        </head>
        <body>
          <div id="test-question" class="crm-result-pdf-question-unified">
            <div class="content">
              ${'Extremely long text to force overflow and test page break rules. '.repeat(200)}
            </div>
          </div>
        </body>
      </html>
    `);

        // Check height of the question
        const height = await page.$eval('#test-question', el => el.getBoundingClientRect().height);
        console.log('Height of block:', height);
        if (height > 1584) {
            console.log('RISK 1 CONFIRMED: A single unified question block can exceed the height of a single PDF page (1584px).');
            console.log('If page-break-inside: avoid is set, the PDF renderer might not be able to paginate it cleanly if the single block exceeds the page height bounds.');
        } else {
            console.log('Block fits within page.');
        }
    } catch (error) {
        console.error(error);
    } finally {
        await browser.close();
    }
}
main();
