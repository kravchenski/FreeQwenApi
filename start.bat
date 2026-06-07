@echo off
cd /d "%~dp0"
bun run scripts/start.ts %*
exit /b %ERRORLEVEL%
