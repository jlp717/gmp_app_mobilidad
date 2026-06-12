param(
  [string]$SshTarget = 'gmp@192.168.1.230',
  [string]$Db2Host = '192.168.1.22',
  [int[]]$Ports = @(446, 449, 8470, 8471, 8472, 8473, 8474, 8475, 8476)
)

$ErrorActionPreference = 'Stop'

function Get-SshPath {
  $cmd = Get-Command ssh -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $candidates = @(
    'C:\Program Files\Git\usr\bin\ssh.exe',
    'C:\Windows\System32\OpenSSH\ssh.exe'
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  throw 'ssh executable not found. Install OpenSSH or Git for Windows.'
}

function Test-LocalPort([int]$Port) {
  $client = [Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    return ($task.Wait(500) -and $client.Connected)
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Get-ClosedPorts {
  $closed = @()
  foreach ($port in $Ports) {
    if (-not (Test-LocalPort $port)) { $closed += $port }
  }
  return $closed
}

$ensureDsn = Join-Path $PSScriptRoot 'ensure-gmp-odbc64.ps1'
if (Test-Path -LiteralPath $ensureDsn) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $ensureDsn -Name GMP_TUNNEL -System 127.0.0.1 | Out-Null
}

$closedBefore = @(Get-ClosedPorts)
if ($closedBefore.Count -eq 0) {
  [pscustomobject]@{
    Status = 'already_listening'
    Dsn = 'GMP_TUNNEL'
    LocalHost = '127.0.0.1'
    Ports = ($Ports -join ',')
  }
  exit 0
}

$ssh = Get-SshPath
$args = @(
  '-N',
  '-o', 'BatchMode=yes',
  '-o', 'ExitOnForwardFailure=yes',
  '-o', 'ServerAliveInterval=30',
  '-o', 'ServerAliveCountMax=3'
)
foreach ($port in $Ports) {
  $args += @('-L', "127.0.0.1:${port}:${Db2Host}:${port}")
}
$args += $SshTarget

$process = Start-Process -FilePath $ssh -ArgumentList $args -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 3

$closedAfter = @(Get-ClosedPorts)
if ($closedAfter.Count -gt 0) {
  throw "DB2 SSH tunnel started as PID $($process.Id), but local ports are still closed: $($closedAfter -join ', ')"
}

[pscustomobject]@{
  Status = 'started'
  Pid = $process.Id
  Dsn = 'GMP_TUNNEL'
  LocalHost = '127.0.0.1'
  Ports = ($Ports -join ',')
}
