# Instala web.cmd en Startup\Encode — redirige al launcher canonico C:\Users\Javier\*.cmd
param(
  [string]$TargetDir = (Join-Path $env:USERPROFILE "Startup\Encode")
)

$ErrorActionPreference = "Stop"
$canonical = Join-Path $env:USERPROFILE "Start_OpenCode_Web_Gmp.cmd"
$fallback = Join-Path $env:USERPROFILE "start-opencode-web-gmp.cmd"

if (-not (Test-Path -LiteralPath $canonical) -and -not (Test-Path -LiteralPath $fallback)) {
  throw "No existe launcher en $env:USERPROFILE (Start_OpenCode_Web_Gmp.cmd o start-opencode-web-gmp.cmd)"
}

New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null

$webCmd = Join-Path $TargetDir "web.cmd"
$content = @"
@echo off
setlocal EnableExtensions
title GMP Chief Engineer - OpenCode Web
rem Redirige al launcher canonico de Javier en %USERPROFILE%
set "LAUNCHER=%USERPROFILE%\Start_OpenCode_Web_Gmp.cmd"
if not exist "%LAUNCHER%" set "LAUNCHER=%USERPROFILE%\start-opencode-web-gmp.cmd"
if not exist "%LAUNCHER%" (
  echo ERROR: no encuentro Start_OpenCode_Web_Gmp.cmd ni start-opencode-web-gmp.cmd en %USERPROFILE%
  pause
  exit /b 1
)
call "%LAUNCHER%"
endlocal
"@

[System.IO.File]::WriteAllText($webCmd, $content.Replace("`n", "`r`n"), [System.Text.UTF8Encoding]::new($false))
Write-Host "[OK] Instalado: $webCmd"
Write-Host "     -> $canonical"

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcut = Join-Path $desktop "GMP OpenCode Web.cmd"
Copy-Item -LiteralPath $webCmd -Destination $shortcut -Force
Write-Host "[OK] Escritorio: $shortcut"
Write-Host "Launcher canonico: ejecuta $canonical (o start-opencode-web-gmp.cmd)"
