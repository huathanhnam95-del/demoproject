/**
 * Script to update database index.json files from Excel file
 * 
 * Usage:
 *   node update-database.js <excel-file> <mode> [start-id]
 * 
 * Examples:
 *   node update-database.js questions.xlsx type
 *   node update-database.js questions.xlsx speak
 *   node update-database.js questions.xlsx extended
 *   node update-database.js questions.xlsx type 100  (starts from ID 100)
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Get command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: node update-database.js <excel-file> <mode> [start-id]');
  console.error('  excel-file: Path to Excel file (.xlsx)');
  console.error('  mode: "type", "speak", or "extended"');
  console.error('  start-id: (optional) Starting ID number (default: 1)');
  process.exit(1);
}

const excelFile = args[0];
const mode = args[1].toLowerCase();
const startId = args[2] ? parseInt(args[2], 10) : 1;

if (mode !== 'type' && mode !== 'speak' && mode !== 'extended') {
  console.error('Error: mode must be "type", "speak", or "extended"');
  process.exit(1);
}

if (!fs.existsSync(excelFile)) {
  console.error(`Error: Excel file not found: ${excelFile}`);
  process.exit(1);
}

// Paths
const databaseDir = path.join(__dirname, 'database', mode);
const indexFile = path.join(databaseDir, 'index.json');

if (!fs.existsSync(databaseDir)) {
  console.error(`Error: Database directory not found: ${databaseDir}`);
  process.exit(1);
}

console.log(`Reading Excel file: ${excelFile}`);
console.log(`Mode: ${mode}`);
console.log(`Starting ID: ${startId}`);

try {
  // Read Excel file
  const workbook = XLSX.readFile(excelFile);
  const sheetName = workbook.SheetNames[0]; // Use first sheet
  const worksheet = workbook.Sheets[sheetName];
  
  // Convert to JSON (array of arrays)
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  
  if (data.length < 2) {
    console.error('Error: Excel file must have at least a header row and one data row');
    process.exit(1);
  }
  
  // Load existing index.json
  let existingItems = [];
  if (fs.existsSync(indexFile)) {
    const existingData = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    existingItems = existingData.items || [];
    console.log(`Found ${existingItems.length} existing items in database`);
  }
  
  // Process rows (skip header row)
  const newItems = [];
  let currentId = startId;
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    
    // Skip empty rows
    if (!row || row.length === 0 || (!row[0] && !row[2])) {
      continue;
    }
    
    // Get ID from column 1 (index 0) or use currentId
    const rowId = row[0] ? parseInt(row[0], 10) : currentId;
    
    // Get sentence from column 3 (index 2)
    const sentence = row[2] ? String(row[2]).trim() : '';
    
    if (!sentence) {
      console.warn(`Warning: Row ${i + 1} has no sentence, skipping...`);
      continue;
    }
    
    // Check if item with this ID already exists
    const existingIndex = existingItems.findIndex(item => item.id === rowId);
    
    // For extended mode, use "transcript" field; for type/speak, use "correctSentence"
    const item = mode === 'extended' ? {
      id: rowId,
      audioFile: `${rowId}.mp3`,
      transcript: sentence,
      category: row[1] ? String(row[1]).trim() : 'general'
    } : {
      id: rowId,
      audioFile: `${rowId}.mp3`,
      correctSentence: sentence,
      category: row[1] ? String(row[1]).trim() : 'general'
    };
    
    if (existingIndex >= 0) {
      // Update existing item
      console.log(`Updating item ID ${rowId}: "${sentence.substring(0, 50)}..."`);
      existingItems[existingIndex] = item;
    } else {
      // Add new item
      console.log(`Adding item ID ${rowId}: "${sentence.substring(0, 50)}..."`);
      existingItems.push(item);
    }
    
    currentId = rowId + 1;
  }
  
  // Sort items by ID
  existingItems.sort((a, b) => a.id - b.id);
  
  // Create updated index.json
  const updatedData = {
    version: "1.0",
    totalItems: existingItems.length,
    items: existingItems
  };
  
  // Backup existing file
  if (fs.existsSync(indexFile)) {
    const backupFile = indexFile + '.backup.' + Date.now();
    fs.copyFileSync(indexFile, backupFile);
    console.log(`Backup created: ${backupFile}`);
  }
  
  // Write updated index.json
  fs.writeFileSync(indexFile, JSON.stringify(updatedData, null, 2), 'utf8');
  
  console.log(`\n✅ Successfully updated ${indexFile}`);
  console.log(`   Total items: ${existingItems.length}`);
  console.log(`   Items processed: ${newItems.length + (existingItems.length - newItems.length)}`);
  console.log(`\nNext steps:`);
  console.log(`   1. Make sure audio files are in: ${path.join(databaseDir, 'audio')}`);
  console.log(`   2. Audio files should be named: 1.mp3, 2.mp3, etc.`);
  console.log(`   3. Refresh your browser to see the updated questions`);
  
} catch (error) {
  console.error('Error processing Excel file:', error.message);
  console.error(error.stack);
  process.exit(1);
}

