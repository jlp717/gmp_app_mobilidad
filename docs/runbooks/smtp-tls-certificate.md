# SMTP TLS: identidad del certificado

Verificación operativa 2026-09-02 desde `gmp-online` (sin leer `.env`):

| Nombre | Resolución | SMTP 465/587 | Certificado |
| --- | --- | --- | --- |
| `mail.mari-pepa.com` | Cloudflare `188.114.96.5` / `188.114.97.5` | cerrado | no aplicable |
| `mn05-02.dnspropio.com` | `185.14.56.187` | abierto | Let's Encrypt, SAN solo `mn05-02.dnspropio.com`, verify return:1 |

El backend remapea el frontend web `mail.mari-pepa.com` al servidor certificado. No se desactiva TLS. `rejectUnauthorized` permanece en `true`.

## Configuración

```text
SMTP_HOST=mn05-02.dnspropio.com
SMTP_TLS_SERVERNAME=mn05-02.dnspropio.com
SMTP_PORT=465
SMTP_PDF_HOST=mn05-02.dnspropio.com
SMTP_PDF_TLS_SERVERNAME=mn05-02.dnspropio.com
```

Puerto `465` = TLS implícito. Puerto `587` = STARTTLS obligatorio. En ambos casos TLS 1.2+ y verificación de certificado.

## Comprobación

```text
timeout 8 openssl s_client -connect mn05-02.dnspropio.com:465 -servername mn05-02.dnspropio.com
```

El nombre de `-servername` debe aparecer en `Subject Alternative Name`. Si no aparece, se corrige DNS, el certificado o el hostname; no se oculta el error.
