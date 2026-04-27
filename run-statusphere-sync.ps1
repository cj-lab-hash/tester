# Run in the folder that contains .env, statusphere_auth.json, s-sync.mjs
Set-Location "C:\Users\ccondada\Desktop\BACKUP\TESTER\tester"

# ---- Prevent overlapping runs (lock file) ----
$lock = ".\statusphere.lock"
if (Test-Path $lock) {
  Write-Host "Another sync appears to be running. Exiting."
  exit 0
}
New-Item -ItemType File -Path $lock | Out-Null

try {
  # ---- Run the sync and log output ----
  $timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
  node .\s-sync.mjs *>> ".\logs\statusphere_sync_$timestamp.log"
  exit $LASTEXITCODE
}
finally {
  Remove-Item $lock -ErrorAction SilentlyContinue
}
