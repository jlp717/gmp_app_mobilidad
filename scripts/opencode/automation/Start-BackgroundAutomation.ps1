param(
  [Parameter(Mandatory = $true)][string]$ProjectDir
)

$ErrorActionPreference = "SilentlyContinue"
$bun = (Get-Command bun -ErrorAction SilentlyContinue).Source
if (-not $bun) { exit 0 }

$script = Join-Path $ProjectDir ".opencode\scripts\post-web-startup.mjs"
if (-not (Test-Path -LiteralPath $script)) { exit 0 }

$logDir = Join-Path $ProjectDir ".opencode\logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$outLog = Join-Path $logDir "post-web-startup.out.log"
$errLog = Join-Path $logDir "post-web-startup.err.log"

Start-Process -FilePath $bun `
  -ArgumentList @($script) `
  -WorkingDirectory $ProjectDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog | Out-Null

exit 0
