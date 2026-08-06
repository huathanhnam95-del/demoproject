const { FieldValue } = require('firebase-admin/firestore');
const { CRM_BOOK_USAGE } = require('./collections');

const COST_INPUT_PER_1M = parseFloat(process.env.BOOKS_COST_INPUT_PER_1M || '0.10');
const COST_OUTPUT_PER_1M = parseFloat(process.env.BOOKS_COST_OUTPUT_PER_1M || '0.40');
const COST_EMBED_PER_1M = parseFloat(process.env.BOOKS_COST_EMBED_PER_1M || '0.01');
const MONTHLY_BUDGET = parseFloat(process.env.BOOKS_MONTHLY_BUDGET || '10.00');

function getMonthKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function estimateCost(type, inputTokens, outputTokens) {
    if (type === 'embedding') {
        return (inputTokens / 1_000_000) * COST_EMBED_PER_1M;
    }
    return ((inputTokens / 1_000_000) * COST_INPUT_PER_1M) +
           ((outputTokens / 1_000_000) * COST_OUTPUT_PER_1M);
}

async function recordUsage(db, { type, inputTokens = 0, outputTokens = 0 }) {
    const cost = estimateCost(type, inputTokens, outputTokens);
    const monthKey = getMonthKey();
    const ref = db.collection(CRM_BOOK_USAGE).doc(monthKey);
    const callField = type === 'chat' ? 'chatCalls' :
                      type === 'summary' ? 'summaryCalls' : 'embedCalls';

    await ref.set({
        totalInputTokens: FieldValue.increment(inputTokens),
        totalOutputTokens: FieldValue.increment(outputTokens),
        estimatedCostUsd: FieldValue.increment(cost),
        [callField]: FieldValue.increment(1),
        budgetLimitUsd: MONTHLY_BUDGET,
        lastUpdated: FieldValue.serverTimestamp()
    }, { merge: true });
}

async function checkBudget(db) {
    const monthKey = getMonthKey();
    const snap = await db.collection(CRM_BOOK_USAGE).doc(monthKey).get();
    if (!snap.exists) {
        return { allowed: true, currentCostUsd: 0, budgetLimitUsd: MONTHLY_BUDGET, approved: false };
    }
    const data = snap.data();
    const currentCostUsd = data.estimatedCostUsd || 0;
    const budgetLimitUsd = data.budgetLimitUsd || MONTHLY_BUDGET;
    const approved = data.approved === true;
    const allowed = currentCostUsd < budgetLimitUsd || approved;
    return { allowed, currentCostUsd, budgetLimitUsd, approved };
}

async function approveOverage(db, adminEmail) {
    const monthKey = getMonthKey();
    const ref = db.collection(CRM_BOOK_USAGE).doc(monthKey);
    await ref.set({
        approved: true,
        approvedAt: FieldValue.serverTimestamp(),
        approvedBy: adminEmail,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        estimatedCostUsd: 0,
        chatCalls: 0,
        summaryCalls: 0,
        embedCalls: 0,
        budgetLimitUsd: MONTHLY_BUDGET,
        lastUpdated: FieldValue.serverTimestamp()
    }, { merge: false });
}

async function getUsageSummary(db) {
    const monthKey = getMonthKey();
    const snap = await db.collection(CRM_BOOK_USAGE).doc(monthKey).get();
    if (!snap.exists) {
        return {
            month: monthKey,
            estimatedCostUsd: 0,
            budgetLimitUsd: MONTHLY_BUDGET,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            chatCalls: 0,
            summaryCalls: 0,
            embedCalls: 0,
            approved: false
        };
    }
    const data = snap.data();
    return {
        month: monthKey,
        estimatedCostUsd: data.estimatedCostUsd || 0,
        budgetLimitUsd: data.budgetLimitUsd || MONTHLY_BUDGET,
        totalInputTokens: data.totalInputTokens || 0,
        totalOutputTokens: data.totalOutputTokens || 0,
        chatCalls: data.chatCalls || 0,
        summaryCalls: data.summaryCalls || 0,
        embedCalls: data.embedCalls || 0,
        approved: data.approved === true
    };
}

module.exports = { recordUsage, checkBudget, approveOverage, getUsageSummary };
