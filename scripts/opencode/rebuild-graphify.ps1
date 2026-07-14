# Rebuild Graphify knowledge graph (local, code-only, no external API)
param(
  [string]$RepoDir = "C:\Users\Javier\Desktop\Repositorios\gmp_app_mobilidad",
  [string]$VenvDir = "C:\Users\Javier\.cache\graphify-venv"
)
$ErrorActionPreference = "Stop"

$venvPython = Join-Path $VenvDir "Scripts\python.exe"
$graphifyExe = Join-Path $VenvDir "Scripts\graphify.exe"
$outDir = Join-Path $RepoDir "docs\graphify"

if (-not (Test-Path $graphifyExe)) {
    throw "Graphify no encontrado en $graphifyExe"
}

# Build code-only graph scoped to source directories
$tempRoot = Join-Path $env:TEMP "graphify-build-$(Get-Date -Format 'yyyyMMddHHmmss')"
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
try {
    # Mirror only code directories, excluding docs/media to avoid API usage
    $dirs = @("lib", "backend", "scripts")
    foreach ($d in $dirs) {
        $src = Join-Path $RepoDir $d
        if (Test-Path $src) {
            $dest = Join-Path $tempRoot $d
            robocopy $src $dest /MIR /XD node_modules .dart_tool build .opencode .git coverage /XF *.md *.txt *.pdf *.docx *.xlsx *.jpg *.jpeg *.png *.gif *.mp4 *.mp3 *.wav *.html *.yaml *.yml *.json 2>&1 | Out-Null
        }
    }

    # Force a clean rebuild; remove any previous graphify output so extract does not enter incremental mode
    Remove-Item -Recurse -Force (Join-Path $outDir "graphify-out") -ErrorAction SilentlyContinue
    Remove-Item -Force (Join-Path $outDir "graph.json") -ErrorAction SilentlyContinue
    Remove-Item -Force (Join-Path $outDir "GRAPH_REPORT.md") -ErrorAction SilentlyContinue

    $oldEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"

    & $graphifyExe extract $tempRoot --out $outDir --no-label --no-viz --no-cluster 2>&1 | Tee-Object -FilePath (Join-Path $outDir "build.log")
    if ($LASTEXITCODE -ne 0) { throw "graphify extract fallo con codigo $LASTEXITCODE" }

    & $graphifyExe cluster-only $outDir --no-label --no-viz 2>&1 | Tee-Object -FilePath (Join-Path $outDir "build.log") -Append
    if ($LASTEXITCODE -ne 0) { throw "graphify cluster-only fallo con codigo $LASTEXITCODE" }

    $ErrorActionPreference = $oldEAP

    $graphifyOut = Join-Path $outDir "graphify-out"
    if (Test-Path (Join-Path $graphifyOut "graph.json")) {
        Copy-Item -Path (Join-Path $graphifyOut "graph.json") -Destination $outDir -Force
        Copy-Item -Path (Join-Path $graphifyOut "GRAPH_REPORT.md") -Destination $outDir -Force
    } else {
        throw "No se genero graph.json en $graphifyOut"
    }
}
finally {
    Remove-Item -Recurse -Force $tempRoot -ErrorAction SilentlyContinue
}

# Telegram notification
$token = $env:TELEGRAM_BOT_TOKEN
$chatId = $env:TELEGRAM_CHAT_ID
$msg = "Graphify rebuild completado: $(Get-Date -Format 'yyyy-MM-dd HH:mm'). Nodos/aristas consultables en docs/graphify/."
if ($token -and $chatId) {
    try {
        $body = @{chat_id=$chatId; text=$msg; parse_mode="HTML"} | ConvertTo-Json -Compress
        Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/sendMessage" -Method Post -ContentType "application/json" -Body $body | Out-Null
    } catch {
        Add-Content -Path (Join-Path $RepoDir ".opencode\telegram_pending.jsonl") -Value (@{ts=(Get-Date -Format "o"); message=$msg; error=$_.Exception.Message} | ConvertTo-Json -Compress)
    }
} else {
    Add-Content -Path (Join-Path $RepoDir ".opencode\telegram_pending.jsonl") -Value (@{ts=(Get-Date -Format "o"); message=$msg; error="missing telegram env"} | ConvertTo-Json -Compress)
}

Write-Host "OK: Graphify rebuild completado en $outDir"
