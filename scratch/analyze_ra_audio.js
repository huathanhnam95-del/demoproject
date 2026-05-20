const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

async function main() {
  const manifestPath = path.join(__dirname, '../public/database/RA/Voice/audio/manifest.json');
  const xlsxPath = path.join(__dirname, '../public/database/RA/RA.xlsx');
  const audioDir = path.join(__dirname, '../public/database/RA/Voice/audio');

  console.log('Loading manifest.json...');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const manifestKeys = Object.keys(manifest);
  console.log(`Manifest contains ${manifestKeys.length} question entries.`);

  console.log('Loading RA.xlsx...');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  const worksheet = workbook.worksheets[0];
  console.log(`Worksheet name: ${worksheet.name}`);

  // Let's print headers
  const headers = [];
  const headerRow = worksheet.getRow(1);
  headerRow.eachCell((cell, colNumber) => {
    headers[colNumber] = cell.value;
  });
  console.log('Headers:', headers.filter(Boolean));

  // Collect questions from XLSX
  const questions = {};
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const id = row.getCell(1).value; // ID is usually column 1
    const text = row.getCell(2).value; // Prompt or text is usually column 2
    // Let's inspect the first row columns to verify indices
    if (rowNumber === 2) {
      console.log('Row 2 Values:');
      row.eachCell((cell, colNumber) => {
        console.log(`Col ${colNumber} (${headers[colNumber]}): ${cell.value}`);
      });
    }
    if (id) {
      questions[String(id)] = {
        id: String(id),
        text: String(text || '').trim()
      };
    }
  });

  console.log(`Total questions in RA.xlsx: ${Object.keys(questions).length}`);

  // Count files in audio directory
  const filesOnDisk = new Set(fs.readdirSync(audioDir));
  console.log(`Total files in audio directory: ${filesOnDisk.size}`);

  // Let's check how many manifest file references are on disk
  let totalRefs = 0;
  let missingRefs = 0;
  let matchedRefs = 0;

  const missingFilesList = [];

  for (const qId of manifestKeys) {
    const entry = manifest[qId];
    // Check male & female
    for (const gender of ['male', 'female']) {
      const genderBlock = entry[gender];
      if (!genderBlock) continue;

      // New schema: check voices
      const voices = Object.keys(genderBlock).filter(k => k !== 'voiceId' && k !== 'voiceName' && k !== 'files');
      
      // If legacy files block exists
      if (genderBlock.files) {
        for (const speed of Object.keys(genderBlock.files)) {
          const filename = genderBlock.files[speed];
          totalRefs++;
          if (filesOnDisk.has(filename)) {
            matchedRefs++;
          } else {
            missingRefs++;
            missingFilesList.push({ qId, gender, voice: 'legacy', speed, filename });
          }
        }
      }

      // Check voices
      for (const voiceId of voices) {
        const voiceBlock = genderBlock[voiceId];
        if (voiceBlock && voiceBlock.files) {
          for (const speed of Object.keys(voiceBlock.files)) {
            const filename = voiceBlock.files[speed];
            totalRefs++;
            if (filesOnDisk.has(filename)) {
              matchedRefs++;
            } else {
              missingRefs++;
              missingFilesList.push({ qId, gender, voice: voiceId, speed, filename });
            }
          }
        }
      }
    }
  }

  console.log(`Total audio file references in manifest: ${totalRefs}`);
  console.log(`Matched references on disk: ${matchedRefs}`);
  console.log(`Missing references on disk: ${missingRefs}`);
  if (missingRefs > 0) {
    console.log('Sample missing references (first 10):');
    console.log(missingFilesList.slice(0, 10));
  }
}

main().catch(console.error);
