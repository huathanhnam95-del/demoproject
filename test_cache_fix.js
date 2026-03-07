const { computeOutlineCacheKey, computeBeatCacheKey, setCachedValue } = require('./src/services/reading-journey/cache');

console.log("Testing Cache Key Generation...");

const outlineId = "test-outline-id";
const language = "en";
const level = "A2";
const topicTags = ["health", "food"];

// Simulation of start-pre-generated logic
const outlineKey = computeOutlineCacheKey({ language, level, topicTags });
console.log("Outline Cache Key:", outlineKey);

// Simulation of advance logic
const beatNumber = 1;
const beatKey = computeBeatCacheKey({ outlineId, beatNumber });
console.log("Beat Cache Key:", beatKey);

// If they are strings, we are good. If they are [object Object], we failed.
if (typeof outlineKey === 'string' && !outlineKey.includes('[object Object]')) {
    console.log("SUCCESS: Outline Cache Key is a string.");
} else {
    console.error("FAILURE: Outline Cache Key is invalid:", outlineKey);
}

if (typeof beatKey === 'string' && !beatKey.includes('[object Object]')) {
    console.log("SUCCESS: Beat Cache Key is a string.");
} else {
    console.error("FAILURE: Beat Cache Key is invalid:", beatKey);
}
