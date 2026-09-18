# Gates de calidad portables

`scripts/quality/run-checks.mjs` es el punto de entrada local y de CI para
checks que deben comunicar resultados honestos. La salida de procesos hijos se
representa solo con bytes y SHA-256; nunca se reemite su contenido.

- `--check tooling` verifica Node y conserva su código real.
- `--check secrets --root .` usa `git ls-files -z`, excluye nombres protegidos,
  enlaces y extensiones no fuente antes de leer. Los findings solo incluyen
  ruta, línea y regla, nunca el valor coincidente.
- `--check politec` invoca PowerShell y propaga su código de salida.

En Windows los launchers `npm`, `npx` y `flutter` se resuelven explícitamente
como `.cmd` o `.bat`; argumentos con metacaracteres se rechazan. En POSIX se
usa argv sin shell. Ante un timeout solicita la terminación del árbol creado
por el runner y devuelve `BLOCKED` con código 124. Si `taskkill` falla en
Windows, intenta terminar el hijo directo e informa `fallback-child-only`;
ese estado no garantiza que hayan terminado todos sus descendientes. El
campo `cleanup` registra el intento de limpieza. Una herramienta ausente
devuelve `WARN` y código no cero.

Este runner no sustituye Gitleaks, Semgrep, auditorías de dependencias, branch
protection ni aprobación humana de producción. Endurecer esos controles requiere
un slice de política y baseline aprobados.
