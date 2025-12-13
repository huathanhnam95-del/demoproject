# Quick Guide: Update Database from Excel

## For Me (AI) to Process Your Excel File

When you provide an Excel file, I will:
1. Read the file structure (Column 1 = ID, Column 3 = Sentence)
2. Update the appropriate `database/type/index.json` or `database/speak/index.json`
3. Create backups before making changes
4. Show you what was updated

**Just provide:**
- The Excel file
- Which mode (Type or Speak)
- Any special instructions (e.g., start from ID 100)

## For You to Do It Yourself

### Option 1: Use the Node.js Script (Recommended)

**First time setup:**
```bash
npm install
```

**Then run:**
```bash
# For Type mode
node update-database.js your-file.xlsx type

# For Speak mode  
node update-database.js your-file.xlsx speak
```

**Or use the batch file (Windows):**
```bash
update-database-simple.bat your-file.xlsx type
```

### Option 2: Use Online Tools

1. **Convert Excel to JSON online:**
   - Go to https://www.convertcsv.com/excel-to-json.htm
   - Upload your Excel file
   - Download JSON
   - Manually format to match index.json structure

2. **Use Google Sheets:**
   - Upload Excel to Google Sheets
   - Use the Apps Script provided in `database/EXCEL-TO-DATABASE-GUIDE.md`
   - Copy generated JSON to index.json

### Option 3: Manual Entry (Small batches)

For small updates (< 50 items), you can manually edit `database/type/index.json` or `database/speak/index.json`:

```json
{
  "version": "1.0",
  "totalItems": 2,
  "items": [
    {
      "id": 1,
      "audioFile": "1.mp3",
      "correctSentence": "Your sentence here",
      "category": "general"
    },
    {
      "id": 2,
      "audioFile": "2.mp3",
      "correctSentence": "Another sentence here",
      "category": "general"
    }
  ]
}
```

## Excel File Format

Your Excel file should look like this:

| ID | Category (optional) | Correct Sentence |
|----|---------------------|------------------|
| 1  | general             | Next time, we'll discuss the influence... |
| 2  | business            | The quarterly report shows... |
| 3  | academic            | Research indicates that... |

**Important:**
- **Column 1**: ID (must match audio filename: 1 → 1.mp3)
- **Column 2**: Category (optional, defaults to "general")
- **Column 3**: Correct sentence (required)
- **First row** is header (will be skipped)

## Next Steps After Update

1. **Verify audio files exist:**
   - Check that `database/type/audio/1.mp3`, `2.mp3`, etc. exist
   - Or `database/speak/audio/1.mp3`, `2.mp3`, etc. for speak mode

2. **Refresh browser:**
   - The question selector will automatically show new questions
   - No need to restart the server

3. **Test a few questions:**
   - Select different questions from the dropdown
   - Verify audio plays correctly
   - Check that sentences match

## Need Help?

- See `database/EXCEL-TO-DATABASE-GUIDE.md` for detailed instructions
- See `database/README.md` for database structure overview
- See `database/HOW-TO-ADD-ITEMS.md` for manual addition guide

