export async function loadTestBank() {
  const response = await fetch('/pronunciation-test/test-bank.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Failed to load pronunciation test bank.');
  }

  const payload = await response.json();
  const hydrateSharedIPA = async (items) => {
    const source = Array.isArray(items) ? items : [];
    const phonetics = typeof window !== 'undefined' ? window.Phonetics : null;
    if (!phonetics || typeof phonetics.getIPA !== 'function') return source.slice();

    return Promise.all(source.map(async (item) => {
      try {
        const sharedIPA = await phonetics.getIPA(item.word);
        if (sharedIPA) {
          return {
            ...item,
            displayIpa: sharedIPA.replace(/^\/|\/$/g, '')
          };
        }
      } catch (_) {
        // Keep the bank's contrast-specific fallback when the shared lookup fails.
      }
      return { ...item };
    }));
  };

  const [practice, core, reserve] = await Promise.all([
    hydrateSharedIPA(payload?.practice),
    hydrateSharedIPA(payload?.core),
    hydrateSharedIPA(payload?.reserve)
  ]);

  return {
    contrastPriority: Array.isArray(payload?.contrastPriority) ? payload.contrastPriority.slice() : [],
    practice,
    core,
    reserve
  };
}

export function createInitialQueue(bank) {
  const practiceItems = Array.isArray(bank?.practice) ? bank.practice.slice(0, 1) : [];
  const coreItems = Array.isArray(bank?.core) ? bank.core.slice(0, 12) : [];
  return [...practiceItems, ...coreItems];
}

export function shouldRequestVowelHint(item) {
  return item?.category === 'vowel' && (item?.contrastId === 'vowel_i_ih' || item?.contrastId === 'vowel_e_ae');
}

export function summarizeContrasts(results, contrastPriority) {
  const buckets = new Map();

  for (const contrastId of contrastPriority) {
    buckets.set(contrastId, []);
  }

  for (const result of results) {
    if (!result || result.stage !== 'core') continue;
    if (!buckets.has(result.contrastId)) {
      buckets.set(result.contrastId, []);
    }
    if (typeof result.targetPhonemeAccuracyScore === 'number' && Number.isFinite(result.targetPhonemeAccuracyScore)) {
      buckets.get(result.contrastId).push(result.targetPhonemeAccuracyScore);
    }
  }

  const summaries = contrastPriority.map((contrastId) => {
    const scores = buckets.get(contrastId) || [];
    const meanScore = scores.length
      ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
      : null;

    return {
      contrastId,
      score: meanScore,
      validCount: scores.length,
      lowConfidence: scores.length <= 1
    };
  });

  return summaries;
}

export function selectAdaptiveItems(bank, results) {
  const summaries = summarizeContrasts(results, bank.contrastPriority || []);
  const orderMap = new Map((bank.contrastPriority || []).map((contrastId, index) => [contrastId, index]));
  const completedItemIds = new Set((results || []).map((result) => result?.itemId).filter(Boolean));
  const reservePool = Array.isArray(bank?.reserve) ? bank.reserve : [];

  const sorted = summaries.slice().sort((left, right) => {
    if (left.score === null && right.score !== null) return -1;
    if (left.score !== null && right.score === null) return 1;
    if (left.score !== right.score) return (left.score ?? -1) - (right.score ?? -1);
    if (left.lowConfidence !== right.lowConfidence) {
      return left.lowConfidence ? -1 : 1;
    }
    return (orderMap.get(left.contrastId) ?? 999) - (orderMap.get(right.contrastId) ?? 999);
  });

  const selectedContrasts = sorted.slice(0, 2).map((summary) => summary.contrastId);
  const adaptiveItems = [];
  const selectedItemIds = new Set(completedItemIds);

  const appendContrastItems = (contrastId) => {
    const picks = reservePool
      .filter((item) => item?.contrastId === contrastId && item?.id && !selectedItemIds.has(item.id))
      .slice(0, 2);

    for (const pick of picks) {
      selectedItemIds.add(pick.id);
      adaptiveItems.push(pick);
    }
  };

  for (const contrastId of selectedContrasts) {
    appendContrastItems(contrastId);
  }

  if (adaptiveItems.length < 4) {
    for (const summary of sorted) {
      if (selectedContrasts.includes(summary.contrastId)) continue;
      appendContrastItems(summary.contrastId);
      if (adaptiveItems.length >= 4) break;
    }
  }

  return {
    summaries,
    selectedContrasts,
    adaptiveItems: adaptiveItems.slice(0, 4)
  };
}
