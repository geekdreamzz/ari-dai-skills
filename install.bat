@echo off
REM install.bat — Windows installer for dai-skills
REM Usage: install.bat --all --project C:\path\to\project

setlocal enabledelayedexpansion

SET DAI_DIR=%~dp0
SET PROJECT=%CD%
SET INSTALL_ALL=0

:parse
if "%~1"=="--all" (SET INSTALL_ALL=1 & SHIFT & GOTO parse)
if "%~1"=="--project" (SET PROJECT=%~2 & SHIFT & SHIFT & GOTO parse)
if "%~1" neq "" (SET SKILL=%~1 & SHIFT & GOTO parse)

IF %INSTALL_ALL%==1 (
    echo Installing all skills into %PROJECT%...
    for /d %%s in ("%DAI_DIR%skills\*") do (
        set SKILL_NAME=%%~nxs
        if not exist "%PROJECT%\.claude\skills\!SKILL_NAME!" mkdir "%PROJECT%\.claude\skills\!SKILL_NAME!"
        xcopy /E /Y "%%s\*" "%PROJECT%\.claude\skills\!SKILL_NAME!\"
        echo   + !SKILL_NAME!
    )
    REM Copy IDE configs
    if exist "%DAI_DIR%CLAUDE.md" copy /Y "%DAI_DIR%CLAUDE.md" "%PROJECT%\CLAUDE.md" >/dev/null
    if exist "%DAI_DIR%.cursorrules" copy /Y "%DAI_DIR%.cursorrules" "%PROJECT%\.cursorrules" >/dev/null
    if exist "%DAI_DIR%.mcp.json" (
        if not exist "%PROJECT%\.mcp.json" copy /Y "%DAI_DIR%.mcp.json" "%PROJECT%\.mcp.json" >/dev/null
    )
    echo.
    echo Done! All dai. Open your IDE and Ari will be ready.
) ELSE (
    echo Usage: install.bat --all --project C:\path\to\project
    echo        install.bat pages --project C:\path\to\project
)
