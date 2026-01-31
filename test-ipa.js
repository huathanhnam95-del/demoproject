
const { arpabetToIPA } = require('./arpabet-ipa-map.js');

const testWords = [
    { word: 'discuss', arpabet: 'D IH0 S K AH1 S' },
    { word: 'record (n)', arpabet: 'R EH1 K ER0 D' },
    { word: 'record (v)', arpabet: 'R IH0 K AO1 R D' },
    { word: 'about', arpabet: 'AH0 B AW1 T' },
    { word: 'banana', arpabet: 'B AH0 N AE1 N AH0' }
];

console.log('ARPABET to IPA test:');
testWords.forEach(({ word, arpabet }) => {
    const ipa = arpabetToIPA(arpabet);
    console.log(`${word.padEnd(12)} | ${arpabet.padEnd(15)} | ${ipa}`);
});
