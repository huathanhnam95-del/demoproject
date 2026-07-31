const assert = require('assert');

global.window = {};
global.arpabetToIPA = require('../public/arpabet-ipa-map.js').arpabetToIPA;

global.fetch = async (url) => {
  const target = String(url);
  if (target.includes('oxford-american-ipa')) {
    return {
      ok: true,
      json: async () => ({
        entries: {
          analyse: ['/ˈænlˌaɪz/'],
          'according to': ['/əˈkɔrdɪŋ tu/', '/əˈkɔrdɪŋ tə/'],
          antidumping: ['/ˌæntaɪˈdʌmpɪŋ/']
        },
        formProfiles: {
          'according to': {
            strong: '/əˈkɔrdɪŋ tu/',
            weak: [{ ipa: '/əˈkɔrdɪŋ tə/', condition: { nextSound: 'consonant' } }]
          }
        },
        quarantine: ['augustus']
      })
    };
  }
  if (target.includes('cmudict')) {
    // CMU knows this word. Quarantine must still win, or a word removed from
    // the learner dictionary silently reappears via the fallback.
    return { ok: true, json: async () => ({ augustus: ['AO0 G AH1 S T AH0 S'] }) };
  }
  return {
    ok: true,
    json: async () => ({
      augustus: ['/ɑˈɡəstəs/']
    })
  };
};

require('../public/phonetics.js');

(async () => {
  const { Phonetics } = global.window;
  Phonetics.clearCache();

  const analyse = await Phonetics.getIPAWithSource('analyse');
  assert.equal(analyse.ipa, '/ˈænlˌaɪz/');
  assert.equal(analyse.source, 'oxford-american');

  const antidumping = await Phonetics.getIPAWithSource('antidumping');
  assert.equal(antidumping.ipa, '/ˌæntaɪˈdʌmpɪŋ/');
  assert.equal(antidumping.source, 'oxford-american');

  const accordingTo = await Phonetics.getPronunciations('according to', {
    context: 'connectedSpeech',
    nextSound: 'consonant'
  });
  assert.deepEqual(accordingTo.forms.map((form) => form.formRole), ['strong', 'weak']);
  // Authored form profiles are rendered in Oxford notation too.
  assert.equal(accordingTo.selected.ipa, '/əˈkɔːrdɪŋ tə/');
  assert.equal(
    accordingTo.forms.find((form) => form.formRole === 'strong').ipa,
    '/əˈkɔːrdɪŋ tuː/'
  );

  const quarantined = await Phonetics.getIPAWithSource('augustus');
  assert.deepEqual(quarantined, {
    ipa: '',
    alternatives: [],
    source: null,
    isApproximate: false
  });

  console.log('Oxford-American phonetics override tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
