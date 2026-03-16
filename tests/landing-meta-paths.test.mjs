import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(repoRoot, 'public');

function readFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function extractMetaContent(html, propertyName) {
  const metaRegex = new RegExp(`<meta[^>]+property=["']${propertyName}["'][^>]+content=["']([^"']+)["']`, 'i');
  const match = html.match(metaRegex);
  return match ? match[1] : null;
}

function assertPublicAssetExists(assetPath, label) {
  assert.ok(assetPath, `${label} must be present`);
  assert.ok(assetPath.startsWith('/'), `${label} must use an absolute /public path`);
  const resolvedPath = path.join(publicRoot, assetPath.replace(/^\//, '').replaceAll('/', path.sep));
  assert.ok(fs.existsSync(resolvedPath), `${label} points to missing asset: ${assetPath}`);
}

function assertLinkExists(html, href, label) {
  assert.match(html, new RegExp(`href=["']${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`), `${label} must link to ${href}`);
}

const landingEnHtml = readFile('public/landing/en/index.html');
const landingViHtml = readFile('public/landing/vi/index.html');
const aboutHtml = readFile('public/about/index.html');

assertPublicAssetExists(extractMetaContent(landingEnHtml, 'og:image'), 'English landing og:image');
assertPublicAssetExists(extractMetaContent(landingViHtml, 'og:image'), 'Vietnamese landing og:image');
assertPublicAssetExists(extractMetaContent(aboutHtml, 'og:image'), 'About page og:image');

assertLinkExists(aboutHtml, '/index.html', 'About page product CTA');
assertLinkExists(aboutHtml, '/landing/en/', 'About page overview CTA');
assertLinkExists(aboutHtml, '/funding/', 'About page funding CTA');

console.log('Landing metadata and About page path verification complete.');
