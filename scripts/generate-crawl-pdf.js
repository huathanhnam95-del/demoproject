#!/usr/bin/env node
/**
 * generate-crawl-pdf.js
 * ----------------------
 * Reads the latest crawl-output JSON and generates a styled PDF digest.
 * Output: tmp/tax-digest-YYYY-MM-DD.pdf
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

// ── Config ──────────────────────────────────────────────────────────
const TMP_DIR = path.join(__dirname, '..', 'tmp');

// Brand colors
const COLORS = {
  primary: '#1a365d',    // Deep navy
  secondary: '#2b6cb0',  // Blue
  accent: '#ed8936',     // Orange
  text: '#2d3748',       // Dark gray
  muted: '#718096',      // Medium gray
  bg: '#f7fafc',         // Light gray
  white: '#ffffff',
  divider: '#e2e8f0',
};

// ── Helpers ─────────────────────────────────────────────────────────
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Strip emoji characters that Helvetica cannot render.
 * Replaces common ones with text equivalents, then removes any remaining.
 */
function stripEmojis(text) {
  // Common emoji → text replacements
  const replacements = [
    [/📱/g, '[FB]'], [/🔗/g, 'Link:'], [/📰/g, ''],
    [/🤔/g, ''], [/🚨/g, '!!'], [/🚩/g, '>'],
    [/💰/g, '$'], [/🌍/g, ''], [/👇/g, ''],
    [/➡️/g, '->'], [/✅/g, ''], [/❌/g, ''],
    [/📂/g, ''], [/📄/g, ''], [/📁/g, ''],
    [/🤯/g, ''], [/🎯/g, ''],
  ];
  let result = text;
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }
  // Strip any remaining emoji / symbol Unicode ranges
  // Covers Emoticons, Dingbats, Symbols, Supplemental Symbols, Flags, etc.
  result = result.replace(/[\u{1F600}-\u{1F64F}]/gu, '');
  result = result.replace(/[\u{1F300}-\u{1F5FF}]/gu, '');
  result = result.replace(/[\u{1F680}-\u{1F6FF}]/gu, '');
  result = result.replace(/[\u{1F900}-\u{1F9FF}]/gu, '');
  result = result.replace(/[\u{1FA00}-\u{1FA6F}]/gu, '');
  result = result.replace(/[\u{1FA70}-\u{1FAFF}]/gu, '');
  result = result.replace(/[\u{2600}-\u{26FF}]/gu, '');
  result = result.replace(/[\u{2700}-\u{27BF}]/gu, '');
  result = result.replace(/[\u{FE00}-\u{FE0F}]/gu, '');  // Variation selectors
  result = result.replace(/[\u{200D}]/gu, '');             // Zero-width joiner
  result = result.replace(/[\u{20E3}]/gu, '');             // Combining enclosing keycap
  // Clean up double spaces left behind
  result = result.replace(/  +/g, ' ').trim();
  return result;
}

