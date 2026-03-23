const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    buildRolePrompt,
    evaluateCouncilOutputs,
    renderCouncilTelemetry,
    resolveContextFiles,
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

async function testReviewerRunsAfterDebateAndReceivesPriorOutputs() {
    const calls = [];

    const results = await runCouncilAnalysis({
        userMessage: 'Review the current implementation',
        contextData: 'Observed facts:\n- Fact A',
        personaOrder: ['architect', 'challenger', 'reviewer'],
        runRole: async ({ roleKey, prompt }) => {
            calls.push({ roleKey, prompt });
            if (roleKey === 'architect') {
                return 'ARCHITECT: Use service boundaries.';
            }
            if (roleKey === 'challenger') {
                assert.match(prompt, /ARCHITECT: Use service boundaries\./);
                return 'CHALLENGER: The service boundary is too broad.';
            }
            assert.match(prompt, /ARCHITECT: Use service boundaries\./);
            assert.match(prompt, /CHALLENGER: The service boundary is too broad\./);
            return 'REVIEWER: Narrow the boundary and keep the evidence.';
        }
    });

    assert.deepStrictEqual(
        calls.map((call) => call.roleKey),
        ['architect', 'challenger', 'reviewer']
    );
    assert.strictEqual(results.reviewer, 'REVIEWER: Narrow the boundary and keep the evidence.');
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

async function main() {
    await testResolveContextFilesLoadsPromptReferencedFile();
    await testResolveContextFilesLoadsAbsoluteWindowsStylePathWithSpaces();
    await testResolveContextFilesFailsClosedForMissingPromptReferencedFile();
    await testReviewerRunsAfterDebateAndReceivesPriorOutputs();
    await testReviewerRetriesWhenCitationPrecisionFails();
    await testBuildRolePromptRequiresEvidenceTags();
    await testEvaluateCouncilOutputsScoresRequiredSectionsAndDuplicates();
    await testEvaluateCouncilOutputsFlagsInvalidEvidenceTags();
    await testEvaluateCouncilOutputsFlagsBroadEvidenceTags();
    await testRenderCouncilTelemetryIncludesEvaluationSummary();
    process.stdout.write('summon council brain passed\n');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
