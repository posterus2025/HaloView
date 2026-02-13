# Safely unload Proculus LLM before VR streaming session
# Writes UNLOAD to model_target.txt, waits for LLM server to stop

$modelTarget = "C:\Proculus\docs\model_target.txt"

Write-Host "Unloading Proculus LLM for VR session..."

# Check current state
$current = Get-Content $modelTarget -ErrorAction SilentlyContinue
if ($current -eq "UNLOAD") {
    Write-Host "LLM already unloaded."
} else {
    Write-Host "Current model target: $current"
    Set-Content -Path $modelTarget -Value "UNLOAD" -NoNewline
    Write-Host "Wrote UNLOAD to model_target.txt"
}

# Wait for port 8010 to free up (LLM server shutdown)
$timeout = 30
$elapsed = 0
while ($elapsed -lt $timeout) {
    $conn = Get-NetTCPConnection -LocalPort 8010 -ErrorAction SilentlyContinue
    if (-not $conn) {
        Write-Host "LLM server stopped. Port 8010 is free."
        Write-Host "GPU VRAM freed (~35 GB). Ready for VR streaming."
        exit 0
    }
    Start-Sleep -Seconds 2
    $elapsed += 2
    Write-Host "Waiting for LLM to unload... ($elapsed/$timeout s)"
}

Write-Host "WARNING: LLM server may still be running on port 8010 after ${timeout}s timeout."
Write-Host "Check Task Manager for llama-server.exe process."
