# How to Add Items to the Database

## Quick Start

To add a new question to either Type or Speak mode:

### Step 1: Add Audio File
1. Place your audio file (MP3 format recommended) in the appropriate folder:
   - **Type mode**: `database/type/audio/`
   - **Speak mode**: `database/speak/audio/`

### Step 2: Update Index JSON
1. Open the appropriate index file:
   - **Type mode**: `database/type/index.json`
   - **Speak mode**: `database/speak/index.json`

2. Add a new item to the `items` array:
```json
{
  "id": 2,
  "audioFile": "2.mp3",
  "correctSentence": "Your correct sentence here.",
  "category": "general"
}
```

3. Update the `totalItems` count to match the number of items in the array.

### Example

For Type mode, if you want to add question #2:

1. Add `2.mp3` to `database/type/audio/2.mp3`
2. Edit `database/type/index.json`:
```json
{
  "version": "1.0",
  "totalItems": 2,
  "items": [
    {
      "id": 1,
      "audioFile": "1.mp3",
      "correctSentence": "Next time, we'll discuss the influence of the media on public policy.",
      "category": "general"
    },
    {
      "id": 2,
      "audioFile": "2.mp3",
      "correctSentence": "The new policy will be implemented next month.",
      "category": "general"
    }
  ]
}
```

## Batch Adding Items

For adding many items (like 4000), you can:

1. **Use a script** to generate the JSON automatically
2. **Copy the structure** and increment IDs
3. **Use a JSON editor** that supports bulk operations

### JSON Structure Requirements

- `id`: Must be unique, sequential integers starting from 1
- `audioFile`: Filename only (not full path), must match the file in the audio folder
- `correctSentence`: The exact correct sentence for this audio
- `category`: Optional, can be used for filtering (e.g., "general", "business", "academic")

## Notes

- Audio files should be in MP3 format for best browser compatibility
- The `id` field must match the order (1, 2, 3, ...) and be unique
- Make sure the audio file name matches exactly what's in `audioFile`
- The correct sentence should match exactly what's spoken in the audio
- Both Type and Speak modes have separate databases - add items to both if you want the same questions in both modes

