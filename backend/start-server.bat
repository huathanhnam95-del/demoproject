@echo off
echo Starting Paraphrase Backend Server...
echo.
echo Checking dependencies...
python -c "import flask" 2>nul
if errorlevel 1 (
    echo ERROR: Flask is not installed!
    echo Please run: pip install -r requirements.txt
    pause
    exit /b 1
)

python -c "import transformers" 2>nul
if errorlevel 1 (
    echo WARNING: Some dependencies may not be installed yet.
    echo The server may not work fully until all dependencies are installed.
    echo Please run: pip install -r requirements.txt
    echo.
    echo Continuing anyway...
    echo.
)

echo Dependencies OK!
echo.
echo This will start the server on http://localhost:5000
echo Press Ctrl+C to stop the server
echo.
cd /d "%~dp0"
python app.py
pause

