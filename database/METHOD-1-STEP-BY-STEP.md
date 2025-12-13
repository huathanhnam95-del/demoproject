# Method 1: Using the Node.js Script - Step by Step

This is the easiest and most reliable method to update your database from Excel files.

## Prerequisites

- Node.js installed on your computer
- Your Excel file ready (.xlsx format)
- Audio files already uploaded to the appropriate folders

## Step-by-Step Instructions

### Step 1: Install Node.js (If Not Already Installed)

1. Go to https://nodejs.org/
2. Download and install the LTS version
3. Verify installation by opening Command Prompt/PowerShell and typing:
   ```bash
   node --version
   ```
   You should see a version number (e.g., v18.17.0)

### Step 2: Install Dependencies

1. Open Command Prompt or PowerShell
2. Navigate to your project folder:
   ```bash
   cd "C:\Cursor AI"
   ```
3. Install the required package:
   ```bash
   npm install
   ```
   This will install the `xlsx` package needed to read Excel files.

### Step 3: Prepare Your Excel File

Make sure your Excel file has this structure:

| Column A (ID) | Column B (Category - optional) | Column C (Correct Sentence) |
|---------------|--------------------------------|----------------------------|
| 1             | general                        | Next time, we'll discuss the influence of the media on public policy. |
| 2             | business                       | The quarterly report shows significant growth in revenue. |
| 3             | academic                       | Research indicates that climate change affects global temperatures. |

**Important Notes:**
- **First row is header** - it will be skipped automatically
- **Column A (ID)**: Must be a number that matches your audio filename (1 → 1.mp3)
- **Column B (Category)**: Optional, can be left empty (defaults to "general")
- **Column C (Sentence)**: Required - the correct sentence for that audio

### Step 4: Run the Script

#### For Type Mode:
```bash
node update-database.js "path\to\your-file.xlsx" type
```

#### For Speak Mode:
```bash
node update-database.js "path\to\your-file.xlsx" speak
```

#### Examples:

**Example 1: Update Type mode with file in same folder**
```bash
node update-database.js questions.xlsx type
```

**Example 2: Update Speak mode with full path**
```bash
node update-database.js "C:\Users\YourName\Documents\questions-speak.xlsx" speak
```

**Example 3: Add items starting from ID 100**
```bash
node update-database.js questions.xlsx type 100
```

### Step 5: Verify the Results

The script will:
- Show you each item being processed
- Create a backup of your existing index.json
- Display a summary at the end

You should see output like:
```
Reading Excel file: questions.xlsx
Mode: type
Starting ID: 1
Found 1 existing items in database
Adding item ID 2: "The quarterly report shows significant growth..."
Adding item ID 3: "Research indicates that climate change..."
...
✅ Successfully updated database\type\index.json
   Total items: 3
   Items processed: 3
```

### Step 6: Refresh Your Browser

1. Open your app in the browser
2. The question selector dropdown should now show all your questions
3. Test by selecting different questions from the dropdown

## Using the Batch File (Windows - Even Easier!)

If you're on Windows, you can use the batch file for a simpler experience:

1. **Double-click** `update-database-simple.bat`
2. When prompted, enter:
   - Excel file path (or drag and drop the file)
   - Mode: `type` or `speak`
3. Press Enter

Or run from Command Prompt:
```bash
update-database-simple.bat "questions.xlsx" type
```

## Troubleshooting

### Error: "Cannot find module 'xlsx'"
**Solution:** Run `npm install` again

### Error: "Excel file not found"
**Solution:** 
- Use the full path to your Excel file
- Make sure the file path is in quotes if it has spaces
- Example: `node update-database.js "C:\My Files\questions.xlsx" type`

### Error: "Database directory not found"
**Solution:** 
- Make sure you're running the command from the project root folder (`C:\Cursor AI`)
- Check that `database/type/` and `database/speak/` folders exist

### Items not showing up
**Solution:**
- Check that audio files exist (e.g., `database/type/audio/1.mp3`)
- Verify the Excel file format (ID in column 1, sentence in column 3)
- Check the browser console for any errors
- Make sure you refreshed the browser

### Script runs but nothing changes
**Solution:**
- Check the backup file (`.backup.xxxxx`) to see what was there before
- Verify your Excel file has data starting from row 2 (row 1 is header)
- Make sure column 3 has the sentences

## Quick Reference

```bash
# Navigate to project folder
cd "C:\Cursor AI"

# Install dependencies (first time only)
npm install

# Update Type mode database
node update-database.js your-file.xlsx type

# Update Speak mode database
node update-database.js your-file.xlsx speak

# Add items starting from ID 100
node update-database.js your-file.xlsx type 100
```

## What Gets Updated?

The script updates:
- ✅ `database/type/index.json` (for Type mode)
- ✅ `database/speak/index.json` (for Speak mode)

The script does NOT:
- ❌ Move or copy audio files (you need to do this manually)
- ❌ Create audio files
- ❌ Delete existing items (unless you're updating them)

## Tips

1. **Always backup first**: The script creates automatic backups, but you can also manually copy `index.json` before running
2. **Test with small file first**: Try with 10-20 items before processing 4000 items
3. **Check audio files**: Make sure audio files (1.mp3, 2.mp3, etc.) exist before updating
4. **Keep IDs sequential**: It's easier to manage if IDs are 1, 2, 3, 4... rather than random numbers

## Need More Help?

- See `QUICK-UPDATE-GUIDE.md` for a quick overview
- See `database/EXCEL-TO-DATABASE-GUIDE.md` for alternative methods
- Check the script output for specific error messages

