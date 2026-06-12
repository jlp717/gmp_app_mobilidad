param(
  [switch]$SystemDsn,
  [string]$Name = 'GMP',
  [string]$System = '192.168.1.22'
)

$ErrorActionPreference = 'Stop'

$source = 'HKLM:\SOFTWARE\WOW6432Node\ODBC\ODBC.INI\GMP'
$targetRoot = if ($SystemDsn) { 'HKLM:\SOFTWARE\ODBC\ODBC.INI' } else { 'HKCU:\SOFTWARE\ODBC\ODBC.INI' }
$target = Join-Path $targetRoot $Name
$sources = Join-Path $targetRoot 'ODBC Data Sources'
$driver64 = 'C:\windows\system32\cwbodbc.dll'

if (-not (Test-Path -LiteralPath $source)) {
  throw 'GMP 32-bit source DSN was not found under HKLM:\SOFTWARE\WOW6432Node\ODBC\ODBC.INI\GMP.'
}

if (-not (Test-Path -LiteralPath $driver64)) {
  throw "64-bit IBM i Access ODBC driver was not found at $driver64."
}

if (-not (Test-Path -LiteralPath $targetRoot)) {
  New-Item -Path $targetRoot -Force | Out-Null
}

if (-not (Test-Path -LiteralPath $target)) {
  New-Item -Path $target -Force | Out-Null
}

$sourceProps = Get-ItemProperty -LiteralPath $source
$skip = @('PSPath', 'PSParentPath', 'PSChildName', 'PSDrive', 'PSProvider')

foreach ($prop in $sourceProps.PSObject.Properties) {
  if ($skip -contains $prop.Name) { continue }
  $value = $prop.Value
  if ($prop.Name -eq 'Driver') { $value = $driver64 }
  if ($prop.Name -eq 'System') { $value = $System }
  New-ItemProperty -LiteralPath $target -Name $prop.Name -Value $value -PropertyType String -Force | Out-Null
}

New-ItemProperty -LiteralPath $target -Name 'Driver' -Value $driver64 -PropertyType String -Force | Out-Null
New-ItemProperty -LiteralPath $target -Name 'System' -Value $System -PropertyType String -Force | Out-Null

if (-not (Test-Path -LiteralPath $sources)) {
  New-Item -Path $sources -Force | Out-Null
}

New-ItemProperty -LiteralPath $sources -Name $Name -Value 'iSeries Access ODBC Driver' -PropertyType String -Force | Out-Null

Get-ItemProperty -LiteralPath $target |
  Select-Object @{Name='Scope'; Expression={ if ($SystemDsn) { 'System' } else { 'User' } }},
    @{Name='Name'; Expression={ $Name }},
    Driver,
    System,
    Naming,
    DefaultLibraries,
    DefaultPkgLibrary,
    DefaultPackage
