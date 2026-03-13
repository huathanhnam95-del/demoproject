const { chromium } = require('playwright');

async function assertProductHeader(page, expectedActiveLabel) {
  const header = page.locator('[data-site-header]');
  await header.waitFor({ state: 'visible', timeout: 3000 });

  const labels = ['Home', 'Practice', 'About Us'];
  for (const label of labels) {
    await header.getByRole('link', { name: label, exact: true }).waitFor({ state: 'visible', timeout: 3000 });
  }

  const activeLink = header.locator('[aria-current="page"]');
  await activeLink.waitFor({ state: 'visible', timeout: 3000 });

  const activeText = (await activeLink.innerText()).trim();
  if (activeText !== expectedActiveLabel) {
    throw new Error(`Expected active header link "${expectedActiveLabel}", got "${activeText}"`);
  }
}

async function assertSectionHeading(page, headingText) {
  await page.getByRole('heading', { name: headingText }).waitFor({ state: 'visible', timeout: 3000 });
}

async function assertHeaderFitsViewport(page) {
  const header = page.locator('[data-site-header]');
  const box = await header.boundingBox();
  const viewport = page.viewportSize();

  if (!box || !viewport) {
    throw new Error('Unable to read header bounds for viewport assertion.');
  }

  if (box.x < 0 || box.x + box.width > viewport.width + 1) {
    throw new Error(`Header overflows viewport. x=${box.x}, width=${box.width}, viewport=${viewport.width}`);
  }
}

async function getHeaderMetrics(page) {
  return page.evaluate(() => {
    const header = document.querySelector('[data-site-header]');
    const nav = header?.querySelector('.site-header__links');
    const firstLink = header?.querySelector('.site-header__link');

    if (!header || !nav || !firstLink) {
      throw new Error('Unable to collect header metrics.');
    }

    return {
      headerHeight: Math.round(header.getBoundingClientRect().height),
      navHeight: Math.round(nav.getBoundingClientRect().height),
      linkHeight: Math.round(firstLink.getBoundingClientRect().height)
    };
  });
}

function assertMatchingHeaderMetrics(referenceLabel, referenceMetrics, targetLabel, targetMetrics) {
  for (const key of ['headerHeight', 'navHeight', 'linkHeight']) {
    if (referenceMetrics[key] !== targetMetrics[key]) {
      throw new Error(
        `${targetLabel} ${key} (${targetMetrics[key]}) does not match ${referenceLabel} ${key} (${referenceMetrics[key]}).`
      );
    }
  }
}

async function runDesktopChecks(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
  const page = await context.newPage();

  await page.goto('http://127.0.0.1:4173/landing/en/index.html', { waitUntil: 'domcontentloaded' });
  await assertProductHeader(page, 'Home');
  const homeHeaderMetrics = await getHeaderMetrics(page);

  await page.goto('http://127.0.0.1:4173/index.html', { waitUntil: 'domcontentloaded' });
  await assertProductHeader(page, 'Practice');
  const practiceHeaderMetrics = await getHeaderMetrics(page);
  assertMatchingHeaderMetrics('Home', homeHeaderMetrics, 'Practice', practiceHeaderMetrics);

  await page.goto('http://127.0.0.1:4173/about/index.html', { waitUntil: 'domcontentloaded' });
  await assertProductHeader(page, 'About Us');
  const aboutHeaderMetrics = await getHeaderMetrics(page);
  assertMatchingHeaderMetrics('Home', homeHeaderMetrics, 'About', aboutHeaderMetrics);
  await assertSectionHeading(page, 'Mission');
  await assertSectionHeading(page, 'Problem');
  await assertSectionHeading(page, 'What BEL Builds');
  await assertSectionHeading(page, 'Who We Serve');
  await assertSectionHeading(page, 'Why BEL Matters');
  await assertSectionHeading(page, 'Team and Execution');
  await page.locator('a[href="/funding/"]').first().waitFor({ state: 'visible', timeout: 3000 });

  await page.goto('http://127.0.0.1:4173/funding/index.html', { waitUntil: 'domcontentloaded' });
  await assertProductHeader(page, 'About Us');
  await assertSectionHeading(page, 'Funding & Support for BEL');
  await assertSectionHeading(page, 'Product Snapshot');
  await assertSectionHeading(page, 'Problem');
  await assertSectionHeading(page, 'Product Today');
  await assertSectionHeading(page, 'Why Support Matters Now');
  await assertSectionHeading(page, 'Planned Use of Support');
  await assertSectionHeading(page, 'Why BEL Fits Startup Programs');
  await assertSectionHeading(page, 'Team and Execution');

  await page.screenshot({ path: 'tmp/site-header-about-check.png', fullPage: true });
  await context.close();
}

async function runMobileChecks(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  await page.goto('http://127.0.0.1:4173/landing/en/index.html', { waitUntil: 'domcontentloaded' });
  await assertProductHeader(page, 'Home');
  await assertHeaderFitsViewport(page);

  await page.goto('http://127.0.0.1:4173/about/index.html', { waitUntil: 'domcontentloaded' });
  await assertProductHeader(page, 'About Us');
  await assertHeaderFitsViewport(page);

  await context.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    await runDesktopChecks(browser);
    await runMobileChecks(browser);
    console.log('Site header and About page verification complete.');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
