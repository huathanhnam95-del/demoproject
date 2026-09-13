'use strict';

const { chromium } = require('playwright');

const CHROME_CHANNEL = 'chrome';

/**
 * Launch the installed Google Chrome channel for candidate evidence.
 * This helper intentionally has no bundled-Chromium fallback.
 */
async function launchPracticeChrome(options = {}) {
  const { channel: _ignoredChannel, ...launchOptions } = options;
  try {
    const browser = await chromium.launch({
      ...launchOptions,
      channel: CHROME_CHANNEL,
      headless: launchOptions.headless ?? true
    });
    console.log(`[practice-chrome] Chrome ${browser.version()}`);
    return browser;
  } catch (error) {
    throw new Error(
      `Google Chrome channel is required for practice UI checks and could not be launched: ${error.message}`
    );
  }
}

module.exports = { CHROME_CHANNEL, launchPracticeChrome };
