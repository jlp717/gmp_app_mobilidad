param(
  [Parameter(Mandatory=$true)][ValidateSet("gmp","granja")][string]$Project,
  [switch]$NoWeb,
  [switch]$NoTelegram,
  [switch]$RestartWeb,
  [switch]$SkipFallbackRuntime
)

$ErrorActionPreference = "Stop"
$ScriptRootResolved = (Resolve-Path -LiteralPath $PSScriptRoot).Path
if ($ScriptRootResolved -match "^(.*)\\Desktop\\Repositorios\\") {
  $HomeDir = $Matches[1]
} elseif ($env:USERPROFILE) {
  $HomeDir = $env:USERPROFILE
} else {
  $HomeDir = [Environment]::GetFolderPath("UserProfile")
}
$ConfigDir = Join-Path $HomeDir ".config\opencode"
$EnvFile = Join-Path $ConfigDir ".env"
$Node = "C:\Program Files\nodejs\node.exe"
$OpenCode = "C:\nvm4w\nodejs\opencode.cmd"

function Start-CursorAcpService([string]$Workspace, [int]$WebPort) {
  $modelsUrl = "http://127.0.0.1:32124/v1/models"
  if (Test-Url $modelsUrl 3) { return "already_running" }

  $standalone = Join-Path $ConfigDir "cursor-acp-standalone.mjs"
  if ((Test-Path -LiteralPath $standalone) -and $Workspace) {
    try {
      $logDir = Join-Path $Workspace ".opencode\logs"
      New-Item -ItemType Directory -Path $logDir -Force | Out-Null
      $outLog = Join-Path $logDir "cursor-acp-standalone.out.log"
      $errLog = Join-Path $logDir "cursor-acp-standalone.err.log"
      $serverUrl = "http://127.0.0.1:$WebPort"
      Start-Process -FilePath $Node -ArgumentList @($standalone, $Workspace, $serverUrl) -WorkingDirectory $Workspace -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -ErrorAction Stop
      Start-Sleep -Seconds 6
      if (Test-Url $modelsUrl 5) { return "started" }
    } catch {
      return "failed: $($_.Exception.Message)"
    }
  }

  $cursorRoot = Join-Path $HomeDir "AppData\Local\cursor-agent"
  $svcCmd = Join-Path $cursorRoot "cursor-agent-svc.cmd"
  $svcJs = Join-Path $cursorRoot "cursor-agent-svc.js"
  if (-not (Test-Path -LiteralPath $svcCmd) -and -not (Test-Path -LiteralPath $svcJs)) { return "missing" }
  $processes = Get-Process -Name "node" -ErrorAction SilentlyContinue
  foreach ($p in $processes) {
    try {
      $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($p.Id)" -ErrorAction SilentlyContinue).CommandLine
      if ($cmdLine -like "*cursor-agent-svc*") { return "already_running_no_http" }
    } catch {}
  }
  try {
    $rootNode = Join-Path $cursorRoot "node.exe"
    if (Test-Path -LiteralPath $rootNode) {
      Start-Process -FilePath $svcCmd -WindowStyle Hidden -ErrorAction Stop
    } elseif (Test-Path -LiteralPath $svcJs) {
      $versionRoot = Join-Path $cursorRoot "versions"
      $node = @(Get-ChildItem -LiteralPath $versionRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "node.exe") } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1 |
        ForEach-Object { Join-Path $_.FullName "node.exe" })[0]
      if (-not $node) { return "failed: node.exe missing" }
      Start-Process -FilePath $node -ArgumentList @($svcJs) -WindowStyle Hidden -ErrorAction Stop
    } else {
      return "missing"
    }
    Start-Sleep -Seconds 3
    if (Test-Url $modelsUrl 3) { return "started" }
    return "started_no_http"
  } catch {
    return "failed: $($_.Exception.Message)"
  }
}
function Load-Env {
  try {
    if (-not (Test-Path -LiteralPath $EnvFile)) { return }
    foreach ($line in Get-Content -LiteralPath $EnvFile) {
      if ($line -match "^\s*#" -or $line -notmatch "=") { continue }
      $parts = $line -split "=", 2
      $name = $parts[0].Trim()
      if (-not $name) { continue }
      if ((Get-Item "Env:$name" -ErrorAction SilentlyContinue) -and $name -in @(
        "OPENCODE_SERVER_USERNAME",
        "OPENCODE_SERVER_PASSWORD",
        "ODBC_UID",
        "ODBC_PWD",
        "ODBC_DSN",
        "ODBC_SCHEMA"
      )) { continue }
      [Environment]::SetEnvironmentVariable($name, $parts[1], "Process")
    }
  } catch {
    Write-Host "Aviso: no se pudo leer $EnvFile. Continuo con variables de entorno del proceso."
  }
}

function Set-EnvFileValue([string]$Name, [string]$Value) {
  try {
    $lines = @()
    if (Test-Path -LiteralPath $EnvFile) { $lines = @(Get-Content -LiteralPath $EnvFile) }
    $found = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
      if ($lines[$i] -match "^$([regex]::Escape($Name))=") {
        $lines[$i] = "$Name=$Value"
        $found = $true
        break
      }
    }
    if (-not $found) { $lines += "$Name=$Value" }
    Write-Utf8NoBom $EnvFile ($lines -join [Environment]::NewLine)
  } catch {
    Write-Host "Aviso: no se pudo persistir $Name en $EnvFile. Lo usare solo en este proceso."
  } finally {
    [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
  }
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  [System.IO.File]::WriteAllText($Path, $Text, [System.Text.UTF8Encoding]::new($false))
}

function Repair-McpCommandArrays([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -ErrorAction SilentlyContinue)) { return }
  $text = Get-Content -LiteralPath $Path -Raw
  $original = $text
  $commands = @(
    "C:/nvm4w/nodejs/context7-mcp.cmd",
    "C:/nvm4w/nodejs/fetch-mcp.cmd",
    "C:/nvm4w/nodejs/git-mcp-server.cmd",
    "C:/nvm4w/nodejs/mcp-server-github.cmd",
    "C:/nvm4w/nodejs/chrome-devtools-mcp.cmd",
    "C:/nvm4w/nodejs/firecrawl-mcp.cmd",
    "C:/nvm4w/nodejs/mcp-server-sentry.cmd",
    "C:/nvm4w/nodejs/mcp-server-filesystem.cmd"
  )
  foreach ($command in $commands) {
    $pattern = '"command"\s*:\s*"' + [regex]::Escape($command) + '"'
    $replacement = '"command":  [' + "`n" + '                                                   "' + $command + '"' + "`n" + '                                               ]'
    $text = [regex]::Replace($text, $pattern, $replacement)
  }
  if ($text -ne $original) { Write-Utf8NoBom $Path $text }
}

function Sync-OpenCodeAccountAuth([string]$RuntimeHome) {
  $source = Join-Path $HomeDir ".local\share\opencode\auth.json"
  $targetDir = Join-Path $RuntimeHome "opencode"
  $target = Join-Path $targetDir "auth.json"
  try {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $HomeDir ".local\share\opencode\log") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $targetDir "log") -Force | Out-Null
    if (-not (Test-Path -LiteralPath $source)) { return "source_missing" }

    $sourceAuth = Get-Content -LiteralPath $source -Raw | ConvertFrom-Json
    $merged = [ordered]@{}
    if (Test-Path -LiteralPath $target) {
      try {
        $targetAuth = Get-Content -LiteralPath $target -Raw | ConvertFrom-Json
        foreach ($prop in $targetAuth.PSObject.Properties) {
          $merged[$prop.Name] = $prop.Value
        }
      } catch {}
    }
    foreach ($prop in $sourceAuth.PSObject.Properties) {
      if ($prop.Name -in @("openai", "opencode-go")) {
        $merged[$prop.Name] = $prop.Value
      }
    }
    if ($merged.Count -eq 0) { return "empty" }
    Write-Utf8NoBom $target (($merged | ConvertTo-Json -Depth 20) + "`n")
    return "ok:$($merged.Keys -join ',')"
  } catch {
    return "degradado: $($_.Exception.Message)"
  }
}

function ConvertTo-PlainHashtable($InputObject) {
  if ($null -eq $InputObject) { return $null }
  if ($InputObject -is [System.Collections.IDictionary]) {
    $hash = [ordered]@{}
    foreach ($key in $InputObject.Keys) {
      $hash[$key] = ConvertTo-PlainHashtable $InputObject[$key]
    }
    return $hash
  }
  if ($InputObject -is [System.Collections.IEnumerable] -and $InputObject -isnot [string]) {
    return @($InputObject | ForEach-Object { ConvertTo-PlainHashtable $_ })
  }
  if ($InputObject.PSObject -and $InputObject.PSObject.Properties.Count -gt 0 -and $InputObject.GetType().Name -eq "PSCustomObject") {
    $hash = [ordered]@{}
    foreach ($prop in $InputObject.PSObject.Properties) {
      $hash[$prop.Name] = ConvertTo-PlainHashtable $prop.Value
    }
    return $hash
  }
  return $InputObject
}

function New-JsonArray([object[]]$Items) {
  $list = [System.Collections.ArrayList]::new()
  foreach ($item in $Items) { [void]$list.Add($item) }
  return ,$list
}

function New-Db2McpEnvironment {
  [ordered]@{
    ODBC_DSN = if ($env:ODBC_DSN) { $env:ODBC_DSN } else { "GMP" }
    ODBC_SCHEMA = if ($env:ODBC_SCHEMA) { $env:ODBC_SCHEMA } else { "JAVIER" }
  }
}

