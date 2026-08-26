# Ejecuta la piramide unit+widget con cobertura lcov.
# Excluye generados (*.g.dart, *.freezed.dart).
# Umbrales = baseline anti-regresion medido el 2026-08-26
#   (domain >= $MinDomain | global >= $MinGlobal). Objetivo a futuro: 85 / 60.
# Uso: powershell -ExecutionPolicy Bypass -File scripts/test-coverage.ps1 [-MinDomain 85] [-MinGlobal 60]
param(
    [int]$MinDomain = 50,
    [int]$MinGlobal = 35
)
$ErrorActionPreference = 'Stop'

flutter test --coverage
if ($LASTEXITCODE -ne 0) { Write-Error "flutter test fallo ($LASTEXITCODE)"; exit $LASTEXITCODE }

$lcovPath = 'coverage/lcov.info'
if (-not (Test-Path $lcovPath)) { Write-Error 'No se genero coverage/lcov.info'; exit 1 }

# Filtrar ficheros generados del informe
$lines = Get-Content $lcovPath
$out = New-Object System.Collections.Generic.List[string]
$skip = $false
foreach ($line in $lines) {
    if ($line -like 'SF:*') {
        $skip = ($line -match '\.(g|freezed)\.dart$')
        if ($skip) { continue }
    }
    elseif ($line -eq 'end_of_record') { $skip = $false }
    if (-not $skip) { $out.Add($line) }
}
Set-Content -Path $lcovPath -Value $out

# Acumular por capa directamente sobre el lcov filtrado
$gLf = 0; $gLh = 0; $dLf = 0; $dLh = 0
$isDomain = $false
foreach ($line in $out) {
    if ($line -like 'SF:*') {
        $isDomain = ($line -match '[\\/]features[\\/].*[\\/]domain[\\/]')
    }
    elseif ($line -like 'LF:*') {
        $v = [int]$line.Substring(3)
        $gLf += $v; if ($isDomain) { $dLf += $v }
    }
    elseif ($line -like 'LH:*') {
        $v = [int]$line.Substring(3)
        $gLh += $v; if ($isDomain) { $dLh += $v }
    }
}

function Pct([int]$lh, [int]$lf) {
    if ($lf -eq 0) { return 0 } else { return [math]::Round(100 * $lh / $lf, 2) }
}
$domainPct = Pct $dLh $dLf
$globalPct = Pct $gLh $gLf

"Capa     Lineas  Cubiertas  Pct"
"domain   $dLf    $dLh       $domainPct%"
"global   $gLf    $gLh       $globalPct%"

$fail = $false
if ($domainPct -lt $MinDomain) { Write-Warning "UMBRAL domain $domainPct% < $MinDomain%"; $fail = $true }
if ($globalPct -lt $MinGlobal) { Write-Warning "UMBRAL global $globalPct% < $MinGlobal%"; $fail = $true }
if ($fail) { exit 2 }
Write-Host 'Cobertura OK (umbrales cumplidos)'
