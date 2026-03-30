const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    buildRolePrompt,
    evaluateRoleOutput,
    evaluateCouncilOutputs,
    extractReferencedFiles,
    renderCouncilTelemetry,
    resolveContextFiles,
    resolveOutputPath,
    runCouncilAnalysis
} = require('../scripts/council-brain-lib');

async function testResolveContextFilesLoadsPromptReferencedFile() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-brain-'));
    const fixturePath = path.join(tmpDir, 'brief.md');
    fs.writeFileSync(fixturePath, '# Brief\nImportant context\n', 'utf8');

    const result = resolveContextFiles({
        userMessage: `Review ${fixturePath} for logic issues`,
        contextFiles: [],
        cwd: process.cwd()
    });

    assert.deepStrictEqual(result.missingFiles, []);
    assert.deepStrictEqual(result.resolvedFiles, [fixturePath]);
    assert.match(result.contextData, /Important context/);
}

async function testResolveContextFilesLoadsAbsoluteWindowsStylePathWithSpaces() {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-brain-space-'));
    const spacedDir = path.join(baseDir, 'folder with spaces');
    fs.mkdirSync(spacedDir, { recursive: true });
    const fixturePath = path.join(spacedDir, 'brief.md');
    fs.writeFileSync(fixturePath, '# Brief\nSpace path context\n', 'utf8');

    const result = resolveContextFiles({
        userMessage: `Review ${fixturePath} for logic issues`,
        contextFiles: [],
        cwd: process.cwd()
    });

    assert.deepStrictEqual(result.missingFiles, []);
    assert.deepStrictEqual(result.resolvedFiles, [fixturePath]);
    assert.match(result.contextData, /Space path context/);
}

async function testResolveContextFilesDeduplicatesEquivalentRelativePaths() {
    const fixtureRelativePath = path.join('tmp', 'council-dedupe-fixture.md');
    const fixturePath = path.join(process.cwd(), fixtureRelativePath);
    fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
    fs.writeFileSync(fixturePath, '# Brief\nDeduplicated context\n', 'utf8');

    const result = resolveContextFiles({
        userMessage: `Review tmp/council-dedupe-fixture.md for logic issues`,
        contextFiles: ['tmp\\council-dedupe-fixture.md'],
        cwd: process.cwd()
    });

    assert.deepStrictEqual(result.missingFiles, []);
    assert.deepStrictEqual(result.resolvedFiles, [fixturePath]);
    assert.match(result.contextData, /Deduplicated context/);
    assert.strictEqual(
        (result.contextData.match(/--- FILE:/g) || []).length,
        1
    );
}

async function testExtractReferencedFilesSupportsMultiDotFilenamesAndLineSuffixes() {
    const files = extractReferencedFiles(
        'Review tests/summon-council-brain.test.js:L10-L20 and path-with-dash/file-name.test.js.'
    );

    assert.deepStrictEqual(files, [
        'tests/summon-council-brain.test.js',
        'path-with-dash/file-name.test.js'
    ]);
}

async function testResolveContextFilesFailsClosedForMissingPromptReferencedFile() {
    const missingPath = path.join(os.tmpdir(), 'council-brain-missing.md');

    assert.throws(
        () => resolveContextFiles({
            userMessage: `Review ${missingPath} for logic issues`,
            contextFiles: [],
            cwd: process.cwd()
        }),
        (error) => error && error.code === 'MISSING_CONTEXT' && error.missingFiles.includes(missingPath)
    );
}

async function testResolveContextFilesCompactsLargeFilesAroundRelevantMatches() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-brain-compact-'));
    const fixturePath = path.join(tmpDir, 'large-file.js');
    const lines = [];

    for (let index = 1; index <= 120; index += 1) {
        lines.push(`const filler${index} = ${index};`);
    }
    lines[95] = 'function criticalMatcher() { return "focus"; }';
    lines[96] = 'const criticalContext = criticalMatcher();';
    fs.writeFileSync(fixturePath, `${lines.join('\n')}\n`, 'utf8');

    const result = resolveContextFiles({
        userMessage: 'Review criticalMatcher behavior',
        contextFiles: [fixturePath],
        cwd: process.cwd(),
        maxFileLinesForFullContext: 20,
        excerptRadiusLines: 1,
        maxExcerptMatchesPerFile: 2,
        maxContextChars: 500
    });

    assert.deepStrictEqual(result.resolvedFiles, [fixturePath]);
    assert.ok(result.contextData.length < 700, 'context should be compacted for large files');
    assert.match(result.contextData, /criticalMatcher/);
    assert.match(result.contextData, /L96/);
}

