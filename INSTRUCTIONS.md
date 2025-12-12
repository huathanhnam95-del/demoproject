# Setting Up HTTPS Server

## Step 1: Refresh Your Terminal/IDE

Since you just installed Python, you need to **restart your terminal or IDE** (Cursor) to refresh the PATH environment variable.

**Close and reopen Cursor**, or close and reopen your terminal window.

## Step 2: Create SSL Certificates

You have two options:

### Option A: Using mkcert (Easiest - Recommended)

1. Download mkcert:
   - Go to: https://github.com/FiloSottile/mkcert/releases
   - Download `mkcert-v1.4.4-windows-amd64.exe` (or latest)
   - Save it in `C:\Cursor AI\` folder

2. Open PowerShell in your project folder and run:
   ```powershell
   .\mkcert-v1.4.4-windows-amd64.exe -install
   .\mkcert-v1.4.4-windows-amd64.exe localhost
   ```

3. Rename files:
   ```powershell
   ren localhost.pem cert.pem
   ren localhost-key.pem key.pem
   ```

### Option B: Using OpenSSL (if you have Git Bash)

1. Open Git Bash in your project folder
2. Run:
   ```bash
   openssl req -x509 -newkey rsa:4096 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=localhost"
   ```

## Step 3: Start the Server

After restarting Cursor/terminal and creating certificates:

**Option 1: Use the batch file**
```cmd
setup-and-run.bat
```

**Option 2: Manual start**
```cmd
python server.py
```

## Step 4: Open in Browser

Go to: **https://localhost:8443/**

When you see a security warning:
1. Click **"Advanced"** or **"Show Details"**
2. Click **"Proceed to localhost"** or **"Accept the Risk"**

Your app is now running on HTTPS! 🎉