function Get-ProjectMcpScript([string]$Name) {
  return (Join-Path $PSScriptRoot "mcp\$Name").Replace("\", "/")
}

function Ensure-IbmDb2McpEnvironment {
  $paths = @(
    (Join-Path $ConfigDir "opencode.json"),
    (Join-Path $HomeDir ".opencode-runtime\opencode\opencode.json"),
    (Join-Path $HomeDir "Desktop\Repositorios\gmp_app_mobilidad\.opencode-runtime\opencode\opencode.json"),
    (Join-Path $HomeDir "Desktop\Repositorios\gmp_app_mobilidad\.opencode\opencode.json"),
    (Join-Path $HomeDir "Desktop\Repositorios\gmp_app_mobilidad\opencode.json"),
    (Join-Path $HomeDir "Desktop\Repositorios\granja_mari_pepa\.opencode-runtime\opencode\opencode.json"),
    (Join-Path $HomeDir "Desktop\Repositorios\granja_mari_pepa\.opencode\opencode.json"),
    (Join-Path $HomeDir "Desktop\Repositorios\granja_mari_pepa\opencode.json")
  )
  $updated = @()
  foreach ($path in $paths) {
    try {
      if (-not (Test-Path -LiteralPath $path)) { continue }
      $json = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
      $cfg = ConvertTo-PlainHashtable $json
      if (-not $cfg.Contains("mcp")) { continue }
      if (-not $cfg.mcp.Contains("ibm-db2-mcp")) { continue }
      if ($cfg.Contains("instructions") -and $cfg["instructions"] -is [string] -and $cfg["instructions"]) {
        $cfg["instructions"] = @($cfg["instructions"])
      }
      if ($cfg.Contains("skills") -and
          $cfg["skills"] -is [System.Collections.IDictionary] -and
          $cfg["skills"].Contains("paths") -and
          $cfg["skills"]["paths"] -is [string]) {
        $cfg["skills"]["paths"] = @($cfg["skills"]["paths"])
      }
      $cfg.mcp["ibm-db2-mcp"]["type"] = "local"
      $cfg.mcp["ibm-db2-mcp"]["command"] = (New-JsonArray @($Node, (Get-ProjectMcpScript "ibm-odbc-mcp.cjs")))
      $cfg.mcp["ibm-db2-mcp"]["environment"] = New-Db2McpEnvironment
      $cfg.mcp["ibm-db2-mcp"]["env"] = New-Db2McpEnvironment
      if (-not $cfg.mcp["ibm-db2-mcp"].Contains("timeout") -or [int]$cfg.mcp["ibm-db2-mcp"]["timeout"] -lt 30000) {
        $cfg.mcp["ibm-db2-mcp"]["timeout"] = 30000
      }

      $requiredMcp = [ordered]@{
        "ddg-search" = [ordered]@{
          type = "local"
          command = (New-JsonArray @("C:/nvm4w/nodejs/duckduckgo-mcp-server.cmd"))
          timeout = 30000
        }
        "beads" = [ordered]@{
          type = "local"
          command = (New-JsonArray @("C:/Users/Javier/AppData/Local/Programs/Python/Python311/Scripts/beads-mcp.exe"))
          enabled = $false
          timeout = 5000
        }
        "playwright" = [ordered]@{
          type = "local"
          command = (New-JsonArray @("C:/nvm4w/nodejs/playwright-mcp.cmd"))
          timeout = 30000
        }
        "github" = [ordered]@{
          type = "local"
          command = (New-JsonArray @("C:/nvm4w/nodejs/mcp-server-github.cmd"))
          environment = [ordered]@{ GITHUB_TOKEN = '${env.GITHUB_TOKEN}' }
          timeout = 30000
        }
        "memory" = [ordered]@{
          type = "local"
          command = (New-JsonArray @("C:/nvm4w/nodejs/mcp-server-memory.cmd"))
          timeout = 30000
        }
        "sequential-thinking" = [ordered]@{
          type = "local"
          command = (New-JsonArray @("C:/nvm4w/nodejs/mcp-server-sequential-thinking.cmd"))
          timeout = 30000
        }
      }
      foreach ($name in $requiredMcp.Keys) {
        if (-not $cfg.mcp.Contains($name)) {
          $cfg.mcp[$name] = [ordered]@{}
        }
        foreach ($key in $requiredMcp[$name].Keys) {
          if ($key -eq "command") {
            $current = $cfg.mcp[$name][$key]
            if ($current -is [string] -or $null -eq $current -or @($current).Count -eq 0 -or -not @($current)[0]) {
              $cfg.mcp[$name][$key] = $requiredMcp[$name][$key]
            }
          } elseif (-not $cfg.mcp[$name].Contains($key) -or $null -eq $cfg.mcp[$name][$key] -or $cfg.mcp[$name][$key] -eq "") {
            $cfg.mcp[$name][$key] = $requiredMcp[$name][$key]
          }
        }
      }
      Write-Utf8NoBom $path (($cfg | ConvertTo-Json -Depth 100) + "`n")
      Repair-McpCommandArrays $path
      $updated += $path
    } catch {
      return "degradado: $($_.Exception.Message)"
    }
  }
  if ($updated.Count -eq 0) { return "sin_cambios" }
  return "ok:$($updated.Count)"
}

function New-Secret([int]$Length = 32) {
  $chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  $bytes = New-Object byte[] $Length
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $out = New-Object System.Text.StringBuilder
  foreach ($b in $bytes) { [void]$out.Append($chars[$b % $chars.Length]) }
  return $out.ToString()
}

function Ensure-OpenCodeWebAuth {
  if (-not $env:OPENCODE_SERVER_USERNAME) {
    Set-EnvFileValue "OPENCODE_SERVER_USERNAME" "Javier"
  }
  if (-not $env:OPENCODE_SERVER_PASSWORD) {
    Set-EnvFileValue "OPENCODE_SERVER_PASSWORD" (New-Secret 36)
  }
}

function Repair-FallbackModels {
  $fallback = Join-Path $ConfigDir "fallback-models.json"
  try {
    if (-not (Test-Path -LiteralPath $fallback)) { return "no_configurado" }
    $text = Get-Content -LiteralPath $fallback -Raw
    $obj = $text | ConvertFrom-Json
    Write-Utf8NoBom $fallback ($obj | ConvertTo-Json -Depth 100)
    return "ok"
  } catch {
    return "no_accesible: $($_.Exception.Message)"
  }
}

function Repair-Db2McpConfig {
  $paths = @(
    (Join-Path $ConfigDir "opencode.json"),
    (Join-Path $HomeDir ".opencode-runtime\opencode\opencode.json"),
    (Join-Path $HomeDir "Desktop\Repositorios\gmp_app_mobilidad\.opencode-runtime\opencode\opencode.json"),
    (Join-Path $HomeDir "Desktop\Repositorios\gmp_app_mobilidad\.opencode\opencode.json"),
    (Join-Path $HomeDir "Desktop\Repositorios\gmp_app_mobilidad\opencode.json"),
    (Join-Path $HomeDir "Desktop\Repositorios\granja_mari_pepa\.opencode-runtime\opencode\opencode.json"),
    (Join-Path $HomeDir "Desktop\Repositorios\granja_mari_pepa\.opencode\opencode.json"),
    (Join-Path $HomeDir "Desktop\Repositorios\granja_mari_pepa\opencode.json")
  )
  $updated = 0
  foreach ($path in $paths) {
    try {
      if (-not (Test-Path -LiteralPath $path)) { continue }
      $cfg = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
      if (-not $cfg.mcp) {
        $cfg | Add-Member -MemberType NoteProperty -Name mcp -Value ([pscustomobject]@{})
      }
      $mcp = $cfg.mcp
      $current = $mcp.'ibm-db2-mcp'
      if (-not $current) {
        $current = [pscustomobject]@{}
        $mcp | Add-Member -MemberType NoteProperty -Name 'ibm-db2-mcp' -Value $current
      }
      $current | Add-Member -MemberType NoteProperty -Name type -Value "local" -Force
      $current | Add-Member -MemberType NoteProperty -Name command -Value @($Node, (Get-ProjectMcpScript "ibm-odbc-mcp.cjs")) -Force
      $current | Add-Member -MemberType NoteProperty -Name environment -Value ([pscustomobject](New-Db2McpEnvironment)) -Force
      $current | Add-Member -MemberType NoteProperty -Name env -Value ([pscustomobject](New-Db2McpEnvironment)) -Force
      $current | Add-Member -MemberType NoteProperty -Name enabled -Value $false -Force
      $current | Add-Member -MemberType NoteProperty -Name timeout -Value 30000 -Force
      Write-Utf8NoBom $path ($cfg | ConvertTo-Json -Depth 100)
      Repair-McpCommandArrays $path
      $updated++
    } catch {
      return "ERROR: $($_.Exception.Message)"
    }
  }
  return "ok:$updated"
}

function Test-CustomToolSchemas([string]$ProjectDir) {
  $toolsDir = Join-Path $ProjectDir ".opencode\tools"
  if (-not (Test-Path -LiteralPath $toolsDir)) { return "sin_tools" }
  $bad = @()
  foreach ($file in Get-ChildItem -LiteralPath $toolsDir -Filter *.ts -File -ErrorAction SilentlyContinue) {
    $matches = Select-String -LiteralPath $file.FullName -Pattern "record(tool.schema.string())" -SimpleMatch -ErrorAction SilentlyContinue
    foreach ($match in $matches) { $bad += "$($file.Name):$($match.LineNumber)" }
  }
  if ($bad.Count -gt 0) { return "ERROR: schema record incompleto en $($bad -join ', ')" }
  return "ok"
}

function Set-CursorRuntimeAvailability([bool]$Enabled) {
  $runtimeRoot = if ($env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME } else { Join-Path $HomeDir ".opencode-runtime" }
  $runtimeConfig = Join-Path $runtimeRoot "opencode\opencode.json"
  if (-not (Test-Path -LiteralPath $runtimeConfig)) { return "runtime_config_missing" }
  try {
    $projectConfig = if ($ProjectDir) { Join-Path $ProjectDir "opencode.json" } else { $null }
    $canonicalConfig = if ($projectConfig -and (Test-Path -LiteralPath $projectConfig)) {
      $projectConfig
    } else {
      Join-Path $ConfigDir "opencode.json"
    }
    if (Test-Path -LiteralPath $canonicalConfig) {
      Copy-Item -LiteralPath $canonicalConfig -Destination $runtimeConfig -Force
    }
    if ($Enabled) { return "cursor_acp_available" }
    return "cursor_acp_standby_no_active_primary_agents"
  } catch {
    return "ERROR: $($_.Exception.Message)"
  }
}

function Test-Url([string]$Url, [int]$TimeoutSec = 5) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  } catch { return $false }
}

function Invoke-MobileOperationalSnapshot([string]$ProjectDir) {
  return "deferred:post-web-startup"
}

function Invoke-StartupIntegrityCheck([string]$ProjectDir) {
  return "deferred:post-web-startup"
}