async function testReviewerRunsAfterDebateAndReceivesPriorOutputs() {
    const calls = [];

    const results = await runCouncilAnalysis({
        userMessage: 'Review the current implementation',
        contextData: 'Observed facts:\n- Fact A',
        personaOrder: ['architect', 'challenger', 'reviewer'],
        runRole: async ({ roleKey, prompt }) => {
            calls.push({ roleKey, prompt });
            if (roleKey === 'architect') {
                return [
                    '1. Observed Facts',
                    '- Service boundary exists [FILE: C:\\tmp\\fixture.js:L1-L2]',
                    '2. Inferences',
                    '- It is broad [FILE: C:\\tmp\\fixture.js:L3-L4]',
                    '3. Recommendations',
                    '- Narrow it [FILE: C:\\tmp\\fixture.js:L5-L6]',
                    '4. Unknowns',
                    '- Unknown one'
                ].join('\n');
            }
            if (roleKey === 'challenger') {
                assert.match(prompt, /Service boundary exists/);
                return [
                    '1. Supported Concerns',
                    '- Boundary is too broad [FILE: C:\\tmp\\fixture.js:L3-L4]',
                    '2. Weak Claims',
                    '- Scope is unclear [FILE: C:\\tmp\\fixture.js:L7-L8]',
                    '3. Corrections',
                    '- Split the module [FILE: C:\\tmp\\fixture.js:L9-L10]',
                    '4. Remaining Unknowns',
                    '- Unknown one'
                ].join('\n');
            }
            assert.match(prompt, /Architect Summary:/);
            assert.match(prompt, /Challenger Summary:/);
            assert.doesNotMatch(prompt, /Architect Output:/);
            assert.doesNotMatch(prompt, /Challenger Output:/);
            return [
                '1. Final Findings',
                '- Narrow the boundary [FILE: C:\\tmp\\fixture.js:L5-L6]',
                '2. Recommended Actions',
                '- Split the module [FILE: C:\\tmp\\fixture.js:L9-L10]',
                '3. Open Unknowns',
                '- Unknown one'
            ].join('\n');
        }
    });

    assert.deepStrictEqual(
        calls.map((call) => call.roleKey),
        ['architect', 'challenger', 'reviewer']
    );
    assert.match(results.reviewer, /Narrow the boundary/);
}

async function testRunCouncilAnalysisCanWidenContextOnRetry() {
    const seenPrompts = [];

    const results = await runCouncilAnalysis({
        userMessage: 'Review the current implementation',
        contextData: 'Context Evidence:\nnarrow context',
        resolvedFiles: ['C:\\tmp\\fixture.js'],
        fileLineCounts: {
            'C:\\tmp\\fixture.js': 20
        },
        validateRoles: true,
        maxRoleAttempts: 2,
        getContextDataForAttempt: ({ roleKey, attempt, defaultContextData }) => {
            if (roleKey === 'architect' && attempt === 2) {
                return `${defaultContextData}\nexpanded context`;
            }
            return defaultContextData;
        },
        runRole: async ({ roleKey, prompt, attempt }) => {
            seenPrompts.push({ roleKey, prompt, attempt });

            if (roleKey === 'architect' && attempt === 1) {
                return '1. Observed Facts\n- Fact one\n2. Inferences\n- Inference one\n3. Recommendations\n- Action one\n4. Unknowns\n- Unknown one';
            }
            if (roleKey === 'architect') {
                assert.match(prompt, /expanded context/);
                assert.match(prompt, /Additional context has been provided/);
            }

            if (roleKey === 'challenger') {
                return [
                    '1. Supported Concerns',
                    '- Concern one [FILE: C:\\tmp\\fixture.js:L1-L2]',
                    '2. Weak Claims',
                    '- Weak claim one [FILE: C:\\tmp\\fixture.js:L3-L4]',
                    '3. Corrections',
                    '- Correction one [FILE: C:\\tmp\\fixture.js:L5-L6]',
                    '4. Remaining Unknowns',
                    '- Unknown one'
                ].join('\n');
            }

            return [
                roleKey === 'architect' ? '1. Observed Facts' : '1. Final Findings',
                roleKey === 'architect' ? '- Fact one [FILE: C:\\tmp\\fixture.js:L1-L2]' : '- Finding one [FILE: C:\\tmp\\fixture.js:L1-L2]',
                roleKey === 'architect' ? '2. Inferences' : '2. Recommended Actions',
                roleKey === 'architect' ? '- Inference one [FILE: C:\\tmp\\fixture.js:L3-L4]' : '- Action one [FILE: C:\\tmp\\fixture.js:L3-L4]',
                roleKey === 'architect' ? '3. Recommendations' : '3. Open Unknowns',
                roleKey === 'architect' ? '- Action one [FILE: C:\\tmp\\fixture.js:L5-L6]' : '- Unknown one',
                roleKey === 'architect' ? '4. Unknowns' : undefined,
                roleKey === 'architect' ? '- Unknown one' : undefined
            ].filter(Boolean).join('\n');
        }
    });

    assert.strictEqual(results.status, 'repaired_success');
    assert.strictEqual(seenPrompts.filter((entry) => entry.roleKey === 'architect').length, 2);
}

