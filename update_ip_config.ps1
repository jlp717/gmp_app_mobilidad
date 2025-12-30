
# Script to update API Config with local IP based on Wi-Fi priority
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -match 'Wi-Fi' } | Select-Object -First 1).IPAddress

if (-not $ip) {
    # Fallback to Ethernet if no Wi-Fi
    $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -match 'Ethernet' -and $_.IPAddress -notmatch '^192\.168\.56\.' } | Select-Object -First 1).IPAddress
}

if (-not $ip) {
    Write-Host "No suitable IP address found!" -ForegroundColor Red
    exit 1
}

Write-Host "Detected Local IP: $ip" -ForegroundColor Green

$file = "lib\core\api\api_config.dart"
$content = Get-Content $file -Raw

# Regex to find the _serverIp line and replace it
$newContent = $content -replace "static String _serverIp = '.*?';", "static String _serverIp = '$ip';"

Set-Content $file $newContent
Write-Host "Updated $file with IP $ip" -ForegroundColor Cyan