function Invoke-ReadinessSmokeBounded([string]$ProjectDir, [int]$TimeoutSec = 45) {
  $runner = Join-Path $ProjectDir ".opencode\scripts\readiness-smoke.mjs"
  if (-not (Test-Path -LiteralPath $runner)) { return "no_configurado" }
  try {
    $job = Start-Job -ScriptBlock {
      param($Node, $Runner)
      try { (& $Node $Runner 2>$null) -join " " } catch { "" }
    } -ArgumentList $Node, $runner
    if (Wait-Job $job -Timeout $TimeoutSec) {
      $output = (Receive-Job $job).Trim()
      Remove-Job $job -Force -ErrorAction SilentlyContinue
      if ($output) { return $output }
      return "ok"
    }
    Stop-Job $job -Force -ErrorAction SilentlyContinue
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    return "deferred:post-web-startup (timeout ${TimeoutSec}s)"
  } catch {
    return "degradado: $($_.Exception.Message)"
  }
}

function Resolve-BunPath {
  $cmd = Get-Command bun -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $homeBun = Join-Path $HomeDir ".bun\bin\bun.exe"
  if (Test-Path -LiteralPath $homeBun) { return $homeBun }
  return $null
}

function Invoke-PostWebStartup([string]$ProjectDir) {
  try {
    $bun = Resolve-BunPath
    if (-not $bun) { return "degradado: bun_missing" }
    $script = Join-Path $ProjectDir ".opencode\scripts\post-web-startup.mjs"
    if (-not (Test-Path -LiteralPath $script)) { return "degradado: post_web_startup_missing" }
    $logDir = Join-Path $ProjectDir ".opencode\logs"
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $outLog = Join-Path $logDir "post-web-startup.out.log"
    $errLog = Join-Path $logDir "post-web-startup.err.log"
    Start-Process -FilePath $bun -ArgumentList @($script) -WorkingDirectory $ProjectDir -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog | Out-Null
    Ensure-GmpAutomationScheduledTask -ProjectDir $ProjectDir | Out-Null
    return "started:post-web-startup"
  } catch {
    return "degradado: $($_.Exception.Message)"
  }
}

function Ensure-GmpAutomationScheduledTask([string]$ProjectDir) {
  $taskName = "GMP-OpenCode-Automation"
  $existing = schtasks /Query /TN $taskName 2>$null
  if ($LASTEXITCODE -eq 0) { return "task_exists" }
  $bun = Resolve-BunPath
  if (-not $bun) { return "bun_missing" }
  $script = Join-Path $ProjectDir ".opencode\scripts\post-web-startup.mjs"
  if (-not (Test-Path -LiteralPath $script)) { return "script_missing" }
  schtasks /Create /TN $taskName /TR "`"$bun`" `"$script`"" /SC DAILY /ST 08:15 /RL LIMITED /F 2>$null | Out-Null
  return "task_created"
}

function Test-WebAuthenticated([string]$Url, [int]$TimeoutSec = 5) {
  try {
    $pair = "{0}:{1}" -f $env:OPENCODE_SERVER_USERNAME, $env:OPENCODE_SERVER_PASSWORD
    $encoded = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
    $response = Invoke-WebRequest -Uri $Url -Headers @{ Authorization = "Basic $encoded" } -UseBasicParsing -TimeoutSec $TimeoutSec
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  } catch { return $false }
}

function Test-Tcp([string]$HostName, [int]$Port, [int]$TimeoutMs = 1000) {
  $client = [Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync($HostName, $Port)
    if (-not $task.Wait($TimeoutMs)) { return $false }
    return $client.Connected
  } catch { return $false }
  finally { $client.Dispose() }
}

function Restart-OpenCodeWebIfRequested([int]$Port) {
  if (-not $RestartWeb -or $NoWeb) { return "no_solicitado" }
  try {
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) { return "sin_listener" }
    $stopped = @()
    foreach ($listener in $listeners) {
      $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
      if (-not $process) { continue }
      $name = $process.ProcessName
      $path = ""
      try { $path = $process.Path } catch {}
      $isOpenCode = $name -in @("opencode", "node") -or $path -match "opencode"
      if (-not $isOpenCode) {
        return "bloqueado: puerto $Port ocupado por $name PID $($process.Id)"
      }
      Stop-Process -Id $process.Id -Force -ErrorAction Stop
      $stopped += "${name}:$($process.Id)"
    }
    Start-Sleep -Seconds 3
    if ($stopped.Count -eq 0) { return "sin_proceso" }
    return "reiniciado:$($stopped -join ',')"
  } catch {
    return "degradado: $($_.Exception.Message)"
  }
}

function Test-OdbcDsn([string]$Dsn, [int]$TimeoutSec = 8) {
  if (-not $env:ODBC_UID -or -not $env:ODBC_PWD) { return $false }
  $connection = New-Object System.Data.Odbc.OdbcConnection
  $connection.ConnectionString = "DSN=$Dsn;UID=$($env:ODBC_UID);PWD=$($env:ODBC_PWD);ConnectionTimeout=$TimeoutSec;LoginTimeout=$TimeoutSec;"
  try {
    $connection.Open()
    $command = $connection.CreateCommand()
    $command.CommandText = "SELECT CURRENT SERVER FROM SYSIBM.SYSDUMMY1"
    [void]$command.ExecuteScalar()
    return $true
  } catch {
    return $false
  } finally {
    try { $connection.Close() } catch {}
    $connection.Dispose()
  }
}

function Ensure-GmpDb2Odbc([string]$ProjectDir) {
  $ensureDsn = Join-Path $ProjectDir "scripts\opencode\ensure-gmp-odbc64.ps1"
  $startTunnel = Join-Path $ProjectDir "scripts\opencode\start-gmp-db2-tunnel.ps1"
  try {
    if (Test-Path -LiteralPath $ensureDsn) {
      & powershell -NoProfile -ExecutionPolicy Bypass -File $ensureDsn -Name GMP -System 192.168.1.22 | Out-Null
    }
  } catch {
    return "ERROR: no se pudo asegurar DSN GMP: $($_.Exception.Message)"
  }

  if ((Test-Tcp "192.168.1.22" 8471 1500) -and (Test-OdbcDsn "GMP" 8)) {
    $env:ODBC_DSN = "GMP"
    return "directo:GMP"
  }

  try {
    if (Test-Path -LiteralPath $ensureDsn) {
      & powershell -NoProfile -ExecutionPolicy Bypass -File $ensureDsn -Name GMP_TUNNEL -System 127.0.0.1 | Out-Null
    }
    if (Test-Path -LiteralPath $startTunnel) {
      & powershell -NoProfile -ExecutionPolicy Bypass -File $startTunnel | Out-Null
    }
    if (Test-OdbcDsn "GMP_TUNNEL" 10) {
      $env:ODBC_DSN = "GMP_TUNNEL"
      return "tunel:GMP_TUNNEL"
    }
    $env:ODBC_DSN = "GMP"
    return "degradado: GMP directo no conecta y GMP_TUNNEL no valido"
  } catch {
    $env:ODBC_DSN = "GMP"
    return "degradado: $($_.Exception.Message)"
  }
}

function Test-RemoteGmp([string]$Command) {
  try {
    & ssh -o BatchMode=yes -o ConnectTimeout=10 gmp@192.168.1.230 "bash -lc '$Command'" 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
  } catch { return $false }
}

function Send-Tg([string]$Message) {
  if ($NoTelegram) { return }
  $tool = Join-Path $ConfigDir "tools\telegram-notifier.mjs"
  try {
    if (Test-Path -LiteralPath $tool) {
      try { & $Node $tool --message $Message 2>$null | Out-Null } catch {}
    }
  } catch {
    Write-Host "Aviso: Telegram notifier global no accesible. Continuo sin bloquear arranque."
  }
}

function Get-MemoryCount([string]$ProjectDir) {
  $dir = Join-Path $ProjectDir ".opencode\memory"
  if (-not (Test-Path -LiteralPath $dir)) { return 0 }
  return @(Get-ChildItem -LiteralPath $dir -File -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in @(".md",".json",".jsonl",".logfmt") }).Count
}

function Get-PendingStateCount([string]$ProjectDir) {
  return @(Get-PendingStateSummary $ProjectDir).Count
}

function Get-PendingStateSummary([string]$ProjectDir) {
  $dir = Join-Path $ProjectDir ".opencode\state"
  if (-not (Test-Path -LiteralPath $dir)) { return @() }
  $activeCutoff = (Get-Date).AddMinutes(-90)
  $approvalCutoff = (Get-Date).AddHours(-24)
  $orphanCutoff = (Get-Date).AddMinutes(-15)
  $activeSteps = @(
    "DISCOVERY",
    "PLAN_READY",
    "WAITING_PLAN_APPROVAL",
    "IMPLEMENTING",
    "VERIFYING",
    "STAGING",
    "WAITING_PRODUCTION_APPROVAL",
    "PRODUCTION_DEPLOY"
  )
  $items = @()
  foreach ($file in Get-ChildItem -LiteralPath $dir -Filter *.json -File -ErrorAction SilentlyContinue) {
    if ($file.Name -like "preflight-*" -or
        $file.Name -like "decision-route-*" -or
        $file.Name -like "*-audit-*" -or
        $file.Name -like "flow-policy-check-*" -or
        $file.Name -like "elite-quality-gate-*" -or
        $file.Name -like "decision-router-self-test-*") {
      continue
    }
    try {
      $state = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
      if (-not $state.task_id -or -not $state.current_step) { continue }
      if ($state.current_step -in @("DELIVER", "DONE", "CANCELLED", "EXPIRED", "BLOCKED", "REPORTING")) { continue }
      $updatedAt = $null
      if ($state.ts_updated) {
        try { $updatedAt = [DateTime]::Parse($state.ts_updated) } catch { $updatedAt = $null }
      }
      if (-not $updatedAt) { $updatedAt = $file.LastWriteTime }
      if ($state.current_step -eq "RECEIVE" -and $updatedAt -lt $orphanCutoff) { continue }
      if ($activeSteps -notcontains $state.current_step) { continue }
      if ($state.current_step -like "WAITING_*") {
        if ($updatedAt -lt $approvalCutoff) { continue }
      } elseif ($updatedAt -lt $activeCutoff) {
        continue
      }
      $items += [ordered]@{
        task_id = $state.task_id
        current_step = $state.current_step
        project = if ($state.project) { $state.project } else { $Project }
        tier = if ($state.tier) { $state.tier } else { "sin_clasificar" }
        created_at = if ($state.ts_created) { $state.ts_created } else { $file.LastWriteTimeUtc.ToString("o") }
        updated_at = if ($state.ts_updated) { $state.ts_updated } else { $file.LastWriteTimeUtc.ToString("o") }
        source_file = $file.Name
      }
    } catch {}
  }
  return @($items)
}