async function testRunCouncilAnalysisRetriesArchitectWhenEvidenceIsMissing() {
    const calls = [];

    const results = await runCouncilAnalysis({
        userMessage: 'Review the current implementation',
        contextData: 'Observed facts:\n- Fact A',
        resolvedFiles: ['C:\\tmp\\fixture.js'],
        fileLineCounts: {
            'C:\\tmp\\fixture.js': 20
        },
        validateRoles: true,
        maxRoleAttempts: 2,
        runRole: async ({ roleKey, prompt }) => {
            calls.push({ roleKey, prompt });

            if (roleKey === 'architect') {
                const architectAttempt = calls.filter((call) => call.roleKey === 'architect').length;
                if (architectAttempt === 1) {
                    return '1. Observed Facts\n- Fact one\n2. Inferences\n- Inference one\n3. Recommendations\n- Action one\n4. Unknowns\n- Unknown one';
                }

                assert.match(prompt, /missing evidence/i);
                return [
                    '1. Observed Facts',
                    '- Fact one [FILE: C:\\tmp\\fixture.js:L1-L2]',
                    '2. Inferences',
                    '- Inference one [FILE: C:\\tmp\\fixture.js:L3-L4]',
                    '3. Recommendations',
                    '- Action one [FILE: C:\\tmp\\fixture.js:L5-L6]',
                    '4. Unknowns',
                    '- Unknown one'
                ].join('\n');
            }

            if (roleKey === 'challenger') {
                return [
                    '1. Supported Concerns',
                    '- Concern one [FILE: C:\\tmp\\fixture.js:L1-L2]',
                    '2. Weak Claims',
                    '- Weak claim one [FILE: C:\\tmp\\fixture.js:L3-L4]',
                    '3. Corrections',
                    '- Correction one [FILE: C:\\tmp\\fixture.js:L5-L6]',
                    '4. Remaining Unknowns',
                    '- Unknown one'
                ].join('\n');
            }

            return [
                '1. Final Findings',
                '- Finding one [FILE: C:\\tmp\\fixture.js:L1-L2]',
                '2. Recommended Actions',
                '- Action one [FILE: C:\\tmp\\fixture.js:L3-L4]',
                '3. Open Unknowns',
                '- Unknown one'
            ].join('\n');
        }
    });

    assert.strictEqual(calls.filter((call) => call.roleKey === 'architect').length, 2);
    assert.strictEqual(results.status, 'repaired_success');
    assert.strictEqual(results.attemptsByRole.architect, 2);
}

