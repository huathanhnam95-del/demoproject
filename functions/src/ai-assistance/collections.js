'use strict';

const AI_ASSISTANCE_COLLECTIONS = Object.freeze({
    accounts: 'crmAiBudgetAccounts',
    ledgers: 'crmAiBudgetLedgers',
    reservations: 'crmAiBudgetReservations'
});

const AI_VOICE_COLLECTIONS = Object.freeze({
    sessions: 'crmAiVoiceSessions',
    utterances: 'crmAiVoiceUtterances',
    attestations: 'crmAiVoiceAttestations'
});

const AI_DRAFT_COLLECTIONS = Object.freeze({
    drafts: 'crmAiDrafts',
    revisions: 'crmAiDraftRevisions',
    requests: 'crmAiDraftRequests'
});

module.exports = { AI_ASSISTANCE_COLLECTIONS, AI_VOICE_COLLECTIONS, AI_DRAFT_COLLECTIONS };
