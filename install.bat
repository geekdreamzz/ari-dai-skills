@echo off
REM install.bat — Windows installer for dai-skills
REM Usage: install.bat --all --project C:\path\to\project
REM        install.bat all-dai-sdd --project C:\path\to\project

setlocal enabledelayedexpansion

SET DAI_DIR=%~dp0
SET PROJECT=%CD%
SET INSTALL_ALL=0
SET SKILL=

:parse
if "%~1"=="--all" (SET INSTALL_ALL=1 & SHIFT & GOTO parse)
if "%~1"=="--project" (SET PROJECT=%~2 & SHIFT & SHIFT & GOTO parse)
if "%~1" neq "" (SET SKILL=%~1 & SHIFT & GOTO parse)

IF %INSTALL_ALL%==1 (
    echo Installing all skills into %PROJECT%...
    for /d %%s in ("%DAI_DIR%skills\*") do (
        set SKILL_NAME=%%~nxs
        if not exist "%PROJECT%\.claude\skills\!SKILL_NAME!" mkdir "%PROJECT%\.claude\skills\!SKILL_NAME!"
        xcopy /E /Y "%%s\*" "%PROJECT%\.claude\skills\!SKILL_NAME!\" >nul
        echo   + !SKILL_NAME!
    )
    echo.
    echo Done! Run: node "%DAI_DIR%skills\sdd-conductor\sdd-conductor.mjs" init
) ELSE IF NOT "%SKILL%"=="" (
    if not exist "%PROJECT%\.claude\skills\%SKILL%" mkdir "%PROJECT%\.claude\skills\%SKILL%"
    xcopy /E /Y "%DAI_DIR%skills\%SKILL%\*" "%PROJECT%\.claude\skills\%SKILL%\" >nul
    echo   + %SKILL%
    echo Done! Run: node "%DAI_DIR%skills\sdd-conductor\sdd-conductor.mjs" init
) ELSE (
    echo Usage: install.bat --all --project C:\path\to\project
    echo        install.bat all-dai-sdd --project C:\path\to\project
)