async function testReviewerRetriesWhenCitationPrecisionFails() {
    const calls = [];

    const results = await runCouncilAnalysis({
        userMessage: 'Review the current implementation',
        contextData: 'Observed facts:\n- Fact A',
        resolvedFiles: ['C:\\tmp\\fixture.js'],
        fileLineCounts: {
            'C:\\tmp\\fixture.js': 200
        },
        enforceReviewerEvidence: true,
        runRole: async ({ roleKey, prompt }) => {
            calls.push({ roleKey, prompt });
            if (roleKey === 'architect') {
                return [
                    '1. Observed Facts',
                    '- Fact one [FILE: C:\\tmp\\fixture.js:L1-L5]',
                    '2. Inferences',
                    '- Inference one [FILE: C:\\tmp\\fixture.js:L1-L5]',
                    '3. Recommendations',
                    '- Action one [FILE: C:\\tmp\\fixture.js:L1-L5]',
                    '4. Unknowns',
                    '- Unknown one'
                ].join('\n');
            }
            if (roleKey === 'challenger') {
                return [
                    '1. Supported Concerns',
                    '- Concern one [FILE: C:\\tmp\\fixture.js:L1-L5]',
                    '2. Weak Claims',
                    '- Weak claim one [FILE: C:\\tmp\\fixture.js:L1-L5]',
                    '3. Corrections',
                    '- Correction one [FILE: C:\\tmp\\fixture.js:L1-L5]',
                    '4. Remaining Unknowns',
                    '- Unknown one'
                ].join('\n');
            }

            const reviewerAttempt = calls.filter((call) => call.roleKey === 'reviewer').length;
            if (reviewerAttempt === 1) {
                return [
                    '1. Final Findings',
                    '- Finding one [FILE: C:\\tmp\\fixture.js:L1-L80]',
                    '2. Recommended Actions',
                    '- Action one [FILE: C:\\tmp\\fixture.js:L1-L80]',
                    '3. Open Unknowns',
                    '- Unknown one'
                ].join('\n');
            }

            assert.match(prompt, /Your previous reviewer output failed evidence precision checks/);
            return [
                '1. Final Findings',
                '- Finding one [FILE: C:\\tmp\\fixture.js:L1-L5]',
                '2. Recommended Actions',
                '- Action one [FILE: C:\\tmp\\fixture.js:L6-L10]',
                '3. Open Unknowns',
                '- Unknown one'
            ].join('\n');
        }
    });

    assert.strictEqual(calls.filter((call) => call.roleKey === 'reviewer').length, 2);
    assert.match(results.reviewer, /\[FILE: C:\\tmp\\fixture\.js:L1-L5\]/);
}

async function testRunCouncilAnalysisFailsClosedWhenRoleNeverValidates() {
    const results = await runCouncilAnalysis({
        userMessage: 'Review the current implementation',
        contextData: 'Observed facts:\n- Fact A',
        resolvedFiles: ['C:\\tmp\\fixture.js'],
        fileLineCounts: {
            'C:\\tmp\\fixture.js': 20
        },
        validateRoles: true,
        maxRoleAttempts: 2,
        runRole: async ({ roleKey }) => {
            if (roleKey === 'architect') {
                return '1. Observed Facts\n- Fact one\n2. Inferences\n- Inference one\n3. Recommendations\n- Action one\n4. Unknowns\n- Unknown one';
            }
            if (roleKey === 'challenger') {
                return [
                    '1. Supported Concerns',
                    '- Concern one [FILE: C:\\tmp\\fixture.js:L1-L2]',
                    '2. Weak Claims',
                    '- Weak claim one [FILE: C:\\tmp\\fixture.js:L3-L4]',
                    '3. Corrections',
                    '- Correction one [FILE: C:\\tmp\\fixture.js:L5-L6]',
                    '4. Remaining Unknowns',
                    '- Unknown one'
                ].join('\n');
            }
            return [
                '1. Final Findings',
                '- Finding one [FILE: C:\\tmp\\fixture.js:L1-L2]',
                '2. Recommended Actions',
                '- Action one [FILE: C:\\tmp\\fixture.js:L3-L4]',
                '3. Open Unknowns',
                '- Unknown one'
            ].join('\n');
        }
    });

    assert.strictEqual(results.status, 'failed_validation');
    assert.strictEqual(results.attemptsByRole.architect, 2);
    assert.ok(results.validationFailures.architect.length > 0);
}

