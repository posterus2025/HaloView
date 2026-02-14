@echo off
REM ============================================================
REM  HaloView Wakeup — Resume Claude Code session
REM  Usage: double-click, run "wakeup", or voice command "wakeup"
REM
REM  How it works:
REM    1. --resume haloview continues the named session with
REM       full conversation history (not a cold start)
REM    2. CLAUDE.md auto-loads (architecture + current status)
REM    3. memory/MEMORY.md auto-loads (hardware, decisions)
REM    4. If no session exists, starts fresh — Claude reads the
REM       Current Status section in CLAUDE.md automatically
REM ============================================================

cd /d "C:\Strix Halo VR"

echo.
echo  =============================================
echo   HaloView - Resuming session...
echo  =============================================
echo.

claude --resume haloview