function Get-StaleStateCount([string]$ProjectDir) {
  $cache = Join-Path $ProjectDir ".opencode\state\state-cleanup-latest.json"
  if (Test-Path -LiteralPath $cache) {
    try {
      $cached = Get-Content -LiteralPath $cache -Raw | ConvertFrom-Json
      $generatedAt = [DateTime]::Parse($cached.generated_at)
      if (((Get-Date) - $generatedAt).TotalDays -lt 7 -and $null -ne $cached.stale_after) {
        return [int]$cached.stale_after
      }
    } catch {}
  }
  $dir = Join-Path $ProjectDir ".opencode\state"
  if (-not (Test-Path -LiteralPath $dir)) { return 0 }
  $count = 0
  $active = @(Get-PendingStateSummary $ProjectDir | ForEach-Object { $_.source_file })
  foreach ($file in Get-ChildItem -LiteralPath $dir -Filter *.json -File -ErrorAction SilentlyContinue) {
    if ($file.Name -like "preflight-*" -or
        $file.Name -like "decision-route-*" -or
        $file.Name -like "*-audit-*" -or
        $file.Name -like "flow-policy-check-*" -or
        $file.Name -like "elite-quality-gate-*" -or
        $file.Name -like "decision-router-self-test-*") {
      continue
    }
    try {
      $state = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
      if ($state.task_id -and $state.current_step -and $state.current_step -notin @("DELIVER", "DONE", "CANCELLED", "EXPIRED") -and $active -notcontains $file.Name) {
        $count++
      }
    } catch {}
  }
  return $count
}

function Rotate-IfLarge([string]$Path, [int64]$MaxBytes, [int]$Keep = 5) {
  try {
    if (-not (Test-Path -LiteralPath $Path)) { return "missing" }
    $file = Get-Item -LiteralPath $Path
    if ($file.Length -le $MaxBytes) { return "ok:$($file.Length)" }
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $rotated = "$Path.$stamp"
    Move-Item -LiteralPath $Path -Destination $rotated -Force
    New-Item -ItemType File -Path $Path -Force | Out-Null
    $pattern = "$([IO.Path]::GetFileName($Path)).*"
    $dir = Split-Path -Parent $Path
    $old = @(Get-ChildItem -LiteralPath $dir -Filter $pattern -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -ne [IO.Path]::GetFileName($Path) } |
      Sort-Object LastWriteTimeUtc -Descending |
      Select-Object -Skip $Keep)
    foreach ($item in $old) { Remove-Item -LiteralPath $item.FullName -Force -ErrorAction SilentlyContinue }
    return "rotated:$($file.Length)"
  } catch {
    return "degradado:$($_.Exception.Message)"
  }
}

function Get-ValidSkillCount([string]$ProjectDir) {
  $dir = Join-Path $ProjectDir ".opencode\skills"
  if (-not (Test-Path -LiteralPath $dir)) { return 0 }
  return @(Get-ChildItem -LiteralPath $dir -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "SKILL.md") }).Count
}

function Start-MetricsServer([string]$ProjectDir) {
  if (Test-Url "http://127.0.0.1:9091/health" 2) { return "listo:9091" }
  $server = Join-Path $ProjectDir ".opencode\metrics-server.js"
  if (-not (Test-Path -LiteralPath $server)) { return "no_configurado" }
  Start-Process -FilePath $Node -ArgumentList @($server) -WorkingDirectory $ProjectDir -WindowStyle Hidden | Out-Null
  Start-Sleep -Seconds 2
  foreach ($port in @(9091,9092,9093)) {
    if (Test-Url "http://127.0.0.1:$port/health" 2) { return "listo:$port" }
  }
  return "degradado"
}

function Invoke-TeamCuratorRunner([string]$ProjectDir) {
  $runner = Join-Path $ProjectDir ".opencode\scripts\team-curator-runner.mjs"
  if (-not (Test-Path -LiteralPath $runner)) { return "no_configurado" }
  try {
    $runnerArgs = @($runner, "--period", "7", "--if-stale-hours", "120")
    if (-not $NoTelegram) { $runnerArgs += "--telegram" }
    $output = (& $Node @runnerArgs 2>$null) -join " "
    if (-not $output) { return "ok" }
    return $output.Trim()
  } catch {
    return "degradado: $($_.Exception.Message)"
  }
}

function Invoke-ReadinessSmoke([string]$ProjectDir) {
  return Invoke-ReadinessSmokeBounded $ProjectDir 45
}

function Write-PreflightState([string]$ProjectDir, [hashtable]$Payload) {
  try {
    $stateDir = Join-Path $ProjectDir ".opencode\state"
    New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
    $json = $Payload | ConvertTo-Json -Depth 20
    Write-Utf8NoBom (Join-Path $stateDir "preflight-last.json") $json
    Write-Utf8NoBom (Join-Path $stateDir ("preflight-{0}.json" -f (Get-Date -Format "yyyyMMdd-HHmmss"))) $json
  } catch {}
}

function Ensure-Chroma([string]$ProjectDir) {
  if (Test-Url "http://127.0.0.1:8000/api/v2/heartbeat" 2) { return "listo" }
  $chroma = Get-Command chroma -ErrorAction SilentlyContinue
  if (-not $chroma) { return "degradado_sin_chroma_cli" }
  $dataDir = Join-Path $ProjectDir ".opencode\chromadb"
  New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
  Start-Process -FilePath $chroma.Source -ArgumentList @("run","--host","localhost","--port","8000","--path",$dataDir) -WorkingDirectory $ProjectDir -WindowStyle Hidden | Out-Null
  Start-Sleep -Seconds 4
  if (Test-Url "http://127.0.0.1:8000/api/v2/heartbeat" 2) { return "listo" }
  return "degradado"
}

function Get-AgentCount {
  try {
    $raw = & $OpenCode debug config --pure
    $text = ($raw -join "`n").Trim()
    $jsonStart = $text.IndexOf("{")
    if ($jsonStart -lt 0) { return 0 }
    $cfg = $text.Substring($jsonStart) | ConvertFrom-Json
    return @($cfg.agent.PSObject.Properties | Where-Object { -not $_.Value.disable }).Count
  } catch { return 0 }
}

function Get-EffectiveOpenCodeConfig {
  try {
    $raw = & $OpenCode debug config --pure 2>&1
    $text = ($raw -join "`n").Trim()
    $jsonStart = $text.IndexOf("{")
    if ($jsonStart -lt 0) { throw "CONFIG_UNAVAILABLE: opencode debug config no devolvio JSON: $text" }
    return $text.Substring($jsonStart) | ConvertFrom-Json
  } catch {
    if ($_.Exception.Message -like "CONFIG_UNAVAILABLE:*") { throw }
    throw "CONFIG_UNAVAILABLE: $($_.Exception.Message)"
  }
}

function Test-BlockingPreflightStatus([string]$Status) {
  if ($Status -notlike "ERROR:*") { return $false }
  if ($Status -like "ERROR: CONFIG_UNAVAILABLE:*") { return $false }
  return $true
}

function Test-PromptOptimizerAgent {
  try {
    $cfg = Get-EffectiveOpenCodeConfig
    $agent = $cfg.agent.'prompt-optimizer'
    if (-not $agent) { return "ERROR: prompt-optimizer no cargado" }
    if ($agent.mode -notin @("subagent", "all")) { return "ERROR: prompt-optimizer mode=$($agent.mode)" }
    return "ok"
  } catch {
    return "ERROR: $($_.Exception.Message)"
  }
}

function Test-DecisionRouterTool {
  try {
    $cfg = Get-EffectiveOpenCodeConfig
    $tools = $cfg.tools
    if (-not $tools) { $tools = $cfg.tool }
    if (-not $tools) { return "ERROR: bloque tools no cargado" }
    $router = $tools.'decision-router'
    if ($null -eq $router) { return "ERROR: decision-router no cargado" }
    if ($router -eq $false) { return "ERROR: decision-router deshabilitado" }
    return "ok"
  } catch {
    return "ERROR: $($_.Exception.Message)"
  }
}

function Test-AgentRosterAuditTool([string]$ProjectDir) {
  try {
    $cfg = Get-EffectiveOpenCodeConfig
    $tools = $cfg.tools
    if (-not $tools) { $tools = $cfg.tool }
    if (-not $tools) { return "ERROR: bloque tools no cargado" }
    $audit = $tools.'agent-roster-audit'
    if ($null -eq $audit) { return "ERROR: agent-roster-audit no cargado" }
    if ($audit -eq $false) { return "ERROR: agent-roster-audit deshabilitado" }

    $agentsDir = Join-Path $ProjectDir ".opencode\agents"
    $required = @(
      "chief-engineer-assistant", "prompt-optimizer", "product-ux", "Architect-Planner",
      "sre-engineer", "appsec-engineer", "qa-automation-lead", "code-autopilot", "tech-radar-agent",
      "DB2-AS400-Specialist", "DB2-Query-Optimizer", "Redis-Cache-Specialist", "Runtime-Log-Diagnostician",
      "Node-Express-Specialist", "API-Contract-Specialist", "Flutter-Architecture-Specialist",
      "Flutter-UI-Specialist", "Flutter-Data-Specialist", "Flutter-Performance-Specialist",
      "Performance-Analyst", "Visual-Design-Specialist", "Test-Writer", "Test-Specialist",
      "Check-Reviewer", "Simplify-Reviewer", "Technical-Verifier", "truth-teller", "team-curator"
    )
    $missing = @()
    foreach ($name in $required) {
      $file = Join-Path $agentsDir "$name.md"
      if (-not (Test-Path -LiteralPath $file)) { $missing += $name; continue }
      $text = Get-Content -LiteralPath $file -Raw
      if ($text -notmatch "(?m)^mode:\s*(primary|subagent|all)\s*$") { $missing += "$name(mode)" }
    }
    if ($missing.Count -gt 0) { return "ERROR: roster incompleto: $($missing -join ', ')" }
    return "ok ($($required.Count) agentes criticos)"
  } catch {
    return "ERROR: $($_.Exception.Message)"
  }
}

