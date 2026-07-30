const assert = require('assert');

const { classifyManifest } = require('../scripts/audit/stressed-schwa-classifier.js');

const result = classifyManifest({
  entries: [
    {
      type: 'UNVERIFIED_STRESSED_SCHWA',
      word: 'but',
      sourceIPA: '/ˈbət/',
      referenceVariants: ['/bʌt/']
    },
    {
      type: 'RESIDUAL_STRESSED_SCHWA',
      word: 'but',
      sourceIPA: '/ˈbət/',
      normalized: '/bət/'
    },
    {
      type: 'UNVERIFIED_STRESSED_SCHWA',
      word: 'hundred',
      sourceIPA: '/ˈhəndɝd/',
      referenceVariants: ['/ˈhʌndrəd/']
    },
    {
      type: 'DUPLICATE_NORMALIZED_VARIANT',
      word: 'be',
      normalized: '/bi/'
    },
    {
      type: 'DUPLICATE_NORMALIZED_VARIANT',
      word: 'be',
      normalized: '/bi/'
    },
    {
      type: 'UNVERIFIED_STRESSED_SCHWA',
      word: 'augustus',
      sourceIPA: '/əˈɡəstəs/',
      referenceVariants: []
    }
  ]
});

assert.deepEqual(result.summary, {
  inputFindings: 6,
  uniqueCases: 4,
  autoApprove: 1,
  merge: 1,
  exclude: 1,
  review: 1
});

const byKey = Object.fromEntries(result.entries.map((entry) => [entry.key, entry]));
assert.equal(byKey['but|/ˈbət/'].decision, 'approve');
assert.equal(byKey['but|/ˈbət/'].correctedIPA, '/bʌt/');
assert.equal(byKey['hundred|/ˈhəndɝd/'].decision, 'review');
assert.equal(byKey['be|/bi/'].decision, 'merge');
assert.equal(byKey['augustus|/əˈɡəstəs/'].decision, 'exclude');
assert.equal(byKey['be|/bi/'].findingTypes.length, 1);

const overridden = classifyManifest({
  entries: [
    {
      type: 'UNVERIFIED_STRESSED_SCHWA',
      word: 'abducted',
      sourceIPA: '/əbˈdəktɪd/',
      referenceVariants: ['/æˈbdʌktɪd/']
    },
    {
      type: 'RESIDUAL_STRESSED_SCHWA',
      word: 'abducted',
      sourceIPA: '/əbˈdəktɪd/',
      normalized: '/əbˈdəktɪd/'
    }
  ],
  reviewedDecisions: {
    abducted: { decision: 'approve', correctedIPA: '/æbˈdʌktɪd/' }
  }
});

assert.equal(overridden.entries[0].decision, 'approve');
assert.equal(overridden.entries[0].correctedIPA, '/æbˈdʌktɪd/');
assert.equal(overridden.summary.review, 0);

const inheritedKey = classifyManifest({
  entries: [
    {
      type: 'UNVERIFIED_STRESSED_SCHWA',
      word: 'constructor',
      sourceIPA: '/kənˈstrəktər/',
      referenceVariants: []
    }
  ],
  reviewedDecisions: {}
});

assert.equal(inheritedKey.entries[0].decision, 'review');

console.log('stressed-schwa classifier tests passed');
