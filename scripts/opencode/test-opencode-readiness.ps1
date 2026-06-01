param(
  [ValidateSet("gmp","granja","all")][string]$Project = "all",
  [string]$HomeDir,
  [switch]$Json
)

$ErrorActionPreference = "Stop"
if (-not $HomeDir) {
  $JavierHome = "C:\Users\Javier"
  $HomeDir = if (Test-Path -LiteralPath $JavierHome) { $JavierHome } else { [Environment]::GetFolderPath("UserProfile") }
}
$OpenCode = "C:\nvm4w\nodejs\opencode.cmd"
$Projects = @{
  gmp = Join-Path $HomeDir "Desktop\Repositorios\gmp_app_mobilidad"
  granja = Join-Path $HomeDir "Desktop\Repositorios\granja_mari_pepa"
}

function Test-Url([string]$Url, [int]$TimeoutSec = 3) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
    return [pscustomobject]@{ ok = ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300); detail = "HTTP $($response.StatusCode)" }
  } catch {
    return [pscustomobject]@{ ok = $false; detail = $_.Exception.Message }
  }
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

function Add-Check([System.Collections.Generic.List[object]]$Checks, [string]$Name, [bool]$Ok, [string]$Detail, [string]$Severity = "block") {
  $Checks.Add([pscustomobject]@{ name = $Name; ok = $Ok; detail = $Detail; severity = $Severity }) | Out-Null
}

function Test-NoOpusDefault([object]$Cfg, [string]$Dir) {
  $hits = @()
  foreach ($agent in @($Cfg.agent.PSObject.Properties | Where-Object { -not $_.Value.disable })) {
    if ($agent.Value.model -match "opus") { $hits += "$($agent.Name)=$($agent.Value.model)" }
  }
  if (Test-Path -LiteralPath (Join-Path $Dir ".opencode\fallback-models.json")) {
    $fallbackJson = Get-Content -LiteralPath (Join-Path $Dir ".opencode\fallback-models.json") -Raw | ConvertFrom-Json
    $fallbackText = ($fallbackJson.tiers | ConvertTo-Json -Depth 20) + "`n" + ($fallbackJson.agents | ConvertTo-Json -Depth 20)
    if ($fallbackText -match "cursor-acp/.+opus") { $hits += "fallback-models.json contains Opus model in routing" }
  }
  if (Test-Path -LiteralPath ".opencode\probe-results.json") {
    $probeText = Get-Content -LiteralPath ".opencode\probe-results.json" -Raw
    $tierBlock = ($probeText | ConvertFrom-Json).tier_assignment | ConvertTo-Json -Depth 10
    if ($tierBlock -match "opus") { $hits += "probe tier_assignment contains opus" }
  }
  return $hits
}

function Test-ProviderPolicy([object]$Cfg) {
  $allowed = @("openai", "cursor-acp", "opencode-go")
  $policies = @($Cfg.experimental.policies)
  $denyAll = @($policies | Where-Object { $_.effect -eq "deny" -and $_.action -eq "provider.use" -and $_.resource -eq "*" }).Count -gt 0
  $allows = @($policies | Where-Object { $_.effect -eq "allow" -and $_.action -eq "provider.use" } | ForEach-Object { $_.resource })
  $missing = @($allowed | Where-Object { $allows -notcontains $_ })
  $enabled = @($Cfg.enabled_providers)
  $enabledOk = ($enabled.Count -gt 0 -and @($allowed | Where-Object { $enabled -notcontains $_ }).Count -eq 0 -and @($enabled | Where-Object { $allowed -notcontains $_ }).Count -eq 0)
  return [pscustomobject]@{
    ok = (($denyAll -and $missing.Count -eq 0) -or $enabledOk)
    detail = if ($denyAll -and $missing.Count -eq 0) { "provider policy allows only approved project providers" } elseif ($enabledOk) { "enabled_providers restricted to approved project providers" } else { "denyAll=$denyAll missing=$($missing -join ',') enabled=$($enabled -join ',')" }
  }
}