function Test-FlowPolicyCheckTool {
  try {
    $cfg = Get-EffectiveOpenCodeConfig
    $tools = $cfg.tools
    if (-not $tools) { $tools = $cfg.tool }
    if (-not $tools) { return "ERROR: bloque tools no cargado" }
    $flow = $tools.'flow-policy-check'
    if ($null -eq $flow) { return "ERROR: flow-policy-check no cargado" }
    if ($flow -eq $false) { return "ERROR: flow-policy-check deshabilitado" }
    return "ok"
  } catch {
    return "ERROR: $($_.Exception.Message)"
  }
}

function Test-TeamCuratorTool {
  try {
    $cfg = Get-EffectiveOpenCodeConfig
    $tools = $cfg.tools
    if (-not $tools) { $tools = $cfg.tool }
    if (-not $tools) { return "ERROR: bloque tools no cargado" }
    if ($null -eq $tools.'team-curator-report') { return "ERROR: team-curator-report no cargado" }
    if ($tools.'team-curator-report' -eq $false) { return "ERROR: team-curator-report deshabilitado" }
    if (-not $cfg.command -or -not $cfg.command.'team-curator') { return "ERROR: comando team-curator no cargado" }
    return "ok"
  } catch {
    return "ERROR: $($_.Exception.Message)"
  }
}

function Test-ModelAssignmentPolicy([string]$ProjectDir) {
  try {
    $cfg = Get-EffectiveOpenCodeConfig
    $tools = $cfg.tools
    if (-not $tools) { $tools = $cfg.tool }
    if (-not $tools) { return "ERROR: bloque tools no cargado" }
    if ($null -eq $tools.'model-assignment-audit') { return "ERROR: model-assignment-audit no cargado" }
    if ($tools.'model-assignment-audit' -eq $false) { return "ERROR: model-assignment-audit deshabilitado" }

    $routing = Join-Path $ProjectDir ".opencode\config\model-routing.yaml"
    if (-not (Test-Path -LiteralPath $routing)) { return "ERROR: falta .opencode\config\model-routing.yaml" }

    $fallback = Get-Content -LiteralPath (Join-Path $ProjectDir ".opencode\fallback-models.json") -Raw | ConvertFrom-Json
    $fallbackAgents = @($fallback.agents.PSObject.Properties.Name)
    $bad = @()
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $ProjectDir ".opencode\agents") -Filter *.md -File) {
      $text = Get-Content -LiteralPath $file.FullName -Raw
      $model = ""
      if ($text -match "(?m)^model:\s*(.+)$") { $model = $matches[1].Trim().Trim('"').Trim("'") }
      if (-not $model) { $bad += "$($file.BaseName)(sin model)"; continue }
      if ($model -match "^opencode/") { $bad += "$($file.BaseName)(Zen automatico)" }
      if ($model -match "^cursor-acp/gpt") { $bad += "$($file.BaseName)(GPT via Cursor)" }
      if ($model -notmatch "^(openai|cursor-acp|opencode-go)/") { $bad += "$($file.BaseName)(provider no permitido: $model)" }
      if ($fallbackAgents -notcontains $file.BaseName) { $bad += "$($file.BaseName)(sin fallback policy)"; continue }
      $policy = $fallback.agents.PSObject.Properties[$file.BaseName].Value
      if ($policy.primary -ne $model) { $bad += "$($file.BaseName)(frontmatter=$model policy=$($policy.primary))" }
    }
    if ($bad.Count -gt 0) { return "ERROR: $($bad -join ', ')" }
    return "ok"
  } catch {
    return "ERROR: $($_.Exception.Message)"
  }
}

function Test-WorkflowStatePolicy([string]$ProjectDir) {
  try {
    $cfg = Get-EffectiveOpenCodeConfig
    $tools = $cfg.tools
    if (-not $tools) { $tools = $cfg.tool }
    if (-not $tools) { return "ERROR: bloque tools no cargado" }
    foreach ($toolName in @("workflow-state-audit", "plan-approval-gate")) {
      if ($null -eq $tools.$toolName) { return "ERROR: $toolName no cargado" }
      if ($tools.$toolName -eq $false) { return "ERROR: $toolName deshabilitado" }
    }
    foreach ($commandName in @("state-audit", "approve-plan")) {
      if (-not $cfg.command -or -not $cfg.command.$commandName) { return "ERROR: comando $commandName no cargado" }
    }

    $stateMachine = Join-Path $ProjectDir ".opencode\config\workflow-state-machine.yaml"
    if (-not (Test-Path -LiteralPath $stateMachine)) { return "ERROR: falta .opencode\config\workflow-state-machine.yaml" }
    $text = Get-Content -LiteralPath $stateMachine -Raw
    $requiredTokens = @(
      "INTAKE",
      "ROUTED",
      "DISCOVERY",
      "PLAN_READY",
      "WAITING_PLAN_APPROVAL",
      "IMPLEMENTING",
      "VERIFYING",
      "STAGING",
      "WAITING_PRODUCTION_APPROVAL",
      "PRODUCTION_DEPLOY",
      "REPORTING",
      "BLOCKED",
      "DONE",
      "plan_before_code",
      "Javier approved plan",
      "Javier adelante",
      "production-approval-gate token",
      "TEAM_TRACE entry",
      "idempotency_key"
    )
    $missing = @()
    foreach ($token in $requiredTokens) {
      if (-not $text.Contains($token)) { $missing += $token }
    }
    if ($missing.Count -gt 0) { return "ERROR: maquina de estados incompleta: $($missing -join ', ')" }
    return "ok"
  } catch {
    return "ERROR: $($_.Exception.Message)"
  }
}

function Test-TaskClassificationConfig([string]$ProjectDir) {
  try {
    $required = @(
      ".opencode\config\task-classification.yaml",
      ".opencode\config\handoff-contract.yaml",
      ".opencode\config\autonomous-flow.yaml",
      ".opencode\config\model-routing.yaml",
      ".opencode\config\workflow-state-machine.yaml",
      ".opencode\config\team-curator.yaml",
      ".opencode\commands\classify.md",
      ".opencode\commands\route-eval.md",
      ".opencode\commands\model-audit.md",
      ".opencode\commands\team-curator.md",
      ".opencode\commands\state-audit.md",
      ".opencode\commands\approve-plan.md"
    )
    foreach ($relative in $required) {
      $path = Join-Path $ProjectDir $relative
      if (-not (Test-Path -LiteralPath $path)) { return "ERROR: falta $relative" }
    }
    $cfg = Get-EffectiveOpenCodeConfig
    if (-not $cfg.command -or -not $cfg.command.classify) { return "ERROR: comando classify no cargado" }
    if (-not $cfg.command.'route-eval') { return "ERROR: comando route-eval no cargado" }
    if (-not $cfg.command.'model-audit') { return "ERROR: comando model-audit no cargado" }
    if (-not $cfg.command.'team-curator') { return "ERROR: comando team-curator no cargado" }
    if (-not $cfg.command.'state-audit') { return "ERROR: comando state-audit no cargado" }
    if (-not $cfg.command.'approve-plan') { return "ERROR: comando approve-plan no cargado" }
    return "ok"
  } catch {
    return "ERROR: $($_.Exception.Message)"
  }
}

function Test-ZenProviderStatus {
  try {
    $cfg = Get-EffectiveOpenCodeConfig
    if (-not (@($cfg.enabled_providers) -contains "opencode")) {
      return "ERROR: proveedor opencode Zen no esta en enabled_providers"
    }
    $policies = @($cfg.experimental.policies | Where-Object {
      $_.action -eq "provider.use" -and $_.resource -eq "opencode" -and $_.effect -eq "allow"
    })
    if ($policies.Count -lt 1) { return "ERROR: provider.use opencode no permitido" }

    $authText = ""
    try { $authText = ((& $OpenCode auth list 2>$null) -join "`n") } catch {}
    if ($authText -match "OpenCode Zen") { return "conectado" }
    return "preparado_pendiente_/connect"
  } catch {
    return "ERROR: $($_.Exception.Message)"
  }
}

function Test-CursorPinnedAgents {
  try {
    $cfg = Get-EffectiveOpenCodeConfig
    $pinned = @($cfg.agent.PSObject.Properties |
      Where-Object { $_.Value.model -like "cursor-acp/*" } |
      ForEach-Object { $_.Name })
    if ($pinned.Count -gt 0) { return "ok ($($pinned.Count) agentes Cursor ACP: $($pinned -join ', '))" }
    return "ok (0 agentes Cursor ACP)"
  } catch {
    return "ERROR: $($_.Exception.Message)"
  }
}

function Test-CursorCliModels {
  $cursorCmd = Join-Path $HomeDir "AppData\Local\cursor-agent\cursor-agent.cmd"
  if (-not (Test-Path -LiteralPath $cursorCmd)) { return "missing" }
  try {
    $job = Start-Job -ScriptBlock {
      param($Cmd)
      try { (& $Cmd models 2>&1) -join " " } catch { "" }
    } -ArgumentList $cursorCmd
    if (-not (Wait-Job $job -Timeout 8)) {
      Stop-Job $job -Force -ErrorAction SilentlyContinue
      Remove-Job $job -Force -ErrorAction SilentlyContinue
      return "deferred:timeout"
    }
    $output = (Receive-Job $job).Trim()
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    if ($output -match "No models available") { return "no_models" }
    if ($output) { return "models_available" }
    return "unknown"
  } catch {
    return "ERROR: $($_.Exception.Message)"
  }
}

function Test-BeadsCli {
  try {
    $output = (& bd ready --json 2>&1) -join " "
    if ($LASTEXITCODE -ne 0) { return "ERROR: $output" }
    return "ok"
  } catch {
    return "ERROR: $($_.Exception.Message)"
  }
}

