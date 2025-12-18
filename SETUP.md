# Setup Instructions

## Backend Setup

### 1. Install Dependencies

```bash
npm install
```

This will install:
- `express` - Web server framework
- `cors` - CORS middleware
- `youtube-transcript` - Server-side YouTube transcript fetcher

### 2. Start the Server

```bash
npm start
```

The server will start on `http://localhost:3000` by default.

You can change the port by setting the `PORT` environment variable:
```bash
PORT=8080 npm start
```

### 3. Access the Application

Open your browser and navigate to:
- `http://localhost:3000`

## API Endpoints

### GET `/api/transcript?videoId=VIDEO_ID`

Fetches YouTube transcript for a given video ID.

**Example:**
```
GET http://localhost:3000/api/transcript?videoId=bjRpNYq8Ts0
```

**Response:**
```json
{
  "success": true,
  "videoId": "bjRpNYq8Ts0",
  "captions": [
    {
      "start": 0.0,
      "end": 2.5,
      "text": "Hello world"
    },
    {
      "start": 2.5,
      "end": 5.0,
      "text": "This is a test"
    }
  ],
  "count": 2
}
```

### GET `/api/health`

Health check endpoint to verify server is running.

## How It Works

1. **Frontend**: User enters a YouTube URL in the Vid tab
2. **Frontend**: Extracts video ID and embeds video using YouTube IFrame Player API
3. **Frontend**: Fetches transcript from backend API (`/api/transcript?videoId=...`)
4. **Backend**: Uses `youtube-transcript` library to fetch transcript server-side (no CORS issues)
5. **Frontend**: Receives transcript with timestamps
6. **Frontend**: Syncs transcript display with video playback time using YouTube IFrame API

## Troubleshooting

### Port Already in Use

If port 3000 is already in use, change it:
```bash
PORT=8080 npm start
```

### Transcript Not Available

- Make sure the video has captions enabled
- Check the browser console for error messages
- Verify the backend server is running

### CORS Errors

The backend includes CORS middleware, so this should not be an issue. If you see CORS errors:
- Make sure you're accessing the frontend from the same origin as the backend
- Check that the backend server is running

