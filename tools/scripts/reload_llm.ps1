# Reload Proculus LLM after VR session ends
# Writes TEXT to model_target.txt to trigger LLM reload

$modelTarget = "C:\Proculus\docs\model_target.txt"

Write-Host "Reloading Proculus LLM after VR session..."

$current = Get-Content $modelTarget -ErrorAction SilentlyContinue
if ($current -eq "TEXT") {
    Write-Host "LLM already set to TEXT mode."
} else {
    Set-Content -Path $modelTarget -Value "TEXT" -NoNewline
    Write-Host "Wrote TEXT to model_target.txt. Proculus supervisor will auto-reload the LLM."
}