function Test-CriticalMcpSet {
  try {
    $cfg = Get-EffectiveOpenCodeConfig
    $critical = @(
      "context7-local", "ddg-search", "fetch-local",
      "dart-flutter-mcp", "pub-mcp", "ibm-db2-mcp", "gmp-deploy-ssh",
      "playwright", "github", "memory",
      "sequential-thinking"
    )
    $missing = @()
    $disabled = @()
    foreach ($name in $critical) {
      $entry = $cfg.mcp.$name
      if (-not $entry) {
        $missing += $name
      } elseif ($entry.enabled -eq $false) {
        $disabled += $name
      }
    }
    if ($missing.Count -gt 0) { return "ERROR: faltan MCP criticos: $($missing -join ', ')" }
    if ($disabled.Count -gt 0) { return "ERROR: MCP criticos deshabilitados: $($disabled -join ', ')" }
    return "ok ($($critical.Count) criticos)"
  } catch {
    return "ERROR: $($_.Exception.Message)"
  }
}

function Test-McpRuntimeStatus {
  try {
    $critical = @(
      "context7-local", "ddg-search", "fetch-local",
      "dart-flutter-mcp", "pub-mcp", "ibm-db2-mcp", "gmp-deploy-ssh",
      "playwright", "github", "memory",
      "sequential-thinking"
    )
    $raw = (& cmd /c "opencode mcp list 2>NUL") -join "`n"
    $ansiPattern = [string]([char]27) + "\[[0-9;]*[A-Za-z]"
    $text = $raw -replace $ansiPattern, ""
    $missing = @()
    foreach ($name in $critical) {
      if ($text -notmatch "(?m)$([regex]::Escape($name))\s+connected") {
        $missing += $name
      }
    }
    if ($missing.Count -gt 0) { return "ERROR: MCP no conectados: $($missing -join ', ')" }
    return "ok ($($critical.Count) conectados)"
  } catch {
    return "ERROR: $($_.Exception.Message)"
  }
}

function Test-AgentVisibilityPolicy {
  try {
    $cfg = Get-EffectiveOpenCodeConfig
    $agents = @($cfg.agent.PSObject.Properties | Where-Object { -not $_.Value.disable })
    $primary = @($agents | Where-Object { $_.Value.mode -in @("primary", "all") })
    $badAlias = @($primary | Where-Object { $_.Name -eq "chief-engineer-assitant" })
    if ($badAlias.Count -gt 0) { return "ERROR: alias con errata sigue como agente selectable" }

    $expected = @(
      "chief-engineer-assistant", "prompt-optimizer", "product-ux", "Architect-Planner",
      "sre-engineer", "appsec-engineer", "qa-automation-lead", "code-autopilot", "tech-radar-agent",
      "DB2-Query-Optimizer", "Redis-Cache-Specialist", "Runtime-Log-Diagnostician",
      "Flutter-Architecture-Specialist", "Flutter-Performance-Specialist", "API-Contract-Specialist",
      "Visual-Design-Specialist", "Technical-Verifier", "DB2-AS400-Specialist",
      "Node-Express-Specialist", "Flutter-UI-Specialist", "Flutter-Data-Specialist",
      "Performance-Analyst", "Test-Writer", "Test-Specialist", "Check-Reviewer",
      "Simplify-Reviewer", "truth-teller"
    )
    $visibleNames = @($primary | ForEach-Object { $_.Name })
    $missing = @($expected | Where-Object { $visibleNames -notcontains $_ })
    if ($missing.Count -gt 0) { return "ERROR: Layer 1 no selectable: $($missing -join ', ')" }
    return "ok (Layer1 selectable=$($expected.Count), primary_total=$($primary.Count))"
  } catch {
    return "ERROR: $($_.Exception.Message)"
  }
}

function Test-ForbiddenMcpPolicy {
  try {
    $cfg = Get-EffectiveOpenCodeConfig
    $forbidden = @("postgres", "supabase")
    $enabledForbidden = @()
    foreach ($name in $forbidden) {
      if ($cfg.mcp.$name -and $cfg.mcp.$name.enabled -ne $false) { $enabledForbidden += $name }
    }
    if ($enabledForbidden.Count -gt 0) { return "ERROR: MCP prohibidos para GMP activos: $($enabledForbidden -join ', ')" }
    return "ok"
  } catch {
    return "ERROR: $($_.Exception.Message)"
  }
}

