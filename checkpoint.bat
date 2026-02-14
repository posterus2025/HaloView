@echo off
REM ============================================================
REM  HaloView Checkpoint — Snapshot progress and commit
REM  Usage: double-click, run "checkpoint", or voice "save checkpoint"
REM
REM  What it does:
REM    1. Non-interactive (-p): runs autonomously, no prompts
REM    2. Reads git diff to see what changed
REM    3. Updates CLAUDE.md "Current Status" section
REM    4. Updates MASTER-PLAN.md task statuses
REM    5. Commits all changes with a checkpoint message
REM ============================================================

cd /d "C:\Strix Halo VR"

echo.
echo  =============================================
echo   HaloView - Saving checkpoint...
echo  =============================================
echo.

claude -p "CHECKPOINT: Save a progress checkpoint. Steps: 1) Run git status and git diff --stat to see changes since last commit. 2) Read CLAUDE.md. 3) Update the Current Status section in CLAUDE.md: set the phase, next task, last completed, and last commit to reflect current state. 4) Read docs/MASTER-PLAN.md and update task statuses from TODO to DONE for any completed items. 5) Stage CLAUDE.md, docs/MASTER-PLAN.md, and any modified source files (never stage scratch/ or .claude/settings.local.json). 6) Commit with message: checkpoint — [brief description of what changed]. Print a one-line summary when done."
