#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const {
    assessPageTextQuality,
    assessBookTextQuality,
    detectDisagreement
} = require('../../functions/src/crm/book-text-quality');

function parseArgs(argv) {
    const args = {
        fixture: null,
        bookId: null,
        revisionId: null,
        json: false,
        thresholdWer: null,
        verbose: false
    };

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--fixture' && argv[i + 1]) {
            args.fixture = argv[++i];
        } else if (arg === '--bookId' && argv[i + 1]) {
            args.bookId = argv[++i];
        } else if (arg === '--revisionId' && argv[i + 1]) {
            args.revisionId = argv[++i];
        } else if (arg === '--json') {
            args.json = true;
        } else if (arg === '--verbose') {
            args.verbose = true;
        } else if (arg === '--threshold-wer' && argv[i + 1]) {
            args.thresholdWer = Number.parseFloat(argv[++i]);
        }
    }
    return args;
}

function runAuditOnPages(legacyPages, candidatePages) {
    const totalPages = Math.max(legacyPages.length, candidatePages.length);
    const pageAudits = [];

    let totalSuspiciousBefore = 0;
    let totalSuspiciousAfter = 0;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const legacyText = legacyPages[pageNum - 1] || '';
        const candidateText = candidatePages[pageNum - 1] || '';

        const legacyQuality = assessPageTextQuality(legacyText, pageNum);
        const candidateQuality = assessPageTextQuality(candidateText, pageNum);
        const disagreement = detectDisagreement(legacyText, candidateText);

        totalSuspiciousBefore += (legacyQuality.suspiciousTokens || []).length;
        totalSuspiciousAfter += (candidateQuality.suspiciousTokens || []).length;

        const flags = [];
        if (legacyQuality.whitespaceRatio < 0.08 && !legacyQuality.isBlank) flags.push('BEFORE_COLLAPSED_WHITESPACE');
        if (legacyQuality.longestAlphaRun >= 20) flags.push('BEFORE_LONG_ALPHABETIC_RUN');
        if ((legacyQuality.suspiciousTokens || []).length > 0) flags.push('BEFORE_SUSPICIOUS_TOKENS');

        if (candidateQuality.whitespaceRatio < 0.08 && !candidateQuality.isBlank) flags.push('AFTER_COLLAPSED_WHITESPACE');
        if (candidateQuality.longestAlphaRun >= 20) flags.push('AFTER_LONG_ALPHABETIC_RUN');
        if ((candidateQuality.suspiciousTokens || []).length > 0) flags.push('AFTER_SUSPICIOUS_TOKENS');

        if (disagreement.wer > 0.3) {
            flags.push('HIGH_DISAGREEMENT');
        }

        pageAudits.push({
            pageNumber: pageNum,
            legacyLength: legacyText.length,
            candidateLength: candidateText.length,
            whitespaceRatioBefore: legacyQuality.whitespaceRatio,
            whitespaceRatioAfter: candidateQuality.whitespaceRatio,
            longestRunBefore: legacyQuality.longestAlphaRun,
            longestRunAfter: candidateQuality.longestAlphaRun,
            suspiciousTokensBefore: legacyQuality.suspiciousTokens,
            suspiciousTokensAfter: candidateQuality.suspiciousTokens,
            characterDisagreementRate: disagreement.cer,
            wordDisagreementRate: disagreement.wer,
            flags
        });
    }

    const legacyBookQuality = assessBookTextQuality(legacyPages);
    const candidateBookQuality = assessBookTextQuality(candidatePages);

    return {
        totalPages,
        summary: {
            legacy: {
                averageWhitespaceRatio: legacyBookQuality.avgWhitespaceRatio,
                totalSuspiciousTokens: totalSuspiciousBefore,
                flaggedPagesCount: legacyBookQuality.suspectPagesCount
            },
            candidate: {
                averageWhitespaceRatio: candidateBookQuality.avgWhitespaceRatio,
                totalSuspiciousTokens: totalSuspiciousAfter,
                flaggedPagesCount: candidateBookQuality.suspectPagesCount
            },
            overallWordDisagreementRate: pageAudits.reduce((acc, p) => acc + p.wordDisagreementRate, 0) / (totalPages || 1)
        },
        pageAudits
    };
}

async function main() {
    const args = parseArgs(process.argv);

    if (!args.fixture && !args.bookId) {
        console.error('Usage: node scripts/crm/audit-book-text-revision.js --fixture <path> [--json] [--threshold-wer <n>]');
        console.error('       node scripts/crm/audit-book-text-revision.js --bookId <id> [--revisionId <id>] [--json]');
        process.exit(1);
    }

    let legacyPages = [];
    let candidatePages = [];

    if (args.fixture) {
        const fixturePath = path.resolve(args.fixture);
        const fixtureRaw = fs.readFileSync(fixturePath, 'utf8');
        const fixtureData = JSON.parse(fixtureRaw);

        if (Array.isArray(fixtureData.pages) && fixtureData.pages[0]?.embeddedCorruptText) {
            legacyPages = fixtureData.pages.map((p) => p.embeddedCorruptText || '');
            candidatePages = fixtureData.pages.map((p) => p.sourceGroundTruth || p.ocrText || '');
        } else {
            legacyPages = fixtureData.legacyPages || fixtureData.corruptedPages || [];
            candidatePages = fixtureData.candidatePages || fixtureData.groundTruthPages || fixtureData.ocrPages || [];
        }
    } else {
        throw new Error('Live remote audit via GCS/Firestore requires configured Firebase admin credentials.');
    }

    const auditResult = runAuditOnPages(legacyPages, candidatePages);

    if (args.json) {
        console.log(JSON.stringify(auditResult, null, 2));
    } else {
        console.log('=== CRM BOOKS TEXT REVISION AUDIT REPORT ===');
        console.log(`Total Pages Analyzed: ${auditResult.totalPages}`);
        console.log('\n--- Before vs After Summary ---');
        console.log(`Legacy Avg Whitespace Ratio:     ${(auditResult.summary.legacy.averageWhitespaceRatio * 100).toFixed(2)}%`);
        console.log(`Candidate Avg Whitespace Ratio:  ${(auditResult.summary.candidate.averageWhitespaceRatio * 100).toFixed(2)}%`);
        console.log(`Legacy Suspicious Tokens:        ${auditResult.summary.legacy.totalSuspiciousTokens}`);
        console.log(`Candidate Suspicious Tokens:     ${auditResult.summary.candidate.totalSuspiciousTokens}`);
        console.log(`Average Word Disagreement:       ${(auditResult.summary.overallWordDisagreementRate * 100).toFixed(2)}%`);

        if (args.verbose) {
            console.log('\n--- Page Breakdown ---');
            for (const page of auditResult.pageAudits) {
                console.log(`Page ${page.pageNumber}: Flags=[${page.flags.join(', ')}] WER=${(page.wordDisagreementRate * 100).toFixed(1)}%`);
                if (page.suspiciousTokensBefore.length > 0) {
                    console.log(`   Before suspicious: ${page.suspiciousTokensBefore.join(', ')}`);
                }
                if (page.suspiciousTokensAfter.length > 0) {
                    console.log(`   After suspicious:  ${page.suspiciousTokensAfter.join(', ')}`);
                }
            }
        }
    }

    if (args.thresholdWer != null && auditResult.summary.candidate.totalSuspiciousTokens > args.thresholdWer) {
        console.error(`FAILED: Candidate suspicious tokens (${auditResult.summary.candidate.totalSuspiciousTokens}) exceed threshold (${args.thresholdWer})`);
        process.exit(2);
    }
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = {
    parseArgs,
    runAuditOnPages
};
