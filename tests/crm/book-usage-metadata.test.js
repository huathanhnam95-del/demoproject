/* eslint-disable no-console */
const assert = require('assert');

const { extractUsage: extractChatUsage } = require('../../functions/src/crm/book-chat-service');
const { extractUsage: extractSummaryUsage } = require('../../functions/src/crm/book-summary-service');

const vertexResult = {
    response: {
        usageMetadata: {
            promptTokenCount: 321,
            candidatesTokenCount: 123
        }
    }
};

assert.deepStrictEqual(
    extractChatUsage(vertexResult),
    { inputTokens: 321, outputTokens: 123 },
    'chat usage must read the Vertex response envelope'
);
assert.deepStrictEqual(
    extractSummaryUsage(vertexResult),
    { inputTokens: 321, outputTokens: 123 },
    'summary usage must read the Vertex response envelope'
);
assert.deepStrictEqual(
    extractChatUsage({ usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 4 } }),
    { inputTokens: 7, outputTokens: 4 },
    'chat usage must preserve compatibility with direct usage metadata'
);

console.log('book usage metadata contracts passed');
