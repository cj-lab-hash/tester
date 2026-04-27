# Always run from your project folder (where .env and statusphere_auth.json exist)
Set-Location "C:\Users\ccondada\Desktop\BACKUP\TESTER\tester"

# UNC log folder
$LogDir = "\\maxcavfs01\ACT Cell\EA_FILES\CiiJay\Tester\tester\logs"

# Local fallback (so you still get logs if share is unavailable)
$LocalLogDir = ".\logs"

# Ensure local fallback exists
if (-not (Test-Path $LocalLogDir)) {
  New-Item -ItemType Directory -Path $LocalLogDir -Force | Out-Null
}

# Choose logging directory (UNC if reachable, else local)
$ActiveLogDir = $LocalLogDir
try {
  if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
  }
  $ActiveLogDir = $LogDir
} catch {
  # keep local fallback
}

# Lock to prevent overlapping runs (important at 5-minute intervals)
$Lock = ".\statusphere.lock"
if (Test-Path $Lock) { exit 0 }
New-Item -ItemType File -Path $Lock | Out-Null

try {
  $timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
  $logFile = Join-Path $ActiveLogDir "statusphere_sync_$timestamp.log"

  # Run sync and redirect ALL streams to log
  node .\s-sync.mjs *>> $logFile


   # ----------------------------
  # LOG ROTATION: keep only latest 5 logs
  # ----------------------------
  $Keep = 5
  $pattern = "statusphere_sync_*.log"

  try {
    $logs = Get-ChildItem -Path $ActiveLogDir -Filter $pattern -File -ErrorAction Stop |
            Sort-Object LastWriteTime -Descending

    if ($logs.Count -gt $Keep) {
      $toDelete = $logs | Select-Object -Skip $Keep
      $toDelete | Remove-Item -Force -ErrorAction SilentlyContinue
    }
  } catch {
    # If cleanup fails (e.g., permissions on UNC), don't break the main job
  }

  # Optional: also rotate local fallback logs to keep it clean
  try {
  $Keep = 5
  $pattern = "statusphere_sync_*.log"

  $logsLocal = Get-ChildItem -Path $LocalLogDir -Filter $pattern -File -ErrorAction Stop |
               Sort-Object LastWriteTime -Descending

  if ($logsLocal.Count -gt $Keep) {
    $logsLocal | Select-Object -Skip $Keep | Remove-Item -Force -ErrorAction SilentlyContinue
  }
} catch {}

  exit $LASTEXITCODE
}
finally {
  Remove-Item $Lock -ErrorAction SilentlyContinue
}