param(
  [string]$Server = "192.168.1.230",
  [string]$User = "gmp",
  [string]$SshExe = "C:\Program Files\Git\usr\bin\ssh.exe",
  [string]$ScpExe = "C:\Program Files\Git\usr\bin\scp.exe",
  [string]$SshKeyPath = $env:SSH_KEY_PATH,
  [switch]$Systemd
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Payload = Join-Path $Root "scripts\opencode\v4\payload"
$Remote = "$User@$Server"
$SshArgs = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=10")
if ($SshKeyPath) { $SshArgs += @("-i", $SshKeyPath) }

function Invoke-Remote([string]$Command) {
  & $SshExe @SshArgs $Remote $Command
  if ($LASTEXITCODE -ne 0) { throw "SSH fallo: $Command" }
}

function Copy-Remote([string]$Source, [string]$Destination) {
  & $ScpExe @SshArgs -r $Source "${Remote}:$Destination"
  if ($LASTEXITCODE -ne 0) { throw "SCP fallo: $Source -> $Destination" }
}

if (-not (Test-Path -LiteralPath $SshExe)) { throw "No existe ssh: $SshExe" }
if (-not (Test-Path -LiteralPath $ScpExe)) { throw "No existe scp: $ScpExe" }

Invoke-Remote "mkdir -p /opt/gmp-tools /opt/monitoring /tmp/gmp-v4-systemd /home/gmp/.config/systemd/user"
Copy-Remote (Join-Path $Payload "opt\gmp-tools\*") "/opt/gmp-tools/"
Copy-Remote (Join-Path $Payload "opt\monitoring\*") "/opt/monitoring/"
Copy-Remote (Join-Path $Payload "etc\systemd\system\*") "/tmp/gmp-v4-systemd/"
Copy-Remote (Join-Path $Payload "home\gmp\.config\systemd\user\*") "/home/gmp/.config/systemd/user/"
Invoke-Remote "chmod +x /opt/gmp-tools/*.sh /opt/gmp-tools/*.py"

if ($Systemd) {
  Invoke-Remote "sudo cp -f /tmp/gmp-v4-systemd/* /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable gmp-rag-indexer gmp-daily-digest.timer gmp-elevenlabs-bridge"
  Invoke-Remote "XDG_RUNTIME_DIR=/run/user/`$(id -u) systemctl --user daemon-reload && XDG_RUNTIME_DIR=/run/user/`$(id -u) systemctl --user enable --now gmp-api-self-heal.timer"
}

Write-Host "Payload V4 copiado. Systemd files estan en /tmp/gmp-v4-systemd si no usaste -Systemd."
