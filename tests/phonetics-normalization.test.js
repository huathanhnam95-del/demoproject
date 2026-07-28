const assert = require('assert');

global.window = {};
global.arpabetToIPA = require('../public/arpabet-ipa-map.js').arpabetToIPA;
global.fetch = async (url) => {
  const payload = String(url).includes('cmudict')
    ? {
        the: ['DH AH0'],
        but: ['B AH1 T'],
        of: ['AH1 V'],
        from: ['F R AH1 M'],
        "don't": ['D OW1 N T'],
        come: ['K AH1 M'],
        wonder: ['W AA1 N D ER0', 'W AH1 N D ER0']
      }
    : {
        the: ['/ˈðə/', '/ði/'],
        but: ['/ˈbət/'],
        of: ['/ˈəv/'],
        from: ['/ˈfrəm/'],
        "don't": ['/ˈdoʊn/', '/ˈdoʊnt/'],
        come: ['/ˈkəm/'],
        wonder: ['/ˈwəndɝ/']
      };
  return { ok: true, json: async () => payload };
};

require('../public/phonetics.js');

const { Phonetics } = global.window;
const { normalizeIPA } = Phonetics;

assert.equal(normalizeIPA('/ˈðə/', 'the'), '/ðə/');
assert.equal(normalizeIPA('ˈðə', 'the'), 'ðə');
assert.equal(normalizeIPA('/ˈbət/', 'but', { referenceIPA: '/bʌt/' }), '/bʌt/');
assert.equal(normalizeIPA('/ˈkəm/', 'come', { referenceIPA: '/kʌm/' }), '/kʌm/');
assert.equal(normalizeIPA('/ˈbət/', 'but'), '/bət/');
assert.equal(normalizeIPA('/ˈsəbˌweɪ/', 'subway'), '/ˈsəbˌweɪ/');
assert.equal(normalizeIPA('/ˈdeɪ/', 'day'), '/deɪ/');
assert.equal(normalizeIPA('/ˈbɔɪ/', 'boy'), '/bɔɪ/');
assert.equal(normalizeIPA('/ˈgoʊ/', 'go'), '/goʊ/');
assert.equal(
  normalizeIPA('/əbˈdəktɪd/', 'abducted', { referenceIPA: '/æˈbdʌktɪd/' }),
  '/əbˈdəktɪd/',
  'a local /dʌ/ match must not authorize a partial rewrite when the full source shape disagrees'
);
assert.equal(
  normalizeIPA('/ˈbəbˈdəb/', 'alignment', { referenceIPA: '/ˈbʌbˈdəb/' }),
  '/ˈbʌbˈdəb/',
  'only stressed-schwa positions backed by /ʌ/ in the aligned reference may change'
);

(async () => {
  Phonetics.clearCache();

  const the = await Phonetics.getIPAWithSource('the');
  assert.equal(the.ipa, '/ðə/');
  assert.deepEqual(the.alternatives, ['/ði/']);

  const but = await Phonetics.getIPAWithSource('but');
  assert.equal(but.ipa, '/bʌt/');

  const of = await Phonetics.getIPAWithSource('of');
  assert.equal(of.ipa, '/ʌv/');

  const from = await Phonetics.getIPAWithSource('from');
  assert.equal(from.ipa, '/frʌm/');

  const dont = await Phonetics.getIPAWithSource("don't");
  assert.equal(dont.ipa, '/doʊnt/', 'an apostrophized citation form should retain the CMU-backed final consonant');
  assert.deepEqual(dont.alternatives, ['/doʊn/']);

  const come = await Phonetics.getIPAWithSource('come');
  assert.equal(come.ipa, '/kʌm/');

  const wonder = await Phonetics.getIPAWithSource('wonder');
  assert.equal(wonder.ipa, '/ˈwʌndər/', 'a matching later CMU pronunciation should validate the repair');

  const ofForms = await Phonetics.getPronunciations('of');
  assert.deepEqual(ofForms.forms.map((form) => form.formRole), ['strong', 'weak', 'weak']);
  assert.equal(ofForms.selected.formRole, 'strong');
  assert.equal(ofForms.selected.ipa, '/ʌv/');
  assert.deepEqual(
    ofForms.forms.filter((form) => form.formRole === 'weak').map((form) => form.ipa),
    ['/əv/', '/ə/']
  );

  const andForms = await Phonetics.getPronunciations('and');
  assert.deepEqual(
    andForms.forms.filter((form) => form.formRole === 'weak').map((form) => form.ipa),
    ['/ən/', '/ənd/', '/n/', '/t/', '/d/']
  );

  const wereForms = await Phonetics.getPronunciations('were');
  assert.equal(wereForms.forms.find((form) => form.formRole === 'strong').ipa, '/wər/');

  const fromForms = await Phonetics.getPronunciations('from');
  assert.deepEqual(
    fromForms.forms.filter((form) => form.formRole === 'strong').map((form) => form.ipa),
    ['/frʌm/', '/frɑm/']
  );
  assert.deepEqual(
    fromForms.forms.filter((form) => form.formRole === 'weak').map((form) => form.ipa),
    ['/frəm/']
  );

  const connectedOf = await Phonetics.getPronunciations('of', { context: 'connectedSpeech' });
  assert.equal(connectedOf.selected.formRole, 'weak');
  assert.equal(connectedOf.selected.ipa, '/əv/');

  const theBeforeVowel = await Phonetics.getPronunciations('the', {
    context: 'connectedSpeech',
    nextSound: 'vowel'
  });
  assert.equal(theBeforeVowel.selected.formRole, 'weak');
  assert.equal(theBeforeVowel.selected.ipa, '/ði/');

  console.log('phonetics normalization tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
