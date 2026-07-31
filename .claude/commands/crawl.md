---
description: Crawl accountantsdaily.com.au/tax-compliance for top 5 newest articles, summarize as Facebook posts, and export to PDF
---

# #crawl — Daily Tax News Digest

Triggered by: `#crawl`

// turbo-all

## Steps

1. Run the crawl + summarize script:
```bash
node scripts/crawl-tax-news.js
```
This will:
- Fetch the listing page from accountantsdaily.com.au/tax-compliance
- Extract the top 5 newest article links, titles, dates, and authors
- Fetch each article's full content
- Call Gemini AI to generate a Facebook-post-style summary for each
- Save results to `tmp/crawl-output-YYYY-MM-DD.json`

2. Run the PDF generator:
```bash
node scripts/generate-crawl-pdf.js
```
This will:
- Read the latest crawl output JSON
- Generate a professionally styled PDF digest
- Save to `tmp/tax-digest-YYYY-MM-DD.pdf`

3. Present the PDF to the user:
- Open or link the generated PDF file at `tmp/tax-digest-YYYY-MM-DD.pdf`
- Briefly summarize the 5 article titles
