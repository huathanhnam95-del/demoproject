@echo off
set URL=https://localhost:8443
echo Opening %URL% in Dev Mode (Ignoring SSL Errors)...

:: Try Chrome
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --ignore-certificate-errors --allow-insecure-localhost "%URL%"
    exit
)
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" --ignore-certificate-errors --allow-insecure-localhost "%URL%"
    exit
)

:: Try Edge
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --ignore-certificate-errors --allow-insecure-localhost "%URL%"
    exit
)

echo Could not find Chrome or Edge. Please open your browser and go to:
echo %URL%
pause
