param(
  [switch]$Json
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $Root

function Add-Check([System.Collections.Generic.List[object]]$Checks, [string]$Name, [bool]$Ok, [string]$Detail, [string]$Severity = "block") {
  $Checks.Add([pscustomobject]@{ name = $Name; ok = $Ok; detail = $Detail; severity = $Severity }) | Out-Null
}

function Test-JsonFile([string]$Path) {
  try {
    Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Count-Lines([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return 0 }
  return @((Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue)).Count
}

$checks = [System.Collections.Generic.List[object]]::new()

# V3 retained checks
Add-Check $checks "01.v3-root-agents" (Test-Path -LiteralPath "AGENTS.md") "root AGENTS.md"
Add-Check $checks "02.v3-project-agents" (Test-Path -LiteralPath ".opencode\AGENTS.md") ".opencode/AGENTS.md"
Add-Check $checks "03.v3-root-config-json" (Test-JsonFile "opencode.json") "opencode.json parses"
Add-Check $checks "04.v3-project-config-json" (Test-JsonFile ".opencode\opencode.json") ".opencode/opencode.json parses"
Add-Check $checks "05.v3-agent-count" (@(Get-ChildItem ".opencode\agents" -Filter *.md).Count -ge 21) "$(@(Get-ChildItem ".opencode\agents" -Filter *.md).Count) agents"
Add-Check $checks "06.v3-tool-count" (@(Get-ChildItem ".opencode\tools" -Filter *.ts).Count -ge 17) "$(@(Get-ChildItem ".opencode\tools" -Filter *.ts).Count) tools"
Add-Check $checks "07.v3-plugin-count" (@(Get-ChildItem ".opencode\plugins" -Filter *.ts).Count -ge 8) "$(@(Get-ChildItem ".opencode\plugins" -Filter *.ts).Count) plugins"
Add-Check $checks "08.v3-command-count" (@(Get-ChildItem ".opencode\commands" -Filter *.md).Count -ge 13) "$(@(Get-ChildItem ".opencode\commands" -Filter *.md).Count) commands"
Add-Check $checks "09.v3-skill-count" (@(Get-ChildItem ".opencode\skills" -Directory | Where-Object { Test-Path (Join-Path $_.FullName "SKILL.md") }).Count -ge 16) "$(@(Get-ChildItem ".opencode\skills" -Directory | Where-Object { Test-Path (Join-Path $_.FullName "SKILL.md") }).Count) skills"
Add-Check $checks "10.v3-dashboard-json" (Test-JsonFile ".opencode\monitoring\grafana-dashboards\opencode-dashboard.json") "grafana dashboard parses"

# V4 new checks
$ragCfg = Get-Content ".opencode\memory\rag-config.json" -Raw | ConvertFrom-Json
Add-Check $checks "11.rag-config-collections" (@($ragCfg.collections.PSObject.Properties).Count -eq 10) "$(@($ragCfg.collections.PSObject.Properties).Count) collections"

$mobileFiles = @(".opencode\agents\chief-engineer-assistant.md", ".opencode\plugins\mobile-mode-detector.ts", ".opencode\config\mobile-mode.yaml")
$mobileOk = @($mobileFiles | Where-Object { Test-Path -LiteralPath $_ }).Count -eq $mobileFiles.Count
Add-Check $checks "12.mobile-mode-artifacts" $mobileOk ($mobileFiles -join ", ")

$pipelineAgents = @("product-ux.md", "Architect-Planner.md", "code-autopilot.md", "qa-automation-lead.md", "appsec-engineer.md", "DevOps-CICD-Specialist.md", "sre-engineer.md")
$pipelineOk = @($pipelineAgents | Where-Object { Test-Path -LiteralPath (Join-Path ".opencode\agents" $_) }).Count -eq $pipelineAgents.Count
Add-Check $checks "13.pipeline-v4-agents" $pipelineOk ($pipelineAgents -join ", ")

$digestFiles = @(".opencode\commands\digest.md", ".opencode\config\daily-digest.yaml", "scripts\opencode\v4\payload\opt\gmp-tools\daily-digest-runner.sh", "scripts\opencode\v4\payload\etc\systemd\system\gmp-daily-digest.timer")
$digestOk = @($digestFiles | Where-Object { Test-Path -LiteralPath $_ }).Count -eq $digestFiles.Count
Add-Check $checks "14.daily-digest-artifacts" $digestOk ($digestFiles -join ", ")

$retroFiles = @(".opencode\plugins\same-error-detector.ts", ".opencode\tools\retrospective-trigger.ts", ".opencode\memory\retrospectives.md", ".opencode\memory\same-error-tracker.jsonl")
$retroOk = @($retroFiles | Where-Object { Test-Path -LiteralPath $_ }).Count -eq $retroFiles.Count
Add-Check $checks "15.same-error-retro-artifacts" $retroOk ($retroFiles -join ", ")

$rootConfig = Get-Content "opencode.json" -Raw | ConvertFrom-Json
$projectConfig = Get-Content ".opencode\opencode.json" -Raw | ConvertFrom-Json
$safetyFiles = @(".opencode\plugins\production-safety-guard.ts", ".opencode\tools\production-approval-gate.ts", ".opencode\commands\adelante.md", ".opencode\config\production-safety.yaml", "scripts\opencode\v4\test-production-safety-guard.mjs")
$safetyFilesOk = @($safetyFiles | Where-Object { Test-Path -LiteralPath $_ }).Count -eq $safetyFiles.Count
$safetyConfigOk = @($rootConfig.plugin) -contains "./.opencode/plugins/production-safety-guard.ts" -and
  @($projectConfig.plugin) -contains "./plugins/production-safety-guard.ts" -and
  $rootConfig.tools.'production-approval-gate' -eq $true -and
  $projectConfig.tools.'production-approval-gate' -eq $true -and
  $rootConfig.command.adelante.agent -eq "chief-engineer-assistant" -and
  $projectConfig.command.adelante.agent -eq "chief-engineer-assistant"
Add-Check $checks "16.production-safety-gate" ($safetyFilesOk -and $safetyConfigOk) "guard plugin, approval tool, /adelante command, config registered"

$launcherPath = "scripts\opencode\start-opencode-project.ps1"
$launcherText = if (Test-Path -LiteralPath $launcherPath) { Get-Content -LiteralPath $launcherPath -Raw } else { "" }
$launcherOk = $launcherText -match "chief-engineer-assistant" -and
  $launcherText -match "OPENCODE_SERVER_PASSWORD" -and
  $launcherText -match "OPENCODE_SERVER_USERNAME" -and
  $launcherText -match "Test-RemoteGmp"
Add-Check $checks "17.secure-web-launcher" $launcherOk "Chief Engineer default, HTTP basic auth, remote preflight checks"

$rulesText = Get-Content ".opencode\rules.json" -Raw
$agentsText = (Get-Content ".opencode\AGENTS.md" -Raw) + "`n" + (Get-Content ".opencode\agents\Node-Express-Specialist.md" -Raw) + "`n" + (Get-Content ".opencode\agents\DB2-AS400-Specialist.md" -Raw)
$qualityOk = $rulesText -match "Q09" -and $rulesText -match "N\+1" -and $agentsText -match "N\+1" -and $agentsText -match "batch" -and $agentsText -match "idempot"
Add-Check $checks "18.elite-quality-bar" $qualityOk "N+1, DB2 batching, idempotency, rollback and performance rules"

$configOk = $rootConfig.share -eq "disabled" -and
  $projectConfig.share -eq "disabled" -and
  $rootConfig.snapshot -eq $true -and
  $projectConfig.snapshot -eq $true -and
  $rootConfig.server.port -eq 3090 -and
  $projectConfig.server.port -eq 3090 -and
  $rootConfig.tool_output.max_lines -le 300 -and
  $projectConfig.tool_output.max_lines -le 300
Add-Check $checks "19.opencode-current-config" $configOk "share disabled, snapshots, server, tool_output and skills paths"

$approvalToolText = Get-Content ".opencode\tools\production-approval-gate.ts" -Raw
$approvalGuardText = Get-Content ".opencode\plugins\production-safety-guard.ts" -Raw
$approvalTestText = Get-Content "scripts\opencode\v4\test-production-safety-guard.mjs" -Raw
$evidenceGateOk = $approvalToolText -match "PRODUCTION_EVIDENCE_REQUIRED" -and
  $approvalToolText -match "staging_url" -and
  $approvalToolText -match "qa_status" -and
  $approvalToolText -match "appsec_status" -and
  $approvalToolText -match "sre_status" -and
  $approvalToolText -match "evidence_ref" -and
  $approvalGuardText -match "hasCompleteEvidence" -and
  $approvalTestText -match "blocked_with_incomplete_token" -and
  $approvalTestText -match "allowed_with_evidence_token"
Add-Check $checks "20.production-evidence-gate" $evidenceGateOk "production approval requires staging, QA PASS, AppSec PASS, SRE PASS and evidence_ref"

$chiefText = Get-Content ".opencode\agents\chief-engineer-assistant.md" -Raw
$qualityGateText = Get-Content ".opencode\tools\elite-quality-gate.ts" -Raw
$qualityCommandOk = Test-Path -LiteralPath ".opencode\commands\quality.md"
$endToEndOk = $chiefText -match "Contrato end-to-end" -and
  $chiefText -match "task: allow" -and
  $chiefText -match "context packets completos" -and
  $chiefText -match "elite-quality-gate" -and
  $qualityGateText -match "n_plus_one_loop" -and
  $qualityGateText -match "select_star" -and
  $qualityGateText -match "sql_string_concat" -and
  $qualityCommandOk -and
  $rootConfig.tools.'elite-quality-gate' -eq $true -and
  $projectConfig.tools.'elite-quality-gate' -eq $true
Add-Check $checks "21.end-to-end-quality-automation" $endToEndOk "Chief can delegate, must complete end-to-end, and elite-quality-gate is registered"

$v4Rows = @(
  "chief-engineer-assistant.md", "sre-engineer.md", "product-ux.md", "appsec-engineer.md", "qa-automation-lead.md",
  "code-autopilot.md", "tech-radar-agent.md", "voice-synthesis.ts", "rag-query.ts", "staging-deploy.ts",
  "tech-radar-fetch.ts", "retrospective-trigger.ts", "github-advanced.ts", "mobile-mode-detector.ts",
  "same-error-detector.ts", "voice.md", "simulate.md", "digest.md", "retro.md", "sre-runbooks/SKILL.md",
  "qa-e2e-patterns/SKILL.md", "voice-interaction/SKILL.md", "rag-retrieval/SKILL.md", "mobile-mode.yaml",
  "daily-digest.yaml", "tech-radar.yaml", "rag-config.json", "postmortems.md", "retrospectives.md",
  "rag-indexer.py", "elevenlabs-bridge.py", "tech-radar-fetcher.py", "daily-digest-runner.sh",
  "sre-alerting-rules.yml", "gmp-rag-indexer.service", "start-chief-engineer.cmd"
)

$result = [pscustomobject]@{
  ts = (Get-Date).ToString("o")
  ready = (@($checks | Where-Object { -not $_.ok -and $_.severity -eq "block" }).Count -eq 0)
  checks = $checks
  v4_manifest_rows = $v4Rows.Count
  line_summary = [ordered]@{
    agents = @(Get-ChildItem ".opencode\agents" -Filter *.md).Count
    tools = @(Get-ChildItem ".opencode\tools" -Filter *.ts).Count
    plugins = @(Get-ChildItem ".opencode\plugins" -Filter *.ts).Count
    commands = @(Get-ChildItem ".opencode\commands" -Filter *.md).Count
    skills = @(Get-ChildItem ".opencode\skills" -Directory | Where-Object { Test-Path (Join-Path $_.FullName "SKILL.md") }).Count
  }
}

if ($Json) {
  $result | ConvertTo-Json -Depth 8
} else {
  Write-Host "OpenCode V4 readiness: $(if ($result.ready) { 'READY' } else { 'BLOCKED' })"
  foreach ($check in $checks) {
    $mark = if ($check.ok) { "OK " } elseif ($check.severity -eq "warn") { "WARN" } else { "FAIL" }
    Write-Host ("{0} {1} - {2}" -f $mark, $check.name, $check.detail)
  }
  Write-Host ("V4 manifest rows: {0}" -f $result.v4_manifest_rows)
}

exit $(if ($result.ready) { 0 } else { 1 })
