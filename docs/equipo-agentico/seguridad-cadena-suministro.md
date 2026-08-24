# E — Seguridad y cadena de suministro

## Guardvibe origen (E.1)
Configurado en `.mcp.json:7` como `npx -y guardvibe@3.1.21` (invocado por hook lint-and-format.sh).
**Procedencia verificable**: `https://www.npmjs.com/package/guardvibe` (npm) — si Javi quiere fuente exacta, ejecutar `npm view guardvibe repository.url` o buscar repo GitHub asociado. **Estado**: ❌ requiere prueba en vivo — no se pudo verificar publicamente en esta sesion un repo GitHub unico y firmado; no se asume "ya esta integrado" sin que Javi confirme procedencia. Recomendacion: confirmar URL exacta o eliminar hasta confirmar (no se deja como ✅ silencioso).

## MCP 2026-07-28 (E.2) — https://blog.modelcontextprotocol.io/posts/2026-07-28/
Revision stateless sin handshake initialize, Roots/Sampling/Logging obsoletos 12 meses. Verificado `.mcp.json:1`:
- `context7` (cmd npx @upstash/context7-mcp) — asume compatible previa, requiere capa traduccion si cliente 2026-07-28 sin fallback → GAP documentado en `fase0-auditoria.md:15`
- `guardvibe` (npx) — mismo GAP
- `ibm-db2` (npx ibm-db2-mcp, env ODBC_DSN=GMP) — GAP
- `dart-flutter`, `playwright` — GAP
**Estado**: ❌ todos requieren prueba viva de version handshake; no se asume compatibilidad. Mitigacion: aislar tras capa mapeo y probar `initialize` negociacion antes de prod.

## OWASP ASI01-ASI10 (E.3)
Completa en `docs/equipo-agentico/owasp-asi-matrix.md:1` con archivo:linea por fila (no plantilla vacia). Ver F4.

## Gitleaks + SCA (E.4/E.5)
- Gitleaks pre-commit: `.husky/pre-commit:1` (`gitleaks protect --staged --verbose`). Prueba reproducible: `echo "fake" | gitleaks protect --staged` o `git commit -m "test" "AKIA..."` -> bloquea. Fallback `validate-secrets.mjs:1` si no instalado.
- SCA: `.github/dependabot.yml:1` weekly npm+pub, labels deps/security. CI debe correr `npm audit` — ver `.github/workflows/ci.yml` (pendiente crear workflow si no existe).

## .opencode destrucción (E.6)
Visto 60+ YAML en `.opencode/config/` antes de congelar (evidencia Fase 0). Congelado via `.opencode/DEPRECATED.md:1`, no borrado fisico para no romper suscripcion OpenCode separada del proyecto. `.gitignore:210` mantiene `.claude/*` tracking separado.

## .gitignore (E.7)
- `.claude/settings.local.json` sigue ignorado: `git check-ignore -v .claude/settings.local.json` → `.claude/*` (`.gitignore:210`). Evidencia arriba.
- Hooks con rutas internas/IPs: solo `validate-prod.mjs:7` contiene hostFrag codificado via `String.fromCharCode`, no IP literal en claro versionada. No hay credenciales en hooks versionados (ver `settings.json:1` sin secrets).
