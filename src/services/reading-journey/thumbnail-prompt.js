// src/services/reading-journey/thumbnail-prompt.js

function buildThumbnailPromptSpec(summary) {
    if (!summary) throw new Error('Scene summary is required');

    const subject = summary.characters && summary.characters.length > 0 
        ? summary.characters.join(' and ') 
        : 'A mysterious figure';
    
    const style = '3D animated movie style, vibrant colors, expressive lighting, highly detailed Pixar or Disney style, clean and family-friendly';
    const composition = 'Single focal subject, clean silhouette, easily readable at small size, center-safe subject placement';
    const camera = 'Mid-shot or wide-shot, eye-level angle, 16:9 cinematic framing';
    const lighting = 'Expressive cinematic lighting, rim light to separate subject from background, matching the mood';
    const negativeConstraints = [
        'No text', 'No letters', 'No UI elements', 'No watermarks', 'No speech bubbles', 
        'No gore', 'No explicit content', 'No split frames', 'No collages'
    ];
    const continuityAnchors = summary.keyProps || [];

    const promptText = `
Generate a ${style} illustration.
Subject: ${subject}
Action: ${summary.thumbnailMoment}
Environment: ${summary.setting}, time: ${summary.timeOfDay}
Mood/Tone: ${summary.emotionalTone}
Camera: ${camera}
Composition: ${composition}
Lighting: ${lighting}
MUST AVOID: ${negativeConstraints.join(', ')}
`.trim();

    return {
        promptText,
        subject,
        action: summary.thumbnailMoment,
        environment: summary.setting,
        style,
        composition,
        camera,
        lighting,
        negativeConstraints,
        continuityAnchors
    };
}

function buildThumbnailAuditSpec(summary) {
    if (!summary) throw new Error('Scene summary is required');

    const universalCriteria = [
        { id: 'u1', label: 'Legibility', severity: 'blocking', question: 'Is the main subject clearly visible and recognizable even if the image is scaled down to a small thumbnail size?' },
        { id: 'u2', label: 'Text Artifacts', severity: 'blocking', question: 'Does the image contain any embedded text, floating letters, numbers, or UI elements?' },
        { id: 'u3', label: 'Safety', severity: 'blocking', question: 'Is the image completely free of violent, explicit, or inappropriate content?' },
        { id: 'u4', label: 'Composition', severity: 'warning', question: 'Is the subject positioned gracefully within the frame without awkward cropping (center-safe)?' },
        { id: 'u5', label: 'Format', severity: 'blocking', question: 'Is it a single cohesive scene (no split frames, panels, or collages)?' }
    ];

    const storyCriteria = [];
    
    if (summary.characters && summary.characters.length > 0) {
        storyCriteria.push({
            id: 's1',
            label: 'Characters',
            severity: 'blocking',
            source: 'characters',
            question: `Does the image include the characters: ${summary.characters.join(', ')}?`
        });
    }

    if (summary.setting) {
        storyCriteria.push({
            id: 's2',
            label: 'Setting',
            severity: 'blocking',
            source: 'setting',
            question: `Does the image accurately portray the setting: ${summary.setting}?`
        });
    }

    if (summary.thumbnailMoment) {
        storyCriteria.push({
            id: 's3',
            label: 'Action',
            severity: 'warning',
            source: 'thumbnailMoment',
            question: `Does the image show or relate to the action: ${summary.thumbnailMoment}?`
        });
    }

    if (summary.emotionalTone) {
        storyCriteria.push({
            id: 's4',
            label: 'Tone',
            severity: 'warning',
            source: 'emotionalTone',
            question: `Does the mood feel ${summary.emotionalTone}?`
        });
    }

    const blockingFailures = ['u2', 'u3', 'u5']; 
    
    return {
        universalCriteria,
        storyCriteria,
        blockingFailures,
        repairInstructions: 'If any criteria fail, provide a targeted prompt delta to fix the issue without altering the successful parts.'
    };
}

module.exports = {
    buildThumbnailPromptSpec,
    buildThumbnailAuditSpec
};