function Test-Skills([string]$Name) {
  $result = [pscustomobject]@{
    valid = 0
    invalid = @()
    missingElite = @()
    loose = @()
  }
  $dir = ".opencode\skills"
  if (-not (Test-Path -LiteralPath $dir)) {
    $result.invalid += "missing skills dir"
    return $result
  }
  $elite = @(
    "elite-orchestration",
    "db2-safe-change",
    "ssh-prod-ops",
    "model-routing-fallbacks",
    "memory-learning-loop",
    "tool-discovery-audit",
    "release-evidence-gate",
    "mobile-telegram-control"
  )
  foreach ($skillDir in Get-ChildItem -LiteralPath $dir -Directory -ErrorAction SilentlyContinue) {
    $skillFile = Join-Path $skillDir.FullName "SKILL.md"
    if (-not (Test-Path -LiteralPath $skillFile)) { continue }
    $text = Get-Content -LiteralPath $skillFile -Raw
    $nameMatch = [regex]::Match($text, "(?m)^name:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*$")
    $descMatch = [regex]::Match($text, "(?m)^description:\s*(.+)\s*$")
    if (-not $nameMatch.Success -or -not $descMatch.Success) {
      $result.invalid += "$($skillDir.Name): missing name/description"
      continue
    }
    if ($nameMatch.Groups[1].Value -ne $skillDir.Name) {
      $result.invalid += "$($skillDir.Name): name mismatch $($nameMatch.Groups[1].Value)"
      continue
    }
    $result.valid++
  }
  foreach ($required in $elite) {
    if (-not (Test-Path -LiteralPath (Join-Path $dir "$required\SKILL.md"))) {
      $result.missingElite += $required
    }
  }
  $result.loose = @(Get-ChildItem -LiteralPath $dir -File -Filter *.md -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
  return $result
}

function Test-Project([string]$Name, [string]$Dir) {
  $checks = [System.Collections.Generic.List[object]]::new()
  Add-Check $checks "$Name.path" (Test-Path -LiteralPath $Dir) $Dir
  if (-not (Test-Path -LiteralPath $Dir)) { return $checks }

  Push-Location -LiteralPath $Dir
  try {
    Add-Check $checks "$Name.root-opencode-json" (Test-Path -LiteralPath "opencode.json") "opencode.json"
    Add-Check $checks "$Name.project-opencode-json" (Test-Path -LiteralPath ".opencode\opencode.json") ".opencode/opencode.json"
    Add-Check $checks "$Name.rules" (Test-Path -LiteralPath ".opencode\rules.json") ".opencode/rules.json"
    Add-Check $checks "$Name.agents-dir" (Test-Path -LiteralPath ".opencode\agents") ".opencode/agents"
    Add-Check $checks "$Name.commands-dir" (Test-Path -LiteralPath ".opencode\commands") ".opencode/commands"

    $raw = & $OpenCode debug config --pure
    $cfg = ($raw -join "`n") | ConvertFrom-Json
    $activeAgents = @($cfg.agent.PSObject.Properties | Where-Object { -not $_.Value.disable }).Count
    Add-Check $checks "$Name.config-loads" $true "default_agent=$($cfg.default_agent), model=$($cfg.model)"
    $providerPolicy = Test-ProviderPolicy $cfg
    Add-Check $checks "$Name.provider-policy" $providerPolicy.ok $providerPolicy.detail
    Add-Check $checks "$Name.active-agents" ($activeAgents -ge $(if ($Name -eq "gmp") { 19 } else { 13 })) "$activeAgents active"
    Add-Check $checks "$Name.plugins" (@($cfg.plugin).Count -ge 3) "$(@($cfg.plugin).Count) plugins"
    Add-Check $checks "$Name.mcp" (@($cfg.mcp.PSObject.Properties).Count -ge 10) "$(@($cfg.mcp.PSObject.Properties).Count) MCPs"

    if (Test-Path ".opencode\agents") {
      $agentFiles = @(Get-ChildItem ".opencode\agents" -Filter *.md)
      $badAgentConfig = @()
      foreach ($agentFile in $agentFiles) {
        $agentName = [IO.Path]::GetFileNameWithoutExtension($agentFile.Name)
        $loaded = $cfg.agent.$agentName
        if (-not $loaded -or -not $loaded.mode -or -not $loaded.model) {
          $badAgentConfig += $agentName
        }
      }
      Add-Check $checks "$Name.agent-frontmatter" ($badAgentConfig.Count -eq 0) $(if ($badAgentConfig.Count -eq 0) { "all agent frontmatter parsed" } else { "missing mode/model: $($badAgentConfig -join ', ')" })
    }

    $orchestratorName = if ($Name -eq "gmp") { "GMP-Orchestrator" } elseif ($Name -eq "granja") { "Granja-Orchestrator" } else { $null }
    if ($orchestratorName) {
      $orchestrator = $cfg.agent.$orchestratorName
      Add-Check $checks "$Name.orchestrator-model" ($orchestrator.model -match '^openai/gpt-5\.5') "$orchestratorName=$($orchestrator.model)"
      $approvedGoAgents = @("Repo-Explorer", "Web-Researcher", "Metrics-Observer", "Release-Notifier")
      $badGoAgents = @($cfg.agent.PSObject.Properties | Where-Object { -not $_.Value.disable -and $_.Value.mode -in @("primary","subagent") -and $_.Value.model -match '^opencode-go/' -and $approvedGoAgents -notcontains $_.Name } | ForEach-Object { "$($_.Name)=$($_.Value.model)" })
      Add-Check $checks "$Name.opencogo-policy" ($badGoAgents.Count -eq 0) $(if ($badGoAgents.Count -eq 0) { "OpenCode Go only on approved low-risk agents" } else { $badGoAgents -join ', ' })
      $opusHits = Test-NoOpusDefault $cfg $Dir
      Add-Check $checks "$Name.no-opus-default" ($opusHits.Count -eq 0) $(if ($opusHits.Count -eq 0) { "no Opus in active agents/fallback defaults" } else { $opusHits -join ', ' })

      $validAgents = @($cfg.agent.PSObject.Properties.Name)
      $badCommands = @()
      if (Test-Path ".opencode\commands") {
        foreach ($cmd in Get-ChildItem ".opencode\commands" -Filter *.md) {
          $cmdText = Get-Content -LiteralPath $cmd.FullName -Raw
          $agentMatch = [regex]::Match($cmdText, "(?m)^agent:\s*(\S+)\s*$")
          if ($agentMatch.Success -and $validAgents -notcontains $agentMatch.Groups[1].Value) {
            $badCommands += "$($cmd.Name):$($agentMatch.Groups[1].Value)"
          }
        }
      }
      Add-Check $checks "$Name.command-agents" ($badCommands.Count -eq 0) $(if ($badCommands.Count -eq 0) { "all slash command agent refs exist" } else { $badCommands -join ', ' })

      $skills = Test-Skills $Name
      Add-Check $checks "$Name.skills-valid" ($skills.valid -ge $(if ($Name -eq "gmp") { 80 } else { 8 }) -and $skills.invalid.Count -eq 0) $(if ($skills.invalid.Count -eq 0) { "$($skills.valid) valid skills" } else { $skills.invalid -join ', ' })
      Add-Check $checks "$Name.elite-skills" ($skills.missingElite.Count -eq 0) $(if ($skills.missingElite.Count -eq 0) { "elite skill pack present" } else { $skills.missingElite -join ', ' })
      Add-Check $checks "$Name.loose-skill-files" ($skills.loose.Count -eq 0) $(if ($skills.loose.Count -eq 0) { "no loose skill md files" } else { $skills.loose -join ', ' }) "warn"
    }

    if ($Name -eq "granja") {
      $db2Agent = [bool]$cfg.agent.'DB2-AS400-Specialist'
      $badDataAgents = @($cfg.agent.PSObject.Properties.Name | Where-Object { $_ -match 'Supabase|Postgres|PostgreSQL' })
      Add-Check $checks "$Name.db2-agent" $db2Agent "DB2-AS400-Specialist present"
      Add-Check $checks "$Name.no-supabase-postgres-agents" ($badDataAgents.Count -eq 0) $(if ($badDataAgents.Count -eq 0) { "no Supabase/Postgres agents active" } else { $badDataAgents -join ', ' })
      Add-Check $checks "$Name.db2-mcp-enabled" ([bool]$cfg.mcp.'ibm-db2-mcp'.enabled) "ibm-db2-mcp enabled=$($cfg.mcp.'ibm-db2-mcp'.enabled)"
    }

    if ($Name -eq "gmp") {
      $toolCount = if (Test-Path ".opencode\tools") { @(Get-ChildItem ".opencode\tools" -Filter *.ts).Count } else { 0 }
      $pluginCount = if (Test-Path ".opencode\plugins") { @(Get-ChildItem ".opencode\plugins" -Filter *.ts).Count } else { 0 }
      Add-Check $checks "$Name.custom-tools" ($toolCount -ge 10) "$toolCount tools"
      Add-Check $checks "$Name.custom-plugins" ($pluginCount -ge 6) "$pluginCount plugins"
      if (Test-Path ".opencode\probe-results.json") {
        $probe = Get-Content ".opencode\probe-results.json" -Raw | ConvertFrom-Json
        $okProviders = @($probe.providers.PSObject.Properties | Where-Object { $_.Value.status -eq "ok" }).Count
        Add-Check $checks "$Name.probe-providers" ($okProviders -ge 2) "$okProviders providers ok"
        Add-Check $checks "$Name.tier-routing" ([bool]$probe.tier_assignment.tier_a_model -and [bool]$probe.tier_assignment.tier_b_model -and [bool]$probe.tier_assignment.tier_c_model) ($probe.tier_assignment | ConvertTo-Json -Compress)
      } else {
        Add-Check $checks "$Name.probe-providers" $false "missing .opencode/probe-results.json"
      }
      if (Test-Path ".opencode\memory\tools-manifest.json") {
        $manifest = Get-Content ".opencode\memory\tools-manifest.json" -Raw | ConvertFrom-Json
        Add-Check $checks "$Name.tools-manifest" ($manifest.Count -gt 100) "$($manifest.Count) entries"
      } else {
        Add-Check $checks "$Name.tools-manifest" $false "missing tools-manifest.json"
      }
    }
  } catch {
    Add-Check $checks "$Name.config-loads" $false $_.Exception.Message
  } finally {
    Pop-Location
  }
  return $checks
}

$checks = [System.Collections.Generic.List[object]]::new()
Add-Check $checks "global.config" (Test-Path -LiteralPath (Join-Path $HomeDir ".config\opencode\opencode.json")) "~/.config/opencode/opencode.json"
Add-Check $checks "global.instructions" (Test-Path -LiteralPath (Join-Path $HomeDir ".config\opencode\AGENTS.md")) "~/.config/opencode/AGENTS.md"
Add-Check $checks "global.start-script" (Test-Path -LiteralPath (Join-Path $HomeDir ".config\opencode\tools\start-opencode-project.ps1")) "start-opencode-project.ps1"

try {
  $globalCfg = Get-Content -LiteralPath (Join-Path $HomeDir ".config\opencode\opencode.json") -Raw | ConvertFrom-Json
  Add-Check $checks "global.default-model" ($globalCfg.model -match '^openai/gpt-5\.5') "model=$($globalCfg.model)"
  $globalPolicy = Test-ProviderPolicy $globalCfg
  Add-Check $checks "global.provider-policy" $globalPolicy.ok $globalPolicy.detail
} catch {
  Add-Check $checks "global.default-model" $false $_.Exception.Message
}

try {
  $models = @(& $OpenCode models | Where-Object { $_ -match "/" })
  Add-Check $checks "models.openai" (@($models | Where-Object { $_ -match "^openai/" }).Count -gt 0) "$(@($models | Where-Object { $_ -match "^openai/" }).Count) models"
  Add-Check $checks "models.cursor-acp" (@($models | Where-Object { $_ -match "^cursor-acp/" }).Count -gt 0) "$(@($models | Where-Object { $_ -match "^cursor-acp/" }).Count) models"
  Add-Check $checks "models.opencogo" (@($models | Where-Object { $_ -match "^opencode-go/" }).Count -gt 0) "$(@($models | Where-Object { $_ -match "^opencode-go/" }).Count) models"
} catch {
  Add-Check $checks "models" $false $_.Exception.Message
}

$cursor = Test-Url "http://127.0.0.1:32124/v1/models" 5
Add-Check $checks "services.cursor-acp-http" $cursor.ok $cursor.detail "warn"
$metrics = Test-Url "http://127.0.0.1:9091/metrics" 3
Add-Check $checks "services.metrics" $metrics.ok $metrics.detail "warn"
$chroma = Test-Url "http://127.0.0.1:8000/api/v2/heartbeat" 2
Add-Check $checks "services.chromadb" $chroma.ok $chroma.detail "warn"
Add-Check $checks "services.redis" (Test-Tcp "127.0.0.1" 6379 1000) "127.0.0.1:6379" "warn"
try {
  docker info --format "{{.ServerVersion}}" 2>$null | Out-Null
  Add-Check $checks "services.docker" ($LASTEXITCODE -eq 0) "docker info exit=$LASTEXITCODE" "warn"
} catch {
  Add-Check $checks "services.docker" $false $_.Exception.Message "warn"
}

$selected = if ($Project -eq "all") { @("gmp","granja") } else { @($Project) }
foreach ($name in $selected) {
  foreach ($check in Test-Project $name $Projects[$name]) { $checks.Add($check) | Out-Null }
}

$blockingFailed = @($checks | Where-Object { -not $_.ok -and $_.severity -eq "block" })
$warnFailed = @($checks | Where-Object { -not $_.ok -and $_.severity -eq "warn" })
$result = [pscustomobject]@{
  ts = (Get-Date).ToString("o")
  ready = ($blockingFailed.Count -eq 0)
  blocking_failed = $blockingFailed.Count
  warnings_failed = $warnFailed.Count
  checks = $checks
}

if ($Json) {
  $result | ConvertTo-Json -Depth 8
} else {
  $status = if ($result.ready) { "READY" } else { "BLOCKED" }
  Write-Host "OpenCode readiness: $status"
  foreach ($check in $checks) {
    $mark = if ($check.ok) { "OK " } elseif ($check.severity -eq "warn") { "WARN" } else { "FAIL" }
    Write-Host ("{0} {1} - {2}" -f $mark, $check.name, $check.detail)
  }
}

exit $(if ($result.ready) { 0 } else { 1 })
