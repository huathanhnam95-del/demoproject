# Excel to Database Guide

This guide explains how to update the database from Excel files.

## Quick Start

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Prepare Your Excel File

Your Excel file should have this structure:

| Column 1 (ID) | Column 2 (Category - optional) | Column 3 (Correct Sentence) |
|---------------|--------------------------------|----------------------------|
| 1             | general                        | Next time, we'll discuss the influence of the media on public policy. |
| 2             | business                       | The quarterly report shows significant growth in revenue. |
| 3             | academic                       | Research indicates that climate change affects global temperatures. |

**Important:**
- **Column 1**: ID number (must match audio filename, e.g., ID 1 → 1.mp3)
- **Column 2**: Category (optional, defaults to "general" if empty)
- **Column 3**: Correct sentence (required)
- **First row** is treated as header and will be skipped

### Step 3: Run the Script

```bash
# For Type mode
node update-database.js your-file.xlsx type

# For Speak mode
node update-database.js your-file.xlsx speak

# Start from a specific ID (useful for adding new items)
node update-database.js your-file.xlsx type 100
```

## Examples

### Example 1: Update Type Mode Database
```bash
node update-database.js questions-type.xlsx type
```

### Example 2: Update Speak Mode Database
```bash
node update-database.js questions-speak.xlsx speak
```

### Example 3: Add Items Starting from ID 100
```bash
node update-database.js new-questions.xlsx type 100
```

## What the Script Does

1. **Reads your Excel file** (first sheet)
2. **Extracts data** from columns 1 (ID) and 3 (sentence)
3. **Updates or adds items** to the appropriate `index.json` file
4. **Creates a backup** of the existing file (with timestamp)
5. **Sorts items** by ID
6. **Updates totalItems count**

## Manual Methods (Without Script)

### Method 1: Use Excel to JSON Converter Online

1. Go to an online Excel to JSON converter (e.g., https://www.convertcsv.com/csv-to-json.htm)
2. Export your Excel to CSV first
3. Convert CSV to JSON
4. Manually format the JSON to match the index.json structure
5. Copy items to the `items` array in `index.json`

### Method 2: Use Google Sheets + Apps Script

1. Upload your Excel to Google Sheets
2. Use this Apps Script to generate JSON:

```javascript
function generateJSON() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const data = sheet.getDataRange().getValues();
  
  const items = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][2]) {
      items.push({
        id: parseInt(data[i][0]),
        audioFile: `${data[i][0]}.mp3`,
        correctSentence: data[i][2],
        category: data[i][1] || "general"
      });
    }
  }
  
  const output = {
    version: "1.0",
    totalItems: items.length,
    items: items
  };
  
  Logger.log(JSON.stringify(output, null, 2));
  // Copy the output and paste into index.json
}
```

### Method 3: Use Python Script

If you prefer Python, create `update_database.py`:

```python
import json
import openpyxl
import sys

def update_database(excel_file, mode, start_id=1):
    # Load Excel
    wb = openpyxl.load_workbook(excel_file)
    ws = wb.active
    
    # Load existing JSON
    json_file = f'database/{mode}/index.json'
    with open(json_file, 'r') as f:
        data = json.load(f)
    
    items = data.get('items', [])
    
    # Process rows (skip header)
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row[0] or not row[2]:
            continue
        
        item_id = int(row[0])
        sentence = str(row[2]).strip()
        category = str(row[1]).strip() if row[1] else 'general'
        
        item = {
            'id': item_id,
            'audioFile': f'{item_id}.mp3',
            'correctSentence': sentence,
            'category': category
        }
        
        # Update or add
        existing = next((i for i in items if i['id'] == item_id), None)
        if existing:
            items[items.index(existing)] = item
        else:
            items.append(item)
    
    # Sort and update
    items.sort(key=lambda x: x['id'])
    data['items'] = items
    data['totalItems'] = len(items)
    
    # Save
    with open(json_file, 'w') as f:
        json.dump(data, f, indent=2)
    
    print(f"Updated {json_file} with {len(items)} items")

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python update_database.py <excel-file> <mode> [start-id]")
        sys.exit(1)
    
    excel_file = sys.argv[1]
    mode = sys.argv[2]
    start_id = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    
    update_database(excel_file, mode, start_id)
```

Install: `pip install openpyxl`

### Method 4: Use Excel Formulas + Manual Copy

1. In Excel, create a formula to generate JSON format:
   ```
   =CONCATENATE("{""id"":", A2, ",""audioFile"":""", A2, ".mp3"",""correctSentence"":""", C2, """,""category"":""general""}")
   ```
2. Copy the formula down for all rows
3. Copy the results
4. Manually format into the JSON array structure

## Tips

- **Always backup** your `index.json` files before updating
- **Test with a small file first** (10-20 items) before processing 4000 items
- **Verify audio files exist** - the script doesn't check if audio files are present
- **Keep IDs sequential** for easier management
- **Use categories** to organize questions (e.g., "business", "academic", "general")

## Troubleshooting

### Error: "Excel file not found"
- Make sure the file path is correct
- Use absolute path if relative path doesn't work: `node update-database.js "C:\full\path\to\file.xlsx" type`

### Error: "Cannot find module 'xlsx'"
- Run `npm install` to install dependencies

### Items not updating
- Check that IDs in Excel match existing IDs in JSON
- Check that column 3 has the sentences
- Make sure you're using the correct mode (type/speak)

### JSON syntax errors
- The script creates a backup - restore from backup if needed
- Check that all sentences are properly quoted (no unescaped quotes)

