/**
 * Pronunciation Analyzer Configuration
 * Centralized configuration for backend URL and feature flags
 */

export const config = {
    // Backend URL - Cloud Run (set to false to use localhost for local dev)
    forceCloudRun: false,

    backendUrl: (() => {
        const cloudRunUrl = 'https://praat-api-1071929245506.us-central1.run.app';

        // ALWAYS use Cloud Run if forceCloudRun is true
        // Access the forceCloudRun value from the outer scope
        const forceCloud = false; // Must match forceCloudRun above

        if (forceCloud) {
            return cloudRunUrl;
        }

        // For local development, set forceCloudRun to false
        if (window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1') {
            // Use local backend for testing on the SAME origin
            return `${window.location.protocol}//${window.location.hostname}:8081`;
        }
        return cloudRunUrl;
    })(),

    // Firestore Collection Names
    wordReferencesCollection: 'word_references',

    // Feature Flags
    features: {
        useNativeReference: true,
        showComparison: true,
        saveToDatabase: true,
        usePraatBackend: false
    },

    // Cache Settings
    sessionCacheEnabled: true
};
