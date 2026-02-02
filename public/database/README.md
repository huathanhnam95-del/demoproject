# Database Structure

This folder contains the database for Type and Speak modes.

## Structure

```
database/
├── type/
│   ├── index.json          # Metadata for all Type mode items
│   └── audio/              # Audio files for Type mode
│       ├── 1.mp3
│       ├── 2.mp3
│       └── ...
└── speak/
    ├── index.json          # Metadata for all Speak mode items
    └── audio/              # Audio files for Speak mode
        ├── 1.mp3
        ├── 2.mp3
        └── ...
```

## Adding New Items

### For Type Mode:
1. Add your audio file to `database/type/audio/` (e.g., `2.mp3`)
2. Edit `database/type/index.json` and add a new item:
```json
{
  "id": 2,
  "audioFile": "2.mp3",
  "correctSentence": "Your correct sentence here.",
  "category": "general"
}
```

### For Speak Mode:
1. Add your audio file to `database/speak/audio/` (e.g., `2.mp3`)
2. Edit `database/speak/index.json` and add a new item:
```json
{
  "id": 2,
  "audioFile": "2.mp3",
  "correctSentence": "Your correct sentence here.",
  "category": "general"
}
```

## Index JSON Format

```json
{
  "version": "1.0",
  "totalItems": 4000,
  "items": [
    {
      "id": 1,
      "audioFile": "1.mp3",
      "correctSentence": "The correct sentence for this audio.",
      "category": "general"
    }
  ]
}
```

## Notes

- Each mode (Type/Speak) has its own separate database
- Audio files should be in MP3 format (or update the code to support other formats)
- The `id` field should be unique and sequential
- The `category` field is optional and can be used for filtering/grouping

