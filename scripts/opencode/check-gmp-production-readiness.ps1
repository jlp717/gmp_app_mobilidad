# Read-only GMP production readiness check for Windows/OpenCode.
param(
  [string]$Command = "all",
  [string]$PuttySession = "",
  [ValidateRange(1, 500)]
  [int]$LogLines = 200,
  [switch]$SkipPm2,
  [switch]$SkipGit
)

$ErrorActionPreference = "Stop"

$ConfigDir = Join-Path $env:USERPROFILE ".config\opencode"
$EnvFile = Join-Path $ConfigDir ".env"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

function Import-OpenCodeEnv {
  if (-not (Test-Path -LiteralPath $EnvFile)) { return }
  foreach ($line in Get-Content -LiteralPath $EnvFile) {
    if ($line -match "^\s*#" -or $line -notmatch "=") { continue }
    $parts = $line -split "=", 2
    $name = $parts[0].Trim()
    if ($name -notmatch '^(SSH_GMP_(HOST|USER|PORT|PASSWORD|PLINK|OPENSSH|AUTH_MODE|PUTTY_SESSION|KEY_FILE|HOSTKEY|PAGEANT))$') { continue }
    $value = $parts[1].Trim().Trim('"').Trim("'")
    if (-not $value -or $value -eq "undefined" -or $value -match '^\$\{env\.') { continue }
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

function Get-OpenSshPath {
  if ($env:SSH_GMP_OPENSSH) { return $env:SSH_GMP_OPENSSH }
  foreach ($candidate in @("C:\Windows\System32\OpenSSH\ssh.exe", "C:\Program Files\Git\usr\bin\ssh.exe", "ssh")) {
    if ($candidate -eq "ssh") { return $candidate }
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
}

function Invoke-GmpSsh {
  param([Parameter(Mandatory)][string]$RemoteCommand)

  $hostName = if ($env:SSH_GMP_HOST) { $env:SSH_GMP_HOST } else { "192.168.1.230" }
  $user = if ($env:SSH_GMP_USER) { $env:SSH_GMP_USER } else { "gmp" }
  $port = if ($env:SSH_GMP_PORT) { $env:SSH_GMP_PORT } else { "22" }
  $authMode = if ($env:SSH_GMP_AUTH_MODE) { $env:SSH_GMP_AUTH_MODE.ToLowerInvariant() } else { "auto" }

  if ($PuttySession) {
    $env:SSH_GMP_PUTTY_SESSION = $PuttySession
    $authMode = "putty-session"
  }

  if ($authMode -eq "openssh") {
    $ssh = Get-OpenSshPath
    $args = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "-p", $port)
    if ($env:SSH_GMP_KEY_FILE) { $args += @("-i", $env:SSH_GMP_KEY_FILE) }
    $args += @("${user}@${hostName}", $RemoteCommand)
    $output = & $ssh @args 2>&1
    if ($LASTEXITCODE -ne 0) {
      $message = ($output -join "`n").Trim()
      if (-not $message) { $message = "OpenSSH command failed with exit code $LASTEXITCODE." }
      throw $message
    }
    return ($output -join "`n").Trim()
  }

  $plink = if ($env:SSH_GMP_PLINK) { $env:SSH_GMP_PLINK } else { "C:\Program Files (x86)\PuTTY\plink.exe" }
  if (-not (Test-Path -LiteralPath $plink)) { throw "plink.exe not found at $plink" }

  if ($env:SSH_GMP_PUTTY_SESSION) {
    $args = @("-batch", "-load", $env:SSH_GMP_PUTTY_SESSION)
    if ($env:SSH_GMP_HOSTKEY) { $args += @("-hostkey", $env:SSH_GMP_HOSTKEY) }
    $args += @($RemoteCommand)
  } else {
    $args = @("-ssh", "-batch", "-P", $port)
    if ($env:SSH_GMP_HOSTKEY) { $args += @("-hostkey", $env:SSH_GMP_HOSTKEY) }
    if ($env:SSH_GMP_KEY_FILE) { $args += @("-i", $env:SSH_GMP_KEY_FILE) }
    if ($env:SSH_GMP_PAGEANT -ne "false") { $args += @("-agent") }
    if ($env:SSH_GMP_PASSWORD) { $args += @("-pw", $env:SSH_GMP_PASSWORD) }
    $args += @("${user}@${hostName}", $RemoteCommand)
  }

  $output = & $plink @args 2>&1
  if ($LASTEXITCODE -ne 0) {
    $message = ($output -join "`n").Trim()
    if (-not $message) { $message = "PuTTY plink command failed with exit code $LASTEXITCODE." }
    if ($message -match "Cannot answer interactive prompts|host key|password") {
      $message += "`nNon-interactive SSH needs a cached/pinned host key and a non-prompting auth method: PuTTY saved session, Pageant, SSH_GMP_KEY_FILE, SSH_GMP_HOSTKEY, SSH_GMP_PASSWORD, or SSH_GMP_AUTH_MODE=openssh."
    }
    throw $message
  }
  return ($output -join "`n").Trim()
}

function Run-Check {
  param([string]$Name, [string]$RemoteCommand)
  Write-Host "== $Name =="
  $output = Invoke-GmpSsh -RemoteCommand $RemoteCommand
  if ($output) { Write-Host $output }
}

Import-OpenCodeEnv

$HealthCommand = 'status=$(curl -sS -A GMP-SRE-HealthCheck/1.0 -o /tmp/gmp-health.$$ -w "%{http_code}" http://localhost:3335/api/health); cat /tmp/gmp-health.$$; rm -f /tmp/gmp-health.$$; echo; echo HTTP $status; test "$status" = "200"'
$ReadyCommand = 'status=$(curl -sS -A GMP-SRE-HealthCheck/1.0 -o /tmp/gmp-ready.$$ -w "%{http_code}" http://localhost:3335/api/ready); cat /tmp/gmp-ready.$$; rm -f /tmp/gmp-ready.$$; echo; echo HTTP $status; test "$status" = "200"'
$EnvAuditCommand = 'cd /opt/gmp-api/backend || exit 2; f=; if [ -f .env.production ]; then f=.env.production; elif [ -f .env.produccion ]; then f=.env.produccion; elif [ -f .env ]; then f=.env; else echo env_file=MISSING; exit 1; fi; echo env_file=$f; for k in NODE_ENV PORT CORS_ORIGIN CORS_ORIGINS JWT_ACCESS_SECRET JWT_REFRESH_SECRET ODBC_UID ODBC_PWD SMTP_HOST SMTP_USER SMTP_PASS REDIS_URL; do if grep -q ^${k}= $f; then echo ${k}=set; else echo ${k}=missing; fi; done'
$Pm2EnvRuntimeCommand = 'pm2 env 25 | grep -e "^PORT:" -e "^NODE_ENV:" -e "^PM2_CRON_RESTART:" -e "^PM2_INSTANCES:" -e "^PM2_EXEC_MODE:" -e "^PM2_MAX_RESTARTS:" -e "^PM2_LISTEN_TIMEOUT_MS:" -e "^PM2_KILL_TIMEOUT_MS:" -e "^PM2_EXP_BACKOFF_RESTART_DELAY_MS:" || true'
$PortsCommand = 'ss -ltnp 2>/dev/null | grep ":333" || true'
$RecentLogsCommand = 'for f in /opt/gmp-api/backend/logs/error.log /opt/gmp-api/backend/logs/out.log /home/gmp/.pm2/logs/gmp-api-error.log /home/gmp/.pm2/logs/gmp-api-out.log; do [ -f "$f" ] && echo "-- $f --" && tail -n 120 "$f"; done'

switch ($Command) {
  "whoami" { Run-Check "whoami" "whoami"; break }
  "health" { Run-Check "health" $HealthCommand; break }
  "ready-status" { Run-Check "ready-status" $ReadyCommand; break }
  "liveness" { Run-Check "liveness" $HealthCommand; break }
  "env-audit" { Run-Check "env-audit" $EnvAuditCommand; break }
  "pm2-env-runtime" { Run-Check "pm2-env-runtime" $Pm2EnvRuntimeCommand; break }
  "pm2" { Run-Check "pm2" "pm2 status gmp-api --no-color"; break }
  "pm2-describe" { Run-Check "pm2-describe" "pm2 describe gmp-api --no-color"; break }
  "ports" { Run-Check "ports" $PortsCommand; break }
  "logs" { Run-Check "logs" "pm2 logs gmp-api --lines $LogLines --nostream"; break }
  "recent-logs" { Run-Check "recent-logs" $RecentLogsCommand; break }
  "git" { Run-Check "git" "cd /opt/gmp-api && git status --short"; break }
  "git-head" { Run-Check "git-head" "cd /opt/gmp-api && git rev-parse --abbrev-ref HEAD && git rev-parse HEAD"; break }
  "diagnostics" {
    Run-Check "pm2" "pm2 status gmp-api --no-color"
    Run-Check "pm2-describe" "pm2 describe gmp-api --no-color"
    Run-Check "ports" $PortsCommand
    Run-Check "recent-logs" $RecentLogsCommand
    break
  }
  "all" {
    Run-Check "whoami" "whoami"
    Run-Check "hostname" "hostname"
    Run-Check "health" $HealthCommand
    Run-Check "ready" $ReadyCommand
    if (-not $SkipPm2) { Run-Check "pm2" "pm2 status gmp-api --no-color" }
    if (-not $SkipGit) { Run-Check "git" "cd /opt/gmp-api && git status --short" }
    break
  }
  default {
    throw "Unknown command '$Command'. Use all, whoami, health, ready-status, liveness, env-audit, pm2-env-runtime, pm2, pm2-describe, ports, logs, recent-logs, diagnostics, git, or git-head."
  }
}

Write-Host "GMP production readiness read-only check: PASS"
