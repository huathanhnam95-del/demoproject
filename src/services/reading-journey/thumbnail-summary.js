const gemini = require('./gemini');
const { buildThumbnailSceneSummary: buildContract } = require('./thumbnail-contracts');

/**
 * Consumes outline metadata and generated beats, then produces
 * a validated ThumbnailSceneSummary contract object.
 */
async function buildThumbnailSceneSummary({ outline, beats, title, logline }) {
    if (!outline) throw new Error('outline is required');
    if (!beats || !Array.isArray(beats)) throw new Error('beats array is required');

    // Use passed metadata overriding outline defaults if provided,
    // though the Gemini prompt primarily uses outline object properties.
    const effectiveOutline = {
        ...outline,
        title: title || outline.title,
        logline: logline || outline.logline || outline.premise
    };

    // Call the newly added generator in gemini.js
    const aiResponse = await gemini.generateThumbnailSceneSummaryJson({
        outline: effectiveOutline,
        beats
    });

    // Enforce fallbacks if the model omits fields
    const safeData = {
        storyId: outline.id || effectiveOutline.id || 'unknown',
        outlineId: outline.id || effectiveOutline.id || 'unknown',
        title: effectiveOutline.title || 'Unknown Title',
        logline: effectiveOutline.logline || '',
        thumbnailMoment: aiResponse.thumbnailMoment || 'A scene from the story.',
        characters: Array.isArray(aiResponse.characters) ? aiResponse.characters : [],
        setting: aiResponse.setting || effectiveOutline.setting || 'A generic location',
        timeOfDay: aiResponse.timeOfDay || 'daylight',
        keyProps: Array.isArray(aiResponse.keyProps) ? aiResponse.keyProps : [],
        emotionalTone: aiResponse.emotionalTone || 'neutral',
        
        // Force fallback heuristics for spoilerLevel
        // Should default to safe_story_detail if missing
        spoilerLevel: ['safe_library', 'safe_story_detail', 'full'].includes(aiResponse.spoilerLevel) 
            ? aiResponse.spoilerLevel 
            : 'safe_story_detail',
            
        sourceBeats: Array.isArray(aiResponse.sourceBeats) ? aiResponse.sourceBeats : []
    };

    // Just to ensure at least one mapped beat if it couldn't map exactly
    if (safeData.sourceBeats.length === 0 && beats.length > 0) {
        safeData.sourceBeats.push(beats[0].id || 'beat-1');
    }

    // Rely on the contract to throw if it's deeply invalid
    return buildContract(safeData);
}

module.exports = {
    buildThumbnailSceneSummary
};
