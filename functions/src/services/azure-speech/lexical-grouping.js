'use strict';

/**
 * Lexical Grouping Service
 * Plan V3 §10:
 * Multi-word currency and numerical expression grouping.
 * Resolves alignments where a single written reference token (e.g. "$35,000", "$1.15 trillion")
 * expands into multiple spoken words ("thirty-five thousand dollars").
 * Preserves individual word acoustic spans while binding them to the reference unit.
 */

// Regular expression matching common currency expressions ($35,000, $1.15 trillion, €50 million, £100, etc.)
const CURRENCY_PATTERN = /^([$€£¥])\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(trillion|billion|million|thousand)?$/i;

const CURRENCY_NAMES = {
  '$': 'dollars',
  '€': 'euros',
  '£': 'pounds',
  '¥': 'yen'
};

const NUMBER_WORDS = {
  0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five',
  6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten',
  11: 'eleven', 12: 'twelve', 13: 'thirteen', 14: 'fourteen', 15: 'fifteen',
  16: 'sixteen', 17: 'seventeen', 18: 'eighteen', 19: 'nineteen',
  20: 'twenty', 30: 'thirty', 40: 'forty', 50: 'fifty',
  60: 'sixty', 70: 'seventy', 80: 'eighty', 90: 'ninety'
};

/**
 * Checks if a token is a formatted currency expression.
 */
function isCurrencyExpression(token) {
  if (typeof token !== 'string') return false;
  return CURRENCY_PATTERN.test(token.trim());
}

/**
 * Expands an integer < 1000 into words.
 */
function numberToWordsLessThanThousand(num) {
  const parts = [];
  if (num >= 100) {
    parts.push(NUMBER_WORDS[Math.floor(num / 100)], 'hundred');
    num %= 100;
  }
  if (num >= 20) {
    const tens = Math.floor(num / 10) * 10;
    const units = num % 10;
    if (units > 0) {
      parts.push(`${NUMBER_WORDS[tens]}-${NUMBER_WORDS[units]}`);
    } else {
      parts.push(NUMBER_WORDS[tens]);
    }
  } else if (num > 0) {
    parts.push(NUMBER_WORDS[num]);
  }
  return parts;
}

/**
 * Expands an integer into words.
 */
function integerToWords(num) {
  if (num === 0) return ['zero'];
  const parts = [];
  const billion = Math.floor(num / 1000000000);
  num %= 1000000000;
  const million = Math.floor(num / 1000000);
  num %= 1000000;
  const thousand = Math.floor(num / 1000);
  num %= 1000;

  if (billion > 0) {
    parts.push(...numberToWordsLessThanThousand(billion), 'billion');
  }
  if (million > 0) {
    parts.push(...numberToWordsLessThanThousand(million), 'million');
  }
  if (thousand > 0) {
    parts.push(...numberToWordsLessThanThousand(thousand), 'thousand');
  }
  if (num > 0) {
    parts.push(...numberToWordsLessThanThousand(num));
  }
  return parts;
}

/**
 * Expands a currency token into candidate spoken words.
 * e.g. "$35,000" -> ["thirty-five", "thousand", "dollars"]
 * e.g. "$1.15 trillion" -> ["one", "point", "one", "five", "trillion", "dollars"]
 */
function expandCurrencyToken(token) {
  const match = String(token || '').trim().match(CURRENCY_PATTERN);
  if (!match) return [token];

  const symbol = match[1];
  const numStr = match[2].replace(/,/g, '');
  const magnitude = match[3] ? match[3].toLowerCase() : null;
  const currencyName = CURRENCY_NAMES[symbol] || 'dollars';

  const words = [];
  if (numStr.includes('.')) {
    const [whole, decimal] = numStr.split('.');
    const wholeNum = parseInt(whole, 10) || 0;
    words.push(...integerToWords(wholeNum));
    words.push('point');
    for (const d of decimal) {
      const digitNum = parseInt(d, 10);
      words.push(NUMBER_WORDS[digitNum] || d);
    }
  } else {
    const wholeNum = parseInt(numStr, 10) || 0;
    words.push(...integerToWords(wholeNum));
  }

  if (magnitude) {
    words.push(magnitude);
  }

  words.push(currencyName);
  return words;
}

/**
 * Groups consecutive normalized words matching an expanded currency expression.
 *
 * @param {Array<Object>} normalizedWords - The normalized words from Azure assessment
 * @param {Array<string>} referenceTokens - Original reference tokens
 * @returns {Array<Object>} Words array with lexical grouping metadata attached
 */
function groupLexicalExpressions(normalizedWords = [], referenceTokens = []) {
  if (!Array.isArray(normalizedWords) || normalizedWords.length === 0) {
    return normalizedWords;
  }

  const clean = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  let wordIndex = 0;
  const result = [];

  for (let rIdx = 0; rIdx < referenceTokens.length; rIdx++) {
    const refToken = referenceTokens[rIdx];
    if (isCurrencyExpression(refToken)) {
      const expectedWords = expandCurrencyToken(refToken);
      const matchedWords = [];

      // Look ahead in normalizedWords for matching subsequence
      let lookahead = wordIndex;
      let matched = true;
      for (const expected of expectedWords) {
        if (lookahead < normalizedWords.length && clean(normalizedWords[lookahead].word) === clean(expected)) {
          matchedWords.push(normalizedWords[lookahead]);
          lookahead++;
        } else {
          matched = false;
          break;
        }
      }

      if (matched && matchedWords.length > 0) {
        // Enclose grouping into words
        const first = matchedWords[0];
        const last = matchedWords[matchedWords.length - 1];
        const groupGroupId = `lex-grp-${rIdx}`;

        matchedWords.forEach((w, offset) => {
          result.push({
            ...w,
            lexicalGroup: {
              groupId: groupGroupId,
              referenceToken: refToken,
              isGroupLead: offset === 0,
              groupWordCount: matchedWords.length,
              groupStartMs: first.startMs,
              groupEndMs: last.endMs,
              groupSpan: (first.clipSpan && last.clipSpan) ? {
                startSample: first.clipSpan.startSample,
                endSample: last.clipSpan.endSample
              } : null
            }
          });
        });
        wordIndex = lookahead;
        continue;
      }
    }

    if (wordIndex < normalizedWords.length) {
      result.push(normalizedWords[wordIndex]);
      wordIndex++;
    }
  }

  // Push any remaining words
  while (wordIndex < normalizedWords.length) {
    result.push(normalizedWords[wordIndex]);
    wordIndex++;
  }

  return result;
}

module.exports = {
  isCurrencyExpression,
  expandCurrencyToken,
  groupLexicalExpressions
};
