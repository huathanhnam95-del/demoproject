const assert = require('assert');
const {
    buildLeadCreateData,
    buildLeadPatchData,
    buildLeadConversion,
    mapLeadRecord,
    LEAD_STAGES
} = require('../../functions/src/crm/lead-service');

const context = {
    user: {
        uid: 'admin-1',
        email: 'admin@example.com'
    },
    serverTimestamp: () => 'SERVER_TS'
};

assert.deepStrictEqual(LEAD_STAGES, [
    'new',
    'contacted',
    'test_scheduled',
    'test_completed',
    'counseling',
    'trial',
    'won',
    'lost'
]);

const created = buildLeadCreateData({
    name: 'Lead Nguyen',
    email: 'lead@example.com',
    source: 'facebook',
    facebookDisplayName: 'Lead Nguyen FB',
    facebookProfileUrl: 'https://facebook.com/lead.nguyen',
    realName: 'Nguyen Van Lead',
    dateOfBirth: '2001-05-20',
    learningNeeds: 'Needs evening IELTS speaking support',
    preferredLearningDays: ['Tuesday', 'Thursday'],
    preferredLearningHours: ['19:00-21:00'],
    messengerThreadUrl: 'https://m.me/t/lead-nguyen',
    messengerLastContactAt: '2026-03-11T09:15:00Z',
    messengerStatus: 'awaiting_reply',
    agentSourceId: 'agent-src-1',
    probability: 40,
    nextActionAt: '2026-03-12',
    lastContactAt: '2026-03-10'
}, context);

const scoreOnlyLead = buildLeadCreateData({
    learningProfile: {
        overall: '79',
        listening: '78',
        reading: '77',
        speaking: '76',
        writing: '75'
    },
    targets: {
        exam: 'PTE',
        score: '79'
    }
}, context);

assert.strictEqual(scoreOnlyLead.name, null);
assert.strictEqual(scoreOnlyLead.learningProfile.overall, 79);
assert.strictEqual(scoreOnlyLead.targets.score, 79);

assert.strictEqual(created.stage, 'new');
assert.strictEqual(created.source, 'facebook');
assert.strictEqual(created.ownerUid, 'admin-1');
assert.strictEqual(created.probability, 40);
assert.strictEqual(created.facebook, 'Lead Nguyen FB');
assert.strictEqual(created.facebookDisplayName, 'Lead Nguyen FB');
assert.strictEqual(created.facebookProfileUrl, 'https://facebook.com/lead.nguyen');
assert.strictEqual(created.realName, 'Nguyen Van Lead');
assert.strictEqual(created.dateOfBirth, '2001-05-20');
assert.strictEqual(created.learningNeeds, 'Needs evening IELTS speaking support');
assert.deepStrictEqual(created.preferredLearningDays, ['Tuesday', 'Thursday']);
assert.deepStrictEqual(created.preferredLearningHours, ['19:00-21:00']);
assert.strictEqual(created.messengerThreadUrl, 'https://m.me/t/lead-nguyen');
assert.strictEqual(created.messengerLastContactAt, '2026-03-11T09:15:00Z');
assert.strictEqual(created.messengerStatus, 'awaiting_reply');
assert.strictEqual(created.agentSourceId, 'agent-src-1');

const patched = buildLeadPatchData(created, {
    stage: 'test_completed',
    lossReason: 'budget',
    probability: 65,
    learningNeeds: 'Needs weekend IELTS writing support',
    preferredLearningDays: ['Saturday'],
    preferredLearningHours: ['09:00-11:00'],
    messengerStatus: 'follow_up_sent'
}, context);

assert.strictEqual(patched.stage, 'test_completed');
assert.strictEqual(patched.lossReason, 'budget');
assert.strictEqual(patched.probability, 65);
assert.strictEqual(patched.learningNeeds, 'Needs weekend IELTS writing support');
assert.deepStrictEqual(patched.preferredLearningDays, ['Saturday']);
assert.deepStrictEqual(patched.preferredLearningHours, ['09:00-11:00']);
assert.strictEqual(patched.messengerStatus, 'follow_up_sent');

const conversion = buildLeadConversion({
    leadId: 'lead-1',
    lead: {
        ...patched,
        name: 'Lead Nguyen',
        email: 'lead@example.com',
        phone: '01234',
        zalo: 'lead-zalo',
        facebook: 'lead.fb',
        source: 'facebook'
    },
    context
});

