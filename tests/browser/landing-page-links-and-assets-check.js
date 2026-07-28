const { chromium } = require('playwright');

const BASE_URL = process.env.BROWSER_BASE_URL || 'https://localhost:8443';

async function assertLandingIntegrity(page, label) {
  const integrity = await page.evaluate(async () => {
    const invalidInlineStyles = [...document.querySelectorAll('[style]')]
      .map((element) => element.getAttribute('style') || '')
      .filter((style) => /\s-webkit-\s*$/.test(style));
    const cssResponse = await fetch('../landing.css');
    const cssText = await cssResponse.text();
    return {
      invalidInlineStyles,
      cssStatus: cssResponse.status,
      hasNullByte: cssText.includes('\u0000')
    };
  });

  if (integrity.cssStatus !== 200) {
    throw new Error(`${label} landing.css returned HTTP ${integrity.cssStatus}`);
  }
  if (integrity.invalidInlineStyles.length) {
    throw new Error(`${label} contains an invalid inline vendor declaration`);
  }
  if (integrity.hasNullByte) {
    throw new Error(`${label} landing.css contains a NUL byte`);
  }
}

async function assertLinkHref(page, selector, expectedHref, label) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: 'visible', timeout: 3000 });
  const actualHref = await locator.getAttribute('href');

  if (actualHref !== expectedHref) {
    throw new Error(`${label} href mismatch. Expected "${expectedHref}", got "${actualHref}"`);
  }
}

async function assertImagesLoad(page, selector, label) {
  const metrics = await page.locator(selector).evaluateAll((elements) =>
    elements.map((element) => ({
      src: element.getAttribute('src'),
      complete: element.complete,
      naturalWidth: element.naturalWidth
    }))
  );

  if (!metrics.length) {
    throw new Error(`No images found for ${label} using selector "${selector}"`);
  }

  const brokenImage = metrics.find((metric) => !metric.complete || metric.naturalWidth < 1);
  if (brokenImage) {
    throw new Error(`${label} contains a broken image for src "${brokenImage.src}"`);
  }
}

async function runEnglishChecks(browser) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1024 }
  });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/landing/en/index.html`, { waitUntil: 'networkidle' });

  await assertLinkHref(page, '.nav-cta', '../../index.html?demo=1', 'English nav CTA');
  await assertLinkHref(page, '.hero .btn.btn-primary', '../../index.html?demo=1', 'English hero CTA');
  await assertLinkHref(page, '.demo-info .btn.btn-primary', '../../index.html?demo=1', 'English demo CTA');
  await assertLinkHref(page, '.journey-footer .btn.btn-primary', '../../index.html?demo=1', 'English journey CTA');
  await assertLinkHref(page, '.final-cta .btn.btn-white', '../../index.html?demo=1', 'English final CTA');

  await assertImagesLoad(page, '.hero-visual img', 'English hero visual');
  await assertImagesLoad(page, '.demo-visual img', 'English demo visual');
  await assertImagesLoad(page, '.step-visual img', 'English step visuals');
  await assertImagesLoad(page, '.rd-icon-img', 'English roadmap icons');
  await assertLandingIntegrity(page, 'English');

  await context.close();
}

async function runVietnameseChecks(browser) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1024 }
  });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/landing/vi/index.html`, { waitUntil: 'networkidle' });

  await assertLinkHref(page, '.nav-cta', '../../index.html?demo=1', 'Vietnamese nav CTA');
  await assertLinkHref(page, '.hero .btn.btn-primary', '../../index.html?demo=1', 'Vietnamese hero CTA');
  await assertLinkHref(page, '.demo-info .btn.btn-primary', '../../index.html?demo=1', 'Vietnamese demo CTA');
  await assertLinkHref(page, '.journey-footer .btn.btn-primary', '../../index.html?demo=1', 'Vietnamese journey CTA');
  await assertLinkHref(page, '.final-cta .btn.btn-white', '../../index.html?demo=1', 'Vietnamese final CTA');
  await assertLandingIntegrity(page, 'Vietnamese');

  await context.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    await runEnglishChecks(browser);
    await runVietnameseChecks(browser);
    console.log('Landing page CTA and asset verification complete.');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
