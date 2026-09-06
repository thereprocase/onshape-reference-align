@echo off
title Reference Align - keep this window open
cd /d "%~dp0"
echo Starting Reference Align. Your browser will open shortly.
echo Keep this window open while you work. Close it when you are finished.
echo.
"%~dp0reference-align.exe" --open %*
if errorlevel 1 (
  echo.
  echo Reference Align could not start. Open START-HERE.html for help.
  echo If asking for help, share the message above, never your Onshape keys.
  pause
)