assert.strictEqual(conversion.student.acquisitionSource, 'facebook');
assert.strictEqual(conversion.student.agentSourceId, 'agent-src-1');
assert.strictEqual(conversion.student.name, 'Nguyen Van Lead');
assert.strictEqual(conversion.student.leadId, 'lead-1');
assert.strictEqual(conversion.student.lifecycleStage, 'test_completed');
assert.strictEqual(conversion.student.preferredSchedule, 'Days: Saturday | Hours: 09:00-11:00');
assert.strictEqual(conversion.student.notes.includes('Needs weekend IELTS writing support'), true);
assert.strictEqual(conversion.student.counselingNotes.includes('Messenger: follow_up_sent'), true);
assert.strictEqual(conversion.leadPatch.stage, 'converted');
assert.strictEqual(conversion.leadPatch.studentId, 'PENDING_STUDENT_ID');

const mapped = mapLeadRecord({ id: 'lead-1', ...patched });
assert.strictEqual(mapped.leadId, 'lead-1');
assert.strictEqual(mapped.stage, 'test_completed');
assert.strictEqual(mapped.facebookDisplayName, 'Lead Nguyen FB');
assert.strictEqual(mapped.facebookProfileUrl, 'https://facebook.com/lead.nguyen');
assert.strictEqual(mapped.realName, 'Nguyen Van Lead');
assert.strictEqual(mapped.dateOfBirth, '2001-05-20');
assert.strictEqual(mapped.learningNeeds, 'Needs weekend IELTS writing support');
assert.deepStrictEqual(mapped.preferredLearningDays, ['Saturday']);
assert.deepStrictEqual(mapped.preferredLearningHours, ['09:00-11:00']);
assert.strictEqual(mapped.messengerThreadUrl, 'https://m.me/t/lead-nguyen');
assert.strictEqual(mapped.messengerLastContactAt, '2026-03-11T09:15:00Z');
assert.strictEqual(mapped.messengerStatus, 'follow_up_sent');
assert.strictEqual(mapped.agentSourceId, 'agent-src-1');
assert.deepStrictEqual(mapped.learningProfile, patched.learningProfile);
assert.deepStrictEqual(mapped.targets, patched.targets);

const legacyFacebookMapped = mapLeadRecord({
    id: 'legacy-lead-1',
    facebook: 'legacy.fb.name'
});
assert.strictEqual(legacyFacebookMapped.facebook, 'legacy.fb.name');
assert.strictEqual(legacyFacebookMapped.facebookDisplayName, 'legacy.fb.name');
assert.strictEqual(legacyFacebookMapped.facebookProfileUrl, null);

const urlOnlyConversion = buildLeadConversion({
    leadId: 'lead-url-only',
    lead: {
        name: '',
        realName: '',
        facebook: '',
        facebookDisplayName: '',
        facebookProfileUrl: 'https://facebook.com/url.only',
        source: 'facebook'
    },
    context
});

assert.strictEqual(urlOnlyConversion.student.name, 'https://facebook.com/url.only');
assert.strictEqual(urlOnlyConversion.student.facebook, null);
assert.strictEqual(urlOnlyConversion.student.facebookProfileUrl, 'https://facebook.com/url.only');

const blankLead = buildLeadCreateData({}, context);
assert.strictEqual(blankLead.name, null);
assert.strictEqual(blankLead.stage, 'new');

const externalLinkLead = buildLeadCreateData({
    name: 'External Test Lead',
    externalTestUrl: 'https://apeuni.com/score/12345'
}, context);
assert.strictEqual(externalLinkLead.externalTestUrl, 'https://apeuni.com/score/12345');

const patchedWithLink = buildLeadPatchData(externalLinkLead, {
    externalTestUrl: 'https://pte.tools/result/67890'
}, context);
assert.strictEqual(patchedWithLink.externalTestUrl, 'https://pte.tools/result/67890');

const convertedWithLink = buildLeadConversion({
    leadId: 'lead-ext-1',
    lead: patchedWithLink,
    context
});
assert.strictEqual(convertedWithLink.student.externalTestUrl, 'https://pte.tools/result/67890');

console.log('lead service passed');
