# Deployment Guide

This guide explains how to deploy the application to GitHub Pages or other hosting services.

## Current Architecture

The application has two parts:
1. **Frontend** (HTML/CSS/JS) - Can be deployed to GitHub Pages
2. **Backend** (Python Flask) - Needs a separate hosting service

## Deployment Options

### Option 1: Deploy Backend to Cloud Service (Recommended)

Deploy the backend to a free cloud service, then update the frontend to use that URL.

#### A. Using Render (Free Tier Available)

1. **Create account** at [render.com](https://render.com)

2. **Create a new Web Service**:
   - Connect your GitHub repository
   - Select the `backend` folder as root directory
   - Build command: `pip install -r requirements.txt`
   - Start command: `python app.py`
   - Environment: Python 3

3. **Get your backend URL** (e.g., `https://your-app.onrender.com`)

4. **Update frontend** - Add this to `index.html` before `</body>`:
   ```html
   <script>
     // Set your backend URL here
     window.PARAPHRASE_API_URL = 'https://your-app.onrender.com';
   </script>
   ```

#### B. Using Railway (Free Tier Available)

1. **Create account** at [railway.app](https://railway.app)

2. **Create new project** → Deploy from GitHub

3. **Configure**:
   - Root directory: `backend`
   - Build command: `pip install -r requirements.txt`
   - Start command: `python app.py`

4. **Get your backend URL** and update `index.html` as above

#### C. Using Heroku (Free Tier Discontinued, Paid Only)

1. Create `Procfile` in `backend/`:
   ```
   web: python app.py
   ```

2. Deploy:
   ```bash
   cd backend
   heroku create your-app-name
   git push heroku main
   ```

### Option 2: Make Keywords Feature Optional

If you don't want to deploy a backend, you can make the Keywords feature gracefully degrade:

The code already handles connection errors. You can hide the Keywords section entirely if the backend isn't available.

### Option 3: Use Serverless Functions

Deploy the paraphrase logic as serverless functions:
- **Vercel**: Create `api/paraphrase.py` as a serverless function
- **Netlify**: Create `netlify/functions/paraphrase.py`

## Step-by-Step: Render Deployment

### 1. Prepare Backend for Deployment

Create `backend/Procfile`:
```
web: python app.py
```

Update `backend/app.py` to use environment variable for port:
```python
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=False, port=port, host='0.0.0.0')
```

### 2. Deploy to Render

1. Go to [render.com](https://render.com)
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Configure:
   - **Name**: `dictation-paraphrase-backend`
   - **Root Directory**: `backend`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python app.py`
5. Click "Create Web Service"
6. Wait for deployment (first time: 5-10 minutes for model downloads)

### 3. Update Frontend

In `index.html`, add before `</body>`:
```html
<script>
  // Production backend URL
  window.PARAPHRASE_API_URL = 'https://your-app-name.onrender.com';
  
  // Or keep localhost for development:
  // window.PARAPHRASE_API_URL = 'http://localhost:5000';
</script>
```

### 4. Deploy Frontend to GitHub Pages

1. Push your code to GitHub
2. Go to repository Settings → Pages
3. Select branch (usually `main` or `gh-pages`)
4. Your site will be at: `https://yourusername.github.io/repository-name`

## Environment-Specific Configuration

For different environments, you can use:

```javascript
// In index.html
<script>
  // Auto-detect environment
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    // Development
    window.PARAPHRASE_API_URL = 'http://localhost:5000';
  } else {
    // Production
    window.PARAPHRASE_API_URL = 'https://your-backend-url.onrender.com';
  }
</script>
```

## Testing

1. **Local testing**: Start backend locally, frontend should work
2. **Production testing**: Deploy backend, update URL, test on GitHub Pages

## Notes

- **Free tier limitations**: Render/Railway free tiers may have cold starts (first request takes 30-60 seconds)
- **Model size**: The AI models are ~500MB, so first deployment takes time
- **CORS**: The backend already has CORS enabled, so it should work from any domain
- **Database files**: Make sure `database/` folder is included in your GitHub repository

## Troubleshooting

- **CORS errors**: Check that `flask-cors` is installed and `CORS(app)` is in `app.py`
- **Connection refused**: Verify backend URL is correct
- **Slow first request**: Normal on free tiers due to cold starts
- **Models not loading**: Check backend logs for download errors

