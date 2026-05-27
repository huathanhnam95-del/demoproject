/* eslint-disable no-console */
const path = require('path');
const ExcelJS = require('exceljs');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const WORKBOOK_PATH = path.join(ROOT_DIR, 'public', 'database', 'SST', 'SST', 'SST.xlsx');

const revisions = {
  '457': [
    "Shell recorded a historic surge in underlying profits, reaching £7.2 billion in the first three months of the year.",
    "The profit increase was driven by rising global oil and gas prices, fueled by concerns over disruptions or boycotts of Russian energy supplies.",
    "Shell plans to return capital to shareholders while investing up to £25 billion in the UK over the next decade, focusing on renewables, low-carbon tech, and energy security.",
    "The UK government has resisted opposition calls to impose a windfall tax on these oil and gas profits."
  ],
  '535': [
    "Aquaculture—raising marine species in human-controlled environments—is predicted to be vital for future food security as wild ocean fish stocks decline.",
    "However, environmentalists criticize the practice as a major source of pollution due to the antibiotics and chemicals used to control diseases in fish farms.",
    "To address these concerns, the industry is actively developing environmentally friendly technologies, such as closed-containment systems, to isolate pollution from the ocean ecosystem."
  ],
  '552': [
    "Telescopes function as advanced tools for collecting and detecting light, acting as larger and more powerful extensions of human vision.",
    "The resolution and image sharpness are determined by the arrangement of lenses and mirrors, which can sometimes cause blurriness due to mirror imperfections.",
    "The term 'telescope' covers a wide range of instruments, with major differences in how light is collected across different frequency bands.",
    "Telescopes are highly valued in astronomy as digital detectors that are 100 times more efficient than the human eye."
  ],
  '658': [
    "Scientists published the first comprehensive inventory near the South Orkney Islands, identifying over 1,200 marine and land species.",
    "This discovery contradicts the belief that polar regions have lower biodiversity than tropical areas, finding more species here than in the Galapagos.",
    "The research documented numerous seabed species, including five that are entirely new to science.",
    "While the area's biodiversity has remained stable for 100 years with few invasive species, rapidly rising temperatures now pose a major threat."
  ]
};

async function main() {
  console.log('====================================================');
  console.log('   SST Remaining 4 Questions Final Revision Fixer');
  console.log('====================================================');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(WORKBOOK_PATH);
  const worksheet = workbook.worksheets[0];

  let updateCount = 0;

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const id = String(row.getCell(1).value || '').trim();
    
    if (revisions[id]) {
      const oldVal = row.getCell(4).value;
      const newValJson = JSON.stringify(revisions[id]);
      row.getCell(4).value = newValJson;
      console.log(`[UPDATE Q${id}] "${row.getCell(2).value}"`);
      console.log(`  Old: ${oldVal}`);
      console.log(`  New: ${newValJson}\n`);
      updateCount++;
    }
  });

  if (updateCount > 0) {
    await workbook.xlsx.writeFile(WORKBOOK_PATH);
    console.log(`Successfully updated and saved ${updateCount} questions in ${WORKBOOK_PATH}`);
  } else {
    console.log('No matching questions found to update.');
  }
}

main().catch(err => {
  console.error('Error fixing remaining questions:', err);
  process.exit(1);
});
