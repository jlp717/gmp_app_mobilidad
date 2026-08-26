# Computes the SHA-256 pin (base64 of DER) for a TLS host.
# Usage: .\scripts\security\get-tls-pin.ps1 -HostName api.mari-pepa.com [-Port 443]
param(
    [Parameter(Mandatory = $true)]
    [string]$HostName,

    [int]$Port = 443
)

$ErrorActionPreference = 'Stop'

$tcp = New-Object Net.Sockets.TcpClient($HostName, $Port)
try {
    $ssl = New-Object Net.Security.SslStream($tcp.GetStream(), $false, { $true })
    try {
        $ssl.AuthenticateAsClient($HostName)
        $cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
        $der = $cert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert)
        $sha = [Security.Cryptography.SHA256]::Create()
        try {
            $hashBytes = $sha.ComputeHash($der)
        } finally {
            $sha.Dispose()
        }
        $pin = 'sha256/' + [Convert]::ToBase64String($hashBytes)
        Write-Host "GMP_TLS_PINS entry for ${HostName}:"
        Write-Host "  $pin"
        Write-Host ''
        Write-Host 'Build with:'
        Write-Host "  flutter build apk --release --dart-define=GMP_TLS_PINS=$pin"
        Write-Host 'Add a second backup pin before enabling in production.'
    } finally {
        $ssl.Dispose()
    }
} finally {
    $tcp.Dispose()
}