function findLatestCrawlOutput() {
  const files = fs.readdirSync(TMP_DIR)
    .filter((f) => f.startsWith('crawl-output-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    console.error('❌ No crawl output found in tmp/. Run crawl-tax-news.js first.');
    process.exit(1);
  }

  return path.join(TMP_DIR, files[0]);
}

function wrapText(doc, text, options = {}) {
  const { x = doc.x, width = 470, fontSize = 10, font = 'Helvetica', color = COLORS.text } = options;
  doc.font(font).fontSize(fontSize).fillColor(color);
  doc.text(text, x, undefined, { width, lineGap: 3 });
}

// ── PDF Generation ──────────────────────────────────────────────────
function generatePDF(data) {
  const outFile = path.join(TMP_DIR, `tax-digest-${today()}.pdf`);

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 60, bottom: 60, left: 60, right: 60 },
    info: {
      Title: `Tax News Digest — ${data.date}`,
      Author: 'Accountants Daily Crawler',
      Subject: 'Daily Tax Compliance News Summary',
    },
  });

  const stream = fs.createWriteStream(outFile);
  doc.pipe(stream);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // ── Header ──
  // Top accent bar
  doc.rect(0, 0, doc.page.width, 8).fill(COLORS.accent);

  doc.moveDown(1);

  // Title
  doc.font('Helvetica-Bold').fontSize(26).fillColor(COLORS.primary);
  doc.text('Daily Tax News Digest', { align: 'center' });

  doc.moveDown(0.3);

  // Subtitle / date
  doc.font('Helvetica').fontSize(11).fillColor(COLORS.muted);
  doc.text(`${data.date}  •  Source: accountantsdaily.com.au`, { align: 'center' });

  doc.moveDown(0.3);

  // Divider
  const divY = doc.y;
  doc.moveTo(60, divY).lineTo(doc.page.width - 60, divY).strokeColor(COLORS.divider).lineWidth(1).stroke();

  doc.moveDown(1);

  // ── Articles ──
  data.articles.forEach((article, index) => {
    // Check if we need a new page (leave room for at least the title + some text)
    if (doc.y > doc.page.height - 200) {
      doc.addPage();
      // Accent bar on new pages too
      doc.rect(0, 0, doc.page.width, 4).fill(COLORS.accent);
      doc.y = 60;
    }

    // Article number badge
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.white);
    const badgeY = doc.y;
    doc.roundedRect(60, badgeY, 24, 20, 4).fill(COLORS.secondary);
    doc.fillColor(COLORS.white).text(`${index + 1}`, 60, badgeY + 4, { width: 24, align: 'center' });

    // Title
    doc.fillColor(COLORS.primary).font('Helvetica-Bold').fontSize(14);
    doc.text(article.title, 92, badgeY, { width: pageWidth - 32 });

    doc.moveDown(0.2);

    // Meta line (author + date)
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(COLORS.muted);
    doc.text(`By ${article.author}  •  ${article.date}`, 92, undefined, { width: pageWidth - 32 });

    doc.moveDown(0.5);

    // Facebook post box
    const boxStartY = doc.y;
    const summaryX = 70;
    const summaryWidth = pageWidth - 20;

    // We need to measure the text height first to draw the box
    // Clean emojis from summary for PDF rendering
    const cleanSummary = stripEmojis(article.summary);
    const textHeight = doc.heightOfString(cleanSummary, { width: summaryWidth - 20, lineGap: 3 });
    const boxHeight = textHeight + 24;

    // Background box
    doc.roundedRect(summaryX, boxStartY, summaryWidth, boxHeight, 6)
      .fillOpacity(0.05).fill(COLORS.secondary);
    doc.fillOpacity(1);

    // Left accent bar on the box
    doc.roundedRect(summaryX, boxStartY, 3, boxHeight, 1.5).fill(COLORS.accent);

    // "FACEBOOK POST" label
    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.accent);
    doc.text('FACEBOOK POST', summaryX + 12, boxStartY + 6, { width: summaryWidth - 24 });

    // Summary text (emoji-stripped)
    doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.text);
    doc.text(cleanSummary, summaryX + 12, boxStartY + 18, {
      width: summaryWidth - 24,
      lineGap: 3,
    });

    doc.y = boxStartY + boxHeight + 4;

    // Source URL
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.secondary);
    doc.text(`Link: ${article.url}`, summaryX, undefined, {
      width: summaryWidth,
      link: article.url,
      underline: true,
    });

    doc.moveDown(0.8);

    // Divider between articles (except last)
    if (index < data.articles.length - 1) {
      const lineY = doc.y;
      doc.moveTo(80, lineY).lineTo(doc.page.width - 80, lineY)
        .strokeColor(COLORS.divider).lineWidth(0.5).dash(3, { space: 3 }).stroke().undash();
      doc.moveDown(0.8);
    }
  });

  // ── Footer ──
  const footerY = doc.page.height - 40;
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted);
  doc.text(
    `Generated on ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })} • Powered by Gemini AI`,
    60,
    footerY,
    { width: pageWidth, align: 'center' }
  );

  // Bottom accent bar
  doc.rect(0, doc.page.height - 6, doc.page.width, 6).fill(COLORS.accent);

  doc.end();

  return new Promise((resolve) => {
    stream.on('finish', () => {
      console.log(`✅ PDF saved to ${outFile}`);
      resolve(outFile);
    });
  });
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('━'.repeat(60));
  console.log('📄 Tax Digest PDF Generator');
  console.log('━'.repeat(60));

  const inputFile = findLatestCrawlOutput();
  console.log(`📂 Using: ${path.basename(inputFile)}`);

  const data = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
  console.log(`📰 ${data.articles.length} articles to render`);

  const pdf = await generatePDF(data);
  console.log('━'.repeat(60));
  console.log(`📁 Open the PDF: ${pdf}`);
}

main().catch((err) => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
