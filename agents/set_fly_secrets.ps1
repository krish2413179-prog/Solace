# Script to set all Fly.io secrets from railway_env.txt
# Run this after: fly auth login

Write-Host "Setting Fly.io secrets from railway_env.txt..." -ForegroundColor Green

if (-not (Test-Path "railway_env.txt")) {
    Write-Host "Error: railway_env.txt not found!" -ForegroundColor Red
    Write-Host "Run: .\generate_railway_env.ps1 > railway_env.txt" -ForegroundColor Yellow
    exit 1
}

$secrets = @()
Get-Content railway_env.txt | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#")) {
        if ($line -match '^([^=]+)=(.+)$') {
            $key = $matches[1]
            $value = $matches[2]
            $secrets += "$key=$value"
        }
    }
}

Write-Host "Found $($secrets.Count) secrets to set" -ForegroundColor Cyan

# Fly.io allows setting multiple secrets at once
$secretsFile = "fly_secrets_temp.txt"
$secrets | Out-File -FilePath $secretsFile -Encoding UTF8

Write-Host "Setting secrets in Fly.io..." -ForegroundColor Yellow
fly secrets import < $secretsFile

Remove-Item $secretsFile

Write-Host "`nDone! All secrets have been set." -ForegroundColor Green
Write-Host "Now run: fly deploy" -ForegroundColor Cyan
