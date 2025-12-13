@echo off
REM Simple batch file to update database from Excel
REM Usage: update-database-simple.bat <excel-file> <mode> [start-id]

echo ========================================
echo Database Update Tool
echo ========================================
echo.

if "%~1"=="" (
    echo Usage: update-database-simple.bat ^<excel-file^> ^<mode^> [start-id]
    echo.
    echo Examples:
    echo   update-database-simple.bat questions.xlsx type
    echo   update-database-simple.bat questions.xlsx speak
    echo   update-database-simple.bat questions.xlsx type 100
    echo.
    pause
    exit /b 1
)

if "%~2"=="" (
    echo Error: Please specify mode (type or speak)
    echo.
    echo Usage: update-database-simple.bat ^<excel-file^> ^<mode^> [start-id]
    pause
    exit /b 1
)

echo Excel File: %~1
echo Mode: %~2
if not "%~3"=="" (
    echo Starting ID: %~3
    node update-database.js "%~1" %~2 %~3
) else (
    node update-database.js "%~1" %~2
)

echo.
echo ========================================
echo Done! Press any key to exit...
pause