async function testBuildRolePromptRequiresEvidenceTags() {
    const prompt = buildRolePrompt({
        roleKey: 'architect',
        userMessage: 'Review the implementation',
        contextData: '--- FILE: C:\\tmp\\fixture.js ---\nconst x = 1;\n',
        priorOutputs: {}
    });

    assert.match(prompt, /Use evidence tags in the form \[FILE:/);
    assert.match(prompt, /If no direct evidence exists, write No direct evidence/);
}

async function testEvaluateRoleOutputAcceptsBacktickWrappedEvidenceTags() {
    const evaluation = evaluateRoleOutput('architect', [
        '1. Observed Facts',
        '- Fact one [FILE: `C:\\tmp\\fixture.js:L1-L2`]',
        '2. Inferences',
        '- Inference one [FILE: `C:\\tmp\\fixture.js:L3-L4`]',
        '3. Recommendations',
        '- Action one [FILE: `C:\\tmp\\fixture.js:L5-L6`]',
        '4. Unknowns',
        '- Unknown one'
    ].join('\n'), {
        resolvedFiles: ['C:\\tmp\\fixture.js'],
        fileLineCounts: {
            'C:\\tmp\\fixture.js': 10
        }
    });

    assert.strictEqual(evaluation.hasEvidenceTags, true);
    assert.strictEqual(evaluation.evidenceTagCount, 3);
    assert.strictEqual(evaluation.invalidEvidenceTagCount, 0);
}

async function testEvaluateCouncilOutputsScoresRequiredSectionsAndDuplicates() {
    const evaluation = evaluateCouncilOutputs({
        resolvedFiles: ['C:\\tmp\\fixture.js'],
        fileLineCounts: {
            'C:\\tmp\\fixture.js': 10
        },
        outputs: {
            architect: [
                '1. Observed Facts',
                '- Fact one [FILE: C:\\tmp\\fixture.js:L1-L1]',
                '2. Inferences',
                '- Inference one [FILE: C:\\tmp\\fixture.js:L1-L1]',
                '3. Recommendations',
                '- Shared action [FILE: C:\\tmp\\fixture.js:L1-L1]',
                '4. Unknowns',
                '- Unknown one'
            ].join('\n'),
            challenger: [
                '1. Supported Concerns',
                '- Concern one [FILE: C:\\tmp\\fixture.js:L1-L1]',
                '2. Weak Claims',
                '- Weak claim one [FILE: C:\\tmp\\fixture.js:L1-L1]',
                '3. Corrections',
                '- Correction one [FILE: C:\\tmp\\fixture.js:L1-L1]',
                '4. Remaining Unknowns',
                '- Unknown one'
            ].join('\n'),
            reviewer: [
                '1. Final Findings',
                '- Finding one',
                '2. Recommended Actions',
                '- Shared action',
                '- Shared action',
                '3. Open Unknowns',
                '- Unknown one'
            ].join('\n')
        }
    });

    assert.strictEqual(evaluation.summary.totalRoles, 3);
    assert.strictEqual(evaluation.roles.architect.hasRequiredSections, true);
    assert.strictEqual(evaluation.roles.architect.evidenceTagCount, 3);
    assert.strictEqual(evaluation.roles.architect.hasEvidenceTags, true);
    assert.strictEqual(evaluation.roles.architect.invalidEvidenceTagCount, 0);
    assert.strictEqual(evaluation.roles.challenger.hasRequiredSections, true);
    assert.strictEqual(evaluation.roles.reviewer.hasRequiredSections, true);
    assert.strictEqual(evaluation.roles.reviewer.duplicateBulletCount, 1);
    assert.strictEqual(evaluation.roles.reviewer.hasEvidenceTags, false);
    assert.strictEqual(evaluation.summary.rolesWithDuplicateBullets, 1);
    assert.strictEqual(evaluation.summary.rolesMissingEvidenceTags, 1);
    assert.strictEqual(evaluation.summary.rolesWithInvalidEvidenceTags, 0);
}

async function testEvaluateCouncilOutputsFlagsInvalidEvidenceTags() {
    const evaluation = evaluateCouncilOutputs({
        resolvedFiles: ['C:\\tmp\\fixture.js'],
        fileLineCounts: {
            'C:\\tmp\\fixture.js': 4
        },
        outputs: {
            architect: [
                '1. Observed Facts',
                '- Fact one [FILE: C:\\tmp\\fixture.js:L1-L2]',
                '2. Inferences',
                '- Inference one [FILE: C:\\tmp\\fixture.js:L20-L21]',
                '3. Recommendations',
                '- Action one [FILE: C:\\tmp\\missing.js:L1-L1]',
                '4. Unknowns',
                '- Unknown one'
            ].join('\n'),
            challenger: '1. Supported Concerns\n- Concern one\n2. Weak Claims\n- Weak claim one\n3. Corrections\n- Correction one\n4. Remaining Unknowns\n- Unknown one',
            reviewer: '1. Final Findings\n- Finding one\n2. Recommended Actions\n- Action one\n3. Open Unknowns\n- Unknown one'
        }
    });

    assert.strictEqual(evaluation.roles.architect.evidenceTagCount, 3);
    assert.strictEqual(evaluation.roles.architect.invalidEvidenceTagCount, 2);
    assert.strictEqual(evaluation.summary.rolesWithInvalidEvidenceTags, 1);
}

async function testEvaluateCouncilOutputsFlagsBroadEvidenceTags() {
    const evaluation = evaluateCouncilOutputs({
        resolvedFiles: ['C:\\tmp\\fixture.js'],
        fileLineCounts: {
            'C:\\tmp\\fixture.js': 200
        },
        outputs: {
            architect: [
                '1. Observed Facts',
                '- Fact one [FILE: C:\\tmp\\fixture.js:L1-L80]',
                '2. Inferences',
                '- Inference one [FILE: C:\\tmp\\fixture.js:L90-L95]',
                '3. Recommendations',
                '- Action one [FILE: C:\\tmp\\fixture.js:L100-L130]',
                '4. Unknowns',
                '- Unknown one'
            ].join('\n'),
            challenger: '1. Supported Concerns\n- Concern one\n2. Weak Claims\n- Weak claim one\n3. Corrections\n- Correction one\n4. Remaining Unknowns\n- Unknown one',
            reviewer: '1. Final Findings\n- Finding one\n2. Recommended Actions\n- Action one\n3. Open Unknowns\n- Unknown one'
        }
    });

    assert.strictEqual(evaluation.roles.architect.evidenceTagCount, 3);
    assert.strictEqual(evaluation.roles.architect.invalidEvidenceTagCount, 0);
    assert.strictEqual(evaluation.roles.architect.broadEvidenceTagCount, 2);
    assert.strictEqual(evaluation.summary.rolesWithBroadEvidenceTags, 1);
}

async function testRenderCouncilTelemetryIncludesEvaluationSummary() {
    const telemetry = renderCouncilTelemetry({
        userMessage: 'Review the implementation',
        resolvedFiles: ['C:\\tmp\\fixture.md'],
        fileLineCounts: {
            'C:\\tmp\\fixture.md': 1
        },
        outputs: {
            architect: '1. Observed Facts\n- Fact\n2. Inferences\n- Inference\n3. Recommendations\n- Action\n4. Unknowns\n- Unknown',
            challenger: '1. Supported Concerns\n- Concern\n2. Weak Claims\n- Weak\n3. Corrections\n- Correction\n4. Remaining Unknowns\n- Unknown',
            reviewer: '1. Final Findings\n- Finding\n2. Recommended Actions\n- Action\n3. Open Unknowns\n- Unknown'
        }
    });

    const parsed = JSON.parse(telemetry);
    assert.strictEqual(parsed.userMessage, 'Review the implementation');
    assert.deepStrictEqual(parsed.resolvedFiles, ['C:\\tmp\\fixture.md']);
    assert.strictEqual(parsed.evaluation.summary.totalRoles, 3);
    assert.strictEqual(parsed.evaluation.roles.architect.hasRequiredSections, true);
    assert.strictEqual(parsed.evaluation.roles.architect.hasEvidenceTags, false);
    assert.strictEqual(parsed.evaluation.roles.architect.invalidEvidenceTagCount, 0);
    assert.strictEqual(parsed.evaluation.roles.architect.broadEvidenceTagCount, 0);
}

async function testResolveOutputPathRejectsExternalPathsByDefault() {
    assert.throws(
        () => resolveOutputPath({
            requestedOutFile: path.join(os.tmpdir(), 'council-outside.txt'),
            cwd: process.cwd(),
            repoRoot: process.cwd(),
            allowExternalOut: false
        }),
        /outside the repository/i
    );
}

async function main() {
    await testResolveContextFilesLoadsPromptReferencedFile();
    await testResolveContextFilesLoadsAbsoluteWindowsStylePathWithSpaces();
    await testResolveContextFilesDeduplicatesEquivalentRelativePaths();
    await testExtractReferencedFilesSupportsMultiDotFilenamesAndLineSuffixes();
    await testResolveContextFilesFailsClosedForMissingPromptReferencedFile();
    await testResolveContextFilesCompactsLargeFilesAroundRelevantMatches();
    await testReviewerRunsAfterDebateAndReceivesPriorOutputs();
    await testRunCouncilAnalysisCanWidenContextOnRetry();
    await testRunCouncilAnalysisRetriesArchitectWhenEvidenceIsMissing();
    await testReviewerRetriesWhenCitationPrecisionFails();
    await testRunCouncilAnalysisFailsClosedWhenRoleNeverValidates();
    await testBuildRolePromptRequiresEvidenceTags();
    await testEvaluateRoleOutputAcceptsBacktickWrappedEvidenceTags();
    await testEvaluateCouncilOutputsScoresRequiredSectionsAndDuplicates();
    await testEvaluateCouncilOutputsFlagsInvalidEvidenceTags();
    await testEvaluateCouncilOutputsFlagsBroadEvidenceTags();
    await testRenderCouncilTelemetryIncludesEvaluationSummary();
    await testResolveOutputPathRejectsExternalPathsByDefault();
    process.stdout.write('summon council brain passed\n');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
