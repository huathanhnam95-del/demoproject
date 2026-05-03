function tokenizeForAsqMatch(str) {
    return (str || '')
        .toLowerCase()
        .replace(/[^\w\s']/g, '')
        .split(/\s+/)
        .filter(Boolean);
}

function containsPhraseTokens(haystackTokens, needleTokens) {
    if (!Array.isArray(haystackTokens) || !Array.isArray(needleTokens)) return false;
    if (needleTokens.length === 0) return false;
    if (needleTokens.length === 1) return haystackTokens.includes(needleTokens[0]);
    if (haystackTokens.length < needleTokens.length) return false;

    for (let i = 0; i <= haystackTokens.length - needleTokens.length; i++) {
        let ok = true;
        for (let j = 0; j < needleTokens.length; j++) {
            if (haystackTokens[i + j] !== needleTokens[j]) {
                ok = false;
                break;
            }
        }
        if (ok) return true;
    }

    return false;
}

function scoreAsqTranscript(transcript, acceptedAnswers) {
    const transcriptText = String(transcript || '');
    const aliases = Array.isArray(acceptedAnswers) ? acceptedAnswers.map((v) => String(v || '')).filter(Boolean) : [];
    const transcriptTokens = tokenizeForAsqMatch(transcriptText);

    let matchedAlias = null;
    for (const alias of aliases) {
        const aliasTokens = tokenizeForAsqMatch(alias);
        if (containsPhraseTokens(transcriptTokens, aliasTokens)) {
            matchedAlias = alias;
            break;
        }
    }

    const accuracy = matchedAlias ? 1.0 : 0.0;
    const wordErrors = accuracy > 0 ? [] : (aliases.length > 0 ? [aliases[0]] : []);

    return {
        accuracy,
        matchedAlias,
        transcriptTokensCount: transcriptTokens.length,
        acceptedAliasCount: aliases.length,
        wordErrors
    };
}

module.exports = {
    tokenizeForAsqMatch,
    containsPhraseTokens,
    scoreAsqTranscript
};

