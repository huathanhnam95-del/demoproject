#!/usr/bin/env node
/**
 * crawl-tax-news.js
 * ------------------
 * Crawls accountantsdaily.com.au/tax-compliance for the top 5 newest articles,
 * fetches each article's full text, then calls Gemini to generate
 * Facebook-post-style summaries. Output: tmp/crawl-output-YYYY-MM-DD.json
 */

require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ── Config ──────────────────────────────────────────────────────────
const LISTING_URL = 'https://www.accountantsdaily.com.au/tax-compliance';
const MAX_ARTICLES = 5;
const RETRY_LIMIT = 2;
const GEMINI_MODEL = 'gemini-2.0-flash';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ── Helpers ─────────────────────────────────────────────────────────
function today() {
  const d = new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function fetchWithRetry(url, retries = RETRY_LIMIT) {
  for (let i = 0; i <= retries; i++) {
    try {
      const { data } = await axios.get(url, {
        headers: { 'User-Agent': USER_AGENT },
        timeout: 15000,
      });
      return data;
    } catch (err) {
      if (i === retries) throw err;
      console.log(`  ⟳ Retry ${i + 1}/${retries} for ${url}`);
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

// ── Step 1: Scrape the listing page ────────────────────────────────
async function scrapeArticleList() {
  console.log('📡 Fetching listing page…');
  const html = await fetchWithRetry(LISTING_URL);
  const $ = cheerio.load(html);

  const articles = [];

  // The site uses article cards — each card has an <a> with the full URL,
  // a title, date text, author, and a short teaser.
  // We'll look for all article links in the main content area.
  $('a[href*="/tax-compliance/"]').each((_, el) => {
    if (articles.length >= MAX_ARTICLES) return false;

    const $a = $(el);
    const href = $a.attr('href');

    // Skip pagination / non-article links
    if (!href || href === LISTING_URL || href.includes('?start=')) return;

    // Build absolute URL
    const url = href.startsWith('http')
      ? href
      : `https://www.accountantsdaily.com.au${href}`;

    // Avoid duplicates
    if (articles.some((a) => a.url === url)) return;

    // Extract text content from the anchor — it contains title, date, author, teaser
    const text = $a.text().replace(/\s+/g, ' ').trim();

    // Try to extract date (pattern: DD Month YYYY)
    const dateMatch = text.match(
      /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i
    );

    // Try to extract author (pattern: "• By Author Name")
    const authorMatch = text.match(/•\s*By\s+(.+?)$/i);

    // The title is typically in an h3 or strong inside the card's heading area.
    // We'll also check parent/sibling h3 elements.
    let title = '';
    const $heading = $a.find('h3, h2, .article-title, strong').first();
    if ($heading.length) {
      title = $heading.text().trim();
    }

    // Fallback: use the first substantive line of anchor text (before the date)
    if (!title) {
      // Often the anchor wraps the whole card; the first meaningful chunk is the title
      const parts = text.split(/\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)/i);
      if (parts[0]) {
        // Remove category prefix like "Tax  "
        title = parts[0].replace(/^\s*Tax\s*/i, '').trim();
        // Take only the first line-like chunk (before the teaser which is usually longer)
        const lines = title.split(/\s{3,}/);
        if (lines.length > 1) title = lines[0].trim();
      }
    }

    if (!title || title.length < 10) return; // skip junk

    articles.push({
      title,
      url,
      date: dateMatch ? dateMatch[1].trim() : 'Unknown',
      author: authorMatch ? authorMatch[1].trim() : 'Staff Writer',
    });
  });

  console.log(`✅ Found ${articles.length} articles`);
  articles.forEach((a, i) => console.log(`   ${i + 1}. ${a.title}`));
  return articles;
}

// ── Step 2: Fetch full article text ────────────────────────────────
async function fetchArticleBody(url) {
  const html = await fetchWithRetry(url);
  const $ = cheerio.load(html);

  // Remove nav, footer, sidebar, ads, scripts, styles
  $('nav, footer, aside, script, style, .ad, .sidebar, .social-share, .related-articles, .comments').remove();

  // Try to find the article body — common selectors
  let body = '';
  const selectors = [
    'article .content',
    '.article-body',
    '.article-content',
    '.item-content',
    '.story-content',
    'article',
    '.main-content',
    '#content',
  ];

  for (const sel of selectors) {
    const $el = $(sel);
    if ($el.length && $el.text().trim().length > 200) {
      body = $el.text().replace(/\s+/g, ' ').trim();
      break;
    }
  }

  // Fallback: use the whole body but strip it down
  if (!body) {
    body = $('body').text().replace(/\s+/g, ' ').trim();
  }

  // Truncate to ~4000 chars to stay within Gemini context limits
  return body.slice(0, 4000);
}

// ── Step 3: Generate Facebook post summary via Gemini ───────────────
async function generateSummary(article, bodyText) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  const prompt = `You are a social media content writer for an accounting news page on Facebook.

Write an engaging Facebook post summarizing this tax news article. The post should:
- Start with a compelling hook line (question or bold statement) with an emoji
- Include 2-3 key takeaways as short bullet points
- End with a call-to-action (e.g., "Read the full story", "What do you think?", "Tag a colleague who needs to see this!")
- Include 3-5 relevant hashtags at the end
- Be under 250 words total
- Use a professional yet approachable tone suitable for accountants and tax professionals

Article Title: ${article.title}
Author: ${article.author}
Date: ${article.date}

Article Content:
${bodyText}

Write ONLY the Facebook post, nothing else.`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('━'.repeat(60));
  console.log('🗞️  Tax News Crawler — ' + today());
  console.log('━'.repeat(60));

  // 1. Scrape listing
  const articles = await scrapeArticleList();
  if (articles.length === 0) {
    console.error('❌ No articles found. Site structure may have changed.');
    process.exit(1);
  }

  // 2. Fetch full text for each article
  console.log('\n📖 Fetching article bodies…');
  for (const article of articles) {
    try {
      console.log(`   → ${article.title.slice(0, 60)}…`);
      article.bodyText = await fetchArticleBody(article.url);
      // Small delay to be polite
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.warn(`   ⚠ Failed to fetch: ${err.message}`);
      article.bodyText = article.title; // fallback to title-only
    }
  }

  // 3. Generate summaries
  console.log('\n🤖 Generating Facebook post summaries via Gemini…');
  for (const article of articles) {
    try {
      console.log(`   → Summarizing: ${article.title.slice(0, 50)}…`);
      article.summary = await generateSummary(article, article.bodyText);
    } catch (err) {
      console.warn(`   ⚠ AI summary failed: ${err.message}`);
      article.summary = `📰 ${article.title}\n\nRead more: ${article.url}\n\n#Tax #Accounting #AustralianTax`;
    }
  }

  // 4. Save output
  const outDir = path.join(__dirname, '..', 'tmp');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, `crawl-output-${today()}.json`);
  const output = {
    date: today(),
    generatedAt: new Date().toISOString(),
    source: LISTING_URL,
    articles: articles.map(({ title, url, date, author, summary }) => ({
      title,
      url,
      date,
      author,
      summary,
    })),
  };

  fs.writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n✅ Output saved to ${outFile}`);
  console.log('━'.repeat(60));
}

main().catch((err) => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
