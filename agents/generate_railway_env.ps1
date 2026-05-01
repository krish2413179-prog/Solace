# Generate Railway Environment Variables from Base64 Keystores
# Run this script to output all environment variables in Railway format

Write-Host "# Copy and paste these into Railway's environment variables:" -ForegroundColor Green
Write-Host ""

# Orchestrator
if (Test-Path "orch.b64") {
    $orchContent = Get-Content "orch.b64" -Raw
    Write-Host "KEYSTORE_ORCH_B64=$orchContent"
    Write-Host ""
}

# Workers
for ($i=1; $i -le 50; $i++) {
    if (Test-Path "worker$i.b64") {
        $workerContent = Get-Content "worker$i.b64" -Raw
        Write-Host "KEYSTORE_WORKER${i}_B64=$workerContent"
    }
}

Write-Host ""
Write-Host "# Total: 51 environment variables (1 orchestrator + 50 workers)" -ForegroundColor Green