function Test-UnsupportedActiveModels([string]$ProjectDir) {
  $activeFiles = @(
    (Join-Path $ProjectDir "opencode.json"),
    (Join-Path $ProjectDir ".opencode\opencode.json"),
    (Join-Path $ProjectDir ".opencode\fallback-models.json")
  )
  $activeFiles += @(Get-ChildItem -LiteralPath (Join-Path $ProjectDir ".opencode\agents") -Filter *.md -File -ErrorAction SilentlyContinue | ForEach-Object FullName)
  $activeFiles += @(Get-ChildItem -LiteralPath (Join-Path $ProjectDir ".opencode\commands") -Filter *.md -File -ErrorAction SilentlyContinue | ForEach-Object FullName)

  $hits = @()
  foreach ($file in $activeFiles) {
    if (-not $file -or -not (Test-Path -LiteralPath $file)) { continue }
    $matches = Select-String -LiteralPath $file -Pattern "gpt-5.5-pro" -SimpleMatch -ErrorAction SilentlyContinue
    foreach ($match in $matches) {
      $relative = $match.Path.Replace($ProjectDir, "").TrimStart("\")
      $hits += "${relative}:$($match.LineNumber)"
    }
  }
  if ($hits.Count -gt 0) { return "ERROR: modelo no soportado en activo: $($hits -join ', ')" }
  return "ok"
}

Load-Env
Ensure-OpenCodeWebAuth
$cursorApiAlias = @("CURSOR_ACP_KEY", "CURSOR_TOKEN", "CURSOR_AGENT_TOKEN") |
  ForEach-Object { Get-Item "Env:$_" -ErrorAction SilentlyContinue } |
  Where-Object { $_ -and $_.Value } |
  Select-Object -First 1
if (-not $env:CURSOR_API_KEY -and $cursorApiAlias) {
  $env:CURSOR_API_KEY = $cursorApiAlias.Value
}
$env:XDG_CONFIG_HOME = Join-Path $HomeDir ".opencode-runtime"
$env:OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = "12000"
$env:OPENCODE_EXPERIMENTAL_LSP_TOOL = "true"
$env:CURSOR_ACP_MCP_BRIDGE = "false"
$env:CURSOR_ACP_LOG_SILENT = "true"
$env:PATH = "C:\Users\Javier\.bun\bin;C:\Program Files\Git\usr\bin;C:\nvm4w\nodejs;C:\Program Files\nodejs;C:\Users\Javier\.local\bin;C:\Users\Javier\AppData\Roaming\npm;C:\Users\Javier\AppData\Roaming\Python\Python311\Scripts;C:\Python311;C:\Users\Javier\AppData\Local\cursor-agent;" + $env:PATH
if (Test-Path -LiteralPath (Join-Path $HomeDir "AppData\Local\cursor-agent\cursor-agent.cmd")) {
  $env:CURSOR_AGENT_EXECUTABLE = Join-Path $HomeDir "AppData\Local\cursor-agent\cursor-agent.cmd"
}
$mcpEnvStatus = Ensure-IbmDb2McpEnvironment

if ($Project -eq "gmp") {
  $ProjectName = "GMP"
  $ProjectDir = Join-Path $HomeDir "Desktop\Repositorios\gmp_app_mobilidad"
  $Port = 3090
  $ExpectedAgents = 40
  $env:ODBC_DSN = "GMP"
  if (-not $env:ODBC_SCHEMA) { $env:ODBC_SCHEMA = "JAVIER" }
  $env:OPENCODE_AGENT = "chief-engineer-assistant"
  if (-not $env:MOBILE_TRIGGER_KEYWORD) { $env:MOBILE_TRIGGER_KEYWORD = "Equipo" }
} else {
  $ProjectName = "GRANJA"
  $ProjectDir = Join-Path $HomeDir "Desktop\Repositorios\granja_mari_pepa"
  $Port = 3091
  $ExpectedAgents = 13
  $env:ODBC_DSN = "GMP"
  if (-not $env:ODBC_SCHEMA) { $env:ODBC_SCHEMA = "JAVIER" }
}

if (-not (Test-Path -LiteralPath $ProjectDir)) { throw "Ruta de proyecto no existe: $ProjectDir" }
Set-Location -LiteralPath $ProjectDir
$cursorAcpStatus = Start-CursorAcpService $ProjectDir $Port
$ProjectRuntimeHome = Join-Path $ProjectDir ".opencode-runtime"
$env:XDG_CONFIG_HOME = $ProjectRuntimeHome
$env:XDG_DATA_HOME = $ProjectRuntimeHome
$env:XDG_STATE_HOME = $ProjectRuntimeHome
$env:XDG_CACHE_HOME = $ProjectRuntimeHome
$accountAuthStatus = Sync-OpenCodeAccountAuth $ProjectRuntimeHome
$runtimeConfigDir = Join-Path $ProjectRuntimeHome "opencode"
$runtimeConfig = Join-Path $runtimeConfigDir "opencode.json"
$projectConfig = Join-Path $ProjectDir "opencode.json"
New-Item -ItemType Directory -Path $runtimeConfigDir -Force | Out-Null
if (Test-Path -LiteralPath $projectConfig) {
  Copy-Item -LiteralPath $projectConfig -Destination $runtimeConfig -Force
}
Repair-McpCommandArrays (Join-Path $ProjectDir "opencode.json")
Repair-McpCommandArrays (Join-Path $ProjectDir ".opencode\opencode.json")
Repair-McpCommandArrays $runtimeConfig
$db2OdbcStatus = if ($Project -eq "gmp") { Ensure-GmpDb2Odbc $ProjectDir } else { "no_aplica" }
if ($Project -eq "gmp" -and $env:ODBC_DSN) {
  Set-EnvFileValue "ODBC_DSN" $env:ODBC_DSN
  Set-EnvFileValue "ODBC_SCHEMA" $env:ODBC_SCHEMA
}
$mcpEnvStatus = Ensure-IbmDb2McpEnvironment
$webRestartStatus = Restart-OpenCodeWebIfRequested $Port

New-Item -ItemType Directory -Path ".opencode",".opencode\memory",".opencode\state",".opencode\metrics",".opencode\sandbox",".opencode\doom-loops",".opencode\logs" -Force | Out-Null
if (-not (Test-Path ".opencode\TEAM_TRACE.jsonl")) { New-Item -ItemType File -Path ".opencode\TEAM_TRACE.jsonl" -Force | Out-Null }
if (-not (Test-Path ".opencode\tokens.jsonl")) { New-Item -ItemType File -Path ".opencode\tokens.jsonl" -Force | Out-Null }
$traceRotationStatus = Rotate-IfLarge ".opencode\TEAM_TRACE.jsonl" 52428800 5
$tokenRotationStatus = Rotate-IfLarge ".opencode\tokens.jsonl" 10485760 5
$integrityStatus = if ($Project -eq "gmp") { Invoke-StartupIntegrityCheck $ProjectDir } else { "no_aplica" }
$mobileSnapshotStatus = Invoke-MobileOperationalSnapshot $ProjectDir

function Wait-WebAuthReady([int]$Port, [int]$MaxAttempts = 48, [int]$SleepSec = 5) {
  for ($i = 0; $i -lt $MaxAttempts; $i++) {
    if (Test-WebAuthenticated "http://127.0.0.1:$Port" 5) { return $true }
    if (($i + 1) % 6 -eq 0) {
      Write-Host "Esperando OpenCode Web con auth ($($i + 1)/$MaxAttempts)..."
    }
    Start-Sleep -Seconds $SleepSec
  }
  return $false
}

function Complete-WebReadyExit([string]$ProjectDir, [int]$Port) {
  $metricsStatus = Start-MetricsServer $ProjectDir
  $readinessStatus = "deferred:post-web-startup"
  if ($Project -eq "gmp") {
    $postStartup = Invoke-PostWebStartup $ProjectDir
    Write-Host "Post-arranque: $postStartup"
  }
  Write-Host "OpenCode Web ya esta escuchando y responde con auth en el puerto $Port."
  Write-Host "Metricas: $metricsStatus"
  Write-Host "Readiness smoke: $readinessStatus"
  exit 0
}

if (-not $NoWeb -and (Test-Tcp "127.0.0.1" $Port 1000)) {
  if (Test-WebAuthenticated "http://127.0.0.1:$Port" 5) {
    Complete-WebReadyExit $ProjectDir $Port
  }
  Write-Host "Puerto $Port activo; esperando que OpenCode Web termine de arrancar..."
  if (Wait-WebAuthReady $Port) {
    Complete-WebReadyExit $ProjectDir $Port
  }
  Write-Host "Puerto $Port ocupado, pero OpenCode Web no responde con auth tras espera. Cierra opencode.exe y vuelve a ejecutar este script."
  exit 1
}

if ($env:OPENCODE_FULL_PREFLIGHT -ne "1") {
  $metricsStatus = Start-MetricsServer $ProjectDir
  $memoryCount = Get-MemoryCount $ProjectDir
  $pendingItems = @(Get-PendingStateSummary $ProjectDir)
  $pendingCount = $pendingItems.Count
  $staleCount = Get-StaleStateCount $ProjectDir
  $skillCount = Get-ValidSkillCount $ProjectDir
  $cursorCliStatus = Test-CursorCliModels
  $beadsCliStatus = Test-BeadsCli
  $db2Status = if (Test-Connection -ComputerName "192.168.1.22" -Count 1 -Quiet -ErrorAction SilentlyContinue) { "red_ok" } else { "degradado" }
  $sshStatus = if (Test-Connection -ComputerName "192.168.1.230" -Count 1 -Quiet -ErrorAction SilentlyContinue) { "red_ok" } else { "degradado" }
  $imageStatus = if ($Project -eq "gmp" -and (Test-Connection -ComputerName "192.168.1.191" -Count 1 -Quiet -ErrorAction SilentlyContinue)) { "red_ok" } elseif ($Project -eq "gmp") { "degradado" } else { "no_aplica" }

  $fastPayload = [ordered]@{
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
    project = $ProjectName
    mode = "fast_start"
    agent = $env:OPENCODE_AGENT
    expected_agents = $ExpectedAgents
    web_auth_status = if ($env:OPENCODE_SERVER_PASSWORD) { "activo" } else { "sin_password" }
    account_auth_status = $accountAuthStatus
    web_restart_status = $webRestartStatus
    db2_status = $db2Status
    db2_odbc_status = $db2OdbcStatus
    odbc_dsn = $env:ODBC_DSN
    mcp_env_status = $mcpEnvStatus
    backend_status = $sshStatus
    image_status = $imageStatus
    cursor_cli_status = $cursorCliStatus
    beads_cli_status = $beadsCliStatus
    cursor_acp_service_status = $cursorAcpStatus
    metrics_status = $metricsStatus
    memory_count = $memoryCount
    skill_count = $skillCount
    pending_state_count = $pendingCount
    pending_states = $pendingItems
    stale_state_count = $staleCount
    startup_integrity_status = $integrityStatus
    trace_rotation_status = $traceRotationStatus
    token_rotation_status = $tokenRotationStatus
    mobile_operational_snapshot_status = $mobileSnapshotStatus
    deep_audit = "omitido_en_arranque; ejecutar con OPENCODE_FULL_PREFLIGHT=1"
  }
  Write-Utf8NoBom ".opencode\state\preflight-last.json" (($fastPayload | ConvertTo-Json -Depth 20) + "`n")

  $summary = @"
[OK] [$ProjectName] arranque rapido
Web local: http://127.0.0.1:$Port
Web movil: http://100.107.11.80:$Port
Agente: $env:OPENCODE_AGENT
OpenCode Web restart: $webRestartStatus
OpenCode account auth: $accountAuthStatus
DB2 192.168.1.22: $db2Status
DB2 ODBC: $db2OdbcStatus ($env:ODBC_DSN)
MCP DB2 env: $mcpEnvStatus
Backend 192.168.1.230: $sshStatus
Imagenes 192.168.1.191: $imageStatus
Cursor CLI modelos: $cursorCliStatus
Beads CLI: $beadsCliStatus
Cursor ACP service: $cursorAcpStatus
Metricas: $metricsStatus
Memoria: $memoryCount entradas
Skills: $skillCount validas
Tareas activas reales: $pendingCount
Estados antiguos/bloqueados no activos: $staleCount
Integridad arranque: $integrityStatus
Trazas: $traceRotationStatus
Autopilot movil: $mobileSnapshotStatus (checks completos tras arranque Web)
Auditoria profunda: diferida para no bloquear el arranque
"@
  Write-Host $summary
  Send-Tg $summary
  if ($NoWeb) { exit 0 }

  $webArgs = @(
    "web",
    "--print-logs",
    "--log-level", "INFO",
    "--port", "$Port",
    "--hostname", "0.0.0.0",
    "--mdns",
    "--mdns-domain", "gmp-opencode.local",
    "--cors", "http://localhost:$Port",
    "--cors", "http://100.107.11.80:$Port",
    "--cors", "app://opencode.ai"
  )
  $logFile = Join-Path $ProjectDir (".opencode\logs\opencode-web-fast-{0}.out.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
  $errLogFile = Join-Path $ProjectDir (".opencode\logs\opencode-web-fast-{0}.err.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
  Write-Host "Logs OpenCode Web: $logFile"
  Write-Host "Errores OpenCode Web: $errLogFile"
  Start-Process -FilePath $OpenCode -ArgumentList $webArgs -WorkingDirectory $ProjectDir -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError $errLogFile
  $authOk = Wait-WebAuthReady $Port
  if ($authOk) {
    Write-Host "OpenCode Web iniciado: http://127.0.0.1:$Port"
    if ($Project -eq "gmp") {
      $postStartup = Invoke-PostWebStartup $ProjectDir
      Write-Host "Post-arranque: $postStartup"
    }
    exit 0
  }
  Write-Host "ERROR: OpenCode Web no respondio con auth en http://127.0.0.1:$Port. Revisa $logFile y $errLogFile"
  exit 1
}

$fallbackStatus = Repair-FallbackModels
$toolSchemaStatus = Test-CustomToolSchemas $ProjectDir
$unsupportedModelStatus = Test-UnsupportedActiveModels $ProjectDir
if (Test-BlockingPreflightStatus $unsupportedModelStatus) { throw $unsupportedModelStatus }
$promptOptimizerStatus = Test-PromptOptimizerAgent
if (Test-BlockingPreflightStatus $promptOptimizerStatus) { throw $promptOptimizerStatus }
$decisionRouterStatus = Test-DecisionRouterTool
if (Test-BlockingPreflightStatus $decisionRouterStatus) { throw $decisionRouterStatus }
$agentRosterAuditStatus = Test-AgentRosterAuditTool $ProjectDir
if (Test-BlockingPreflightStatus $agentRosterAuditStatus) { throw $agentRosterAuditStatus }
$flowPolicyCheckStatus = Test-FlowPolicyCheckTool
if (Test-BlockingPreflightStatus $flowPolicyCheckStatus) { throw $flowPolicyCheckStatus }
$taskClassificationStatus = Test-TaskClassificationConfig $ProjectDir
if (Test-BlockingPreflightStatus $taskClassificationStatus) { throw $taskClassificationStatus }
$teamCuratorStatus = Test-TeamCuratorTool
if (Test-BlockingPreflightStatus $teamCuratorStatus) { throw $teamCuratorStatus }
$modelAssignmentStatus = Test-ModelAssignmentPolicy $ProjectDir
if (Test-BlockingPreflightStatus $modelAssignmentStatus) { throw $modelAssignmentStatus }
$workflowStateStatus = Test-WorkflowStatePolicy $ProjectDir
if (Test-BlockingPreflightStatus $workflowStateStatus) { throw $workflowStateStatus }
$zenProviderStatus = Test-ZenProviderStatus
if (Test-BlockingPreflightStatus $zenProviderStatus) { throw $zenProviderStatus }
$cursorPinnedStatus = Test-CursorPinnedAgents
$cursorCliStatus = Test-CursorCliModels
$beadsCliStatus = Test-BeadsCli
$criticalMcpStatus = Test-CriticalMcpSet
if (Test-BlockingPreflightStatus $criticalMcpStatus) { throw $criticalMcpStatus }
$mcpRuntimeStatus = Test-McpRuntimeStatus
# Runtime MCP availability is reported in readiness, but it must not prevent
# OpenCode Web from starting. Tasks that require a degraded MCP will block later.
$forbiddenMcpStatus = Test-ForbiddenMcpPolicy
if (Test-BlockingPreflightStatus $forbiddenMcpStatus) { throw $forbiddenMcpStatus }
$agentVisibilityStatus = Test-AgentVisibilityPolicy
if (Test-BlockingPreflightStatus $agentVisibilityStatus) { throw $agentVisibilityStatus }

$cursorAvailable = Test-Url "http://127.0.0.1:32124/v1/models" 5
$cursorRuntimeStatus = Set-CursorRuntimeAvailability $cursorAvailable
$cursorStatus = if ($cursorAvailable) { "listo" } else { "standby_manual" }
$configuredProviders = @("openai", "cursor-acp", "opencode-go", "opencode")
$providerLines = @()
try { $providerLines = @(& $OpenCode models | Where-Object { $_ -match "/" }) } catch {}
$providers = @($providerLines | ForEach-Object { ($_ -split "/",2)[0] } | Sort-Object -Unique)
$db2Status = if (Test-Connection -ComputerName "192.168.1.22" -Count 1 -Quiet -ErrorAction SilentlyContinue) { "red_ok" } else { "degradado" }
$sshStatus = if (Test-Connection -ComputerName "192.168.1.230" -Count 1 -Quiet -ErrorAction SilentlyContinue) { "red_ok" } else { "degradado" }
$imageStatus = if ($Project -eq "gmp" -and (Test-Connection -ComputerName "192.168.1.191" -Count 1 -Quiet -ErrorAction SilentlyContinue)) { "red_ok" } elseif ($Project -eq "gmp") { "degradado" } else { "no_aplica" }
$chromaStatus = Ensure-Chroma $ProjectDir
$redisStatus = if (Test-Tcp "localhost" 6379 1000) { "listo" } else { "degradado" }
$metricsStatus = Start-MetricsServer $ProjectDir
$curatorReportStatus = Invoke-TeamCuratorRunner $ProjectDir
$dockerStatus = try { docker info --format "{{.ServerVersion}}" 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { "listo" } else { "degradado" } } catch { "degradado" }
if ($Project -eq "gmp") {
  $chromaStatus = if (Test-RemoteGmp "/tmp/remote-check-services.sh | grep -q '^chromadb:ok'") { "remoto_listo" } else { "degradado" }
  $redisStatus = if (Test-RemoteGmp "redis-cli ping | grep -q PONG") { "remoto_listo" } else { "degradado" }
  $dockerStatus = if (Test-RemoteGmp "docker version --format '{{.Server.Version}}' >/dev/null") { "remoto_listo" } else { "degradado" }
  $voiceStatus = if (Test-RemoteGmp "curl -sf http://localhost:8765/health >/dev/null") { "remoto_listo" } else { "degradado" }
  $backendHealthStatus = if (Test-RemoteGmp "curl -sf -A GMP-SRE-HealthCheck/1.0 http://localhost:3335/api/health >/dev/null") { "remoto_listo" } else { "degradado" }
} else {
  $voiceStatus = "no_aplica"
  $backendHealthStatus = $sshStatus
}
$memoryCount = Get-MemoryCount $ProjectDir
$pendingItems = @(Get-PendingStateSummary $ProjectDir)
$pendingCount = $pendingItems.Count
$staleCount = Get-StaleStateCount $ProjectDir
$skillCount = Get-ValidSkillCount $ProjectDir
$agentCount = Get-AgentCount
$webAuthStatus = if ($env:OPENCODE_SERVER_PASSWORD) { "activo" } else { "NO_CONFIGURADO" }

$preflightPayload = [ordered]@{
  generated_at = (Get-Date).ToUniversalTime().ToString("o")
  project = $ProjectName
  fallback_status = $fallbackStatus
  custom_tools_status = $toolSchemaStatus
  unsupported_model_status = $unsupportedModelStatus
  prompt_optimizer_status = $promptOptimizerStatus
  decision_router_status = $decisionRouterStatus
  agent_roster_audit_status = $agentRosterAuditStatus
  flow_policy_check_status = $flowPolicyCheckStatus
  task_classification_status = $taskClassificationStatus
  team_curator_status = $teamCuratorStatus
  model_assignment_status = $modelAssignmentStatus
  workflow_state_status = $workflowStateStatus
  cursor_pinned_status = $cursorPinnedStatus
  cursor_cli_status = $cursorCliStatus
  beads_cli_status = $beadsCliStatus
  cursor_acp_service_status = $cursorAcpStatus
  critical_mcp_status = $criticalMcpStatus
  mcp_runtime_status = $mcpRuntimeStatus
  forbidden_mcp_status = $forbiddenMcpStatus
  agent_visibility_status = $agentVisibilityStatus
  zen_provider_status = $zenProviderStatus
  cursor_status = $cursorStatus
  cursor_runtime_status = $cursorRuntimeStatus
  configured_providers = $configuredProviders
  listed_providers = $providers
  agent_count = $agentCount
  expected_agents = $ExpectedAgents
  web_restart_status = $webRestartStatus
  db2_status = $db2Status
  db2_odbc_status = $db2OdbcStatus
  odbc_dsn = $env:ODBC_DSN
  mcp_env_status = $mcpEnvStatus
  backend_status = $sshStatus
  backend_health_status = $backendHealthStatus
  image_status = $imageStatus
  web_auth_status = $webAuthStatus
  account_auth_status = $accountAuthStatus
  chroma_status = $chromaStatus
  redis_status = $redisStatus
  metrics_status = $metricsStatus
  curator_report_status = $curatorReportStatus
  docker_status = $dockerStatus
  voice_status = $voiceStatus
  memory_count = $memoryCount
  skill_count = $skillCount
  pending_state_count = $pendingCount
  pending_states = $pendingItems
  stale_state_count = $staleCount
  trace_rotation_status = $traceRotationStatus
  token_rotation_status = $tokenRotationStatus
  mobile_operational_snapshot_status = $mobileSnapshotStatus
}
Write-PreflightState $ProjectDir $preflightPayload
$readinessStatus = Invoke-ReadinessSmoke $ProjectDir
$preflightPayload["readiness_status"] = $readinessStatus
Write-PreflightState $ProjectDir $preflightPayload

$summary = @"
Entrada V4: chief-engineer-assistant
Alias compatible: chief-engineer-assitant
Preflight fallback-models: $fallbackStatus
Preflight custom tools: $toolSchemaStatus
Preflight modelos activos: $unsupportedModelStatus
Preflight prompt optimizer: $promptOptimizerStatus
Preflight decision router: $decisionRouterStatus
Preflight agent roster audit: $agentRosterAuditStatus
Preflight flow policy check: $flowPolicyCheckStatus
Preflight task classification: $taskClassificationStatus
Preflight team curator: $teamCuratorStatus
Preflight model assignment: $modelAssignmentStatus
Preflight workflow state: $workflowStateStatus
Preflight Cursor pinned agents: $cursorPinnedStatus
Preflight Cursor CLI models: $cursorCliStatus
Preflight Beads CLI: $beadsCliStatus
Preflight MCP criticos: $criticalMcpStatus
Preflight MCP runtime: $mcpRuntimeStatus
Preflight MCP prohibidos: $forbiddenMcpStatus
Preflight agentes visibles: $agentVisibilityStatus
OpenCode Zen: $zenProviderStatus
OpenCode Zen manual/free: opencode/big-pickle, opencode/deepseek-v4-flash-free, opencode/mimo-v2.5-free, opencode/minimax-m3-free, opencode/nemotron-3-super-free
[OK] [$ProjectName] listo
Proveedores configurados: $($configuredProviders.Count)/4 ($($configuredProviders -join ", "))
Proveedores con modelos listados: $($providers.Count)/4 ($($providers -join ", "))
Agentes: $agentCount/$ExpectedAgents proyecto
OpenCode Web restart: $webRestartStatus
DB2 192.168.1.22: $db2Status
DB2 ODBC: $db2OdbcStatus ($env:ODBC_DSN)
MCP DB2 env: $mcpEnvStatus
Backend 192.168.1.230: $sshStatus
Backend health: $backendHealthStatus
Imagenes 192.168.1.191: $imageStatus
Cursor ACP: $cursorStatus
Cursor runtime: $cursorRuntimeStatus
OpenCode Web Auth: $webAuthStatus
OpenCode account auth: $accountAuthStatus
ChromaDB: $chromaStatus
Redis: $redisStatus
Metricas: $metricsStatus
Readiness smoke: $readinessStatus
Team Curator report: $curatorReportStatus
Docker: $dockerStatus
Voz ElevenLabs: $voiceStatus
Memoria: $memoryCount entradas
Skills: $skillCount validas
Tareas activas reales: $pendingCount
Estados antiguos/bloqueados no activos: $staleCount
Integridad arranque: $integrityStatus
Trazas: $traceRotationStatus
Autopilot movil: $mobileSnapshotStatus (checks completos tras arranque Web)
"@

Write-Host $summary
Send-Tg $summary

if ($NoWeb) { exit 0 }

$logFile = Join-Path $ProjectDir (".opencode\logs\opencode-web-{0}.out.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$errLogFile = Join-Path $ProjectDir (".opencode\logs\opencode-web-{0}.err.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
Write-Host "Logs OpenCode Web: $logFile"
Write-Host "Errores OpenCode Web: $errLogFile"
$webArgs = @(
  "web",
  "--print-logs",
  "--log-level", "INFO",
  "--port", "$Port",
  "--hostname", "0.0.0.0",
  "--mdns",
  "--mdns-domain", "gmp-opencode.local",
  "--cors", "http://localhost:$Port",
  "--cors", "http://100.107.11.80:$Port",
  "--cors", "app://opencode.ai"
)

Start-Process -FilePath $OpenCode -ArgumentList $webArgs -WorkingDirectory $ProjectDir -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError $errLogFile
Start-Sleep -Seconds 8
if (Test-WebAuthenticated "http://127.0.0.1:$Port" 5) {
  Write-Host "OpenCode Web iniciado: http://127.0.0.1:$Port"
  exit 0
}

Write-Host "ERROR: OpenCode Web no respondio con auth en http://127.0.0.1:$Port. Revisa $logFile y $errLogFile"
exit 1
