const Excel = require('exceljs');
const path = require('path');

const xlsxPath = path.join(__dirname, '..', 'public', 'database', 'Highlight Incorrect Words', 'HIW', 'HIW.xlsx');

(async () => {
  console.log('Loading workbook:', xlsxPath);
  const workbook = new Excel.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  const sheet = workbook.worksheets[0];
  
  let updatedCount = 0;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const answer = row.getCell(3).value;
    if (!answer) return;
    
    // Replace __word1/word2__ with word1
    const cleanTranscript = String(answer).replace(/__([^_/]+)\/([^_/]+)__/g, '$1');
    row.getCell(4).value = cleanTranscript;
    updatedCount++;
  });
  
  await workbook.xlsx.writeFile(xlsxPath);
  console.log(`Successfully enriched Column D for ${updatedCount} rows.`);
})().catch(console.error);
