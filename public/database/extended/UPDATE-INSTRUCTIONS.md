# How to Update Extended Listening Database

## Method 1: Using the Script (Recommended)

If you edited the Excel file (`LFIB.xlsx`):

1. **Open terminal/command prompt** in the project root directory (`C:\Cursor AI`)

2. **Run the update script:**
   ```bash
   node update-database.js database/extended/LFIB.xlsx extended
   ```

3. **The script will:**
   - Read your Excel file
   - Update the `index.json` file
   - Create a backup of the old file
   - Show you how many items were processed

4. **Refresh your browser** to see the changes

## Method 2: Manual JSON Editing

If you want to edit the JSON file directly:

### Step 1: Open the JSON file
- Navigate to: `database/extended/index.json`
- Open it in a text editor (VS Code, Notepad++, etc.)

### Step 2: Find the item you want to edit
- Search for the ID number (e.g., `"id": 1`)
- Find the `transcript` field

### Step 3: Edit the transcript
```json
{
  "id": 1,
  "audioFile": "1.mp3",
  "transcript": "Your edited transcript goes here",
  "category": "#1 Barred Owls"
}
```

### Step 4: Save the file
- Make sure the JSON is valid (no syntax errors)
- Save the file

### Step 5: Refresh your browser
- The changes will appear immediately

## Important Notes

- **Always backup** before editing manually
- **Check JSON syntax** - missing commas or quotes will break it
- **Audio file names** must match the ID (e.g., ID 1 → `1.mp3`)
- **Transcript field** is used for Extended Listening (not `correctSentence`)

## Quick Reference

**Excel Format:**
- Column 1: ID number
- Column 2: Category (optional)
- Column 3: Transcript text

**JSON Format:**
```json
{
  "id": 1,
  "audioFile": "1.mp3",
  "transcript": "Full transcript text here",
  "category": "Category name"
}
```

## Troubleshooting

**If the script doesn't work:**
- Make sure you're in the correct directory
- Check that `LFIB.xlsx` is in `database/extended/` folder
- Verify Node.js is installed: `node --version`

**If JSON has errors:**
- Use a JSON validator (online or in your editor)
- Check for missing commas between items
- Make sure all quotes are properly escaped
- Restore from backup if needed (files named `index.json.backup.*`)

