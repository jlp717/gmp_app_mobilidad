# Remediación dirigida de dependencias

SEC-08B actualiza únicamente los avisos auditados el 18 de septiembre de 2026. El backend usa Express 4.22.3, Joi 17.13.8 (el manifiesto fija el suelo compatible `^17.13.6`), csv-parse 7.0.2 y Morgan 1.12.1. Morgan y `@types/morgan` se declaran explícitamente porque los entrypoints TypeScript lo importan.

La lock fuerza js-yaml 3.15.2 solamente bajo `@istanbuljs/load-nyc-config`, js-yaml 4.3.2 para el tooling raíz y qs 6.16.0 bajo `body-parser`. Las referencias primarias son [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh) y el [changelog de csv-parse](https://github.com/adaltas/node-csv/blob/master/packages/csv-parse/CHANGELOG.md). No se emplea `npm audit fix` ni se promueven cambios de Node, PM2 o producción.

La migración de csv-parse conserva el import CommonJS `csv-parse/sync`. Sus pruebas usan entradas sintéticas para BOM, delimitadores, diacríticos, comillas, importes textuales, columnas irregulares, vacío y claves reservadas. Los headers se reconstruyen como propiedades propias para que `__proto__`, `constructor` y `prototype` no modifiquen prototipos.

Los manifests y locks se generan y verifican en `C:/Users/Javier/.codex/tools/gmp-security-dependencies-20260918`, con instalaciones físicas y `--ignore-scripts`. La evidencia debe indicar versiones resueltas, auditorías raíz/backend y pruebas ejecutadas contra esas dependencias nuevas.

Verificación final de este slice: dos revisores independientes reprodujeron 22 suites/416 tests de la lane aislada y nueve contratos CSV/body-parser. `npm audit --json` devolvió cero avisos en raíz y backend, con exit0. Esto refleja la base de avisos consultada en esa fecha, no seguridad absoluta. El canario de tipos se ejecutó explícitamente con TypeScript5 desde el backend fresco:

```text
node node_modules/typescript/bin/tsc --noEmit --strict --esModuleInterop --skipLibCheck --module commonjs --target ES2022 tests/fixtures/types/morgan-compatibility.ts
```

La compilación habitual sólo cubre lo incluido por el tsconfig; no se atribuye cobertura de todo el árbol TypeScript. El aviso deprecado de ts-jest `isolatedModules` sigue registrado. Las instalaciones con scripts omitidos tampoco acreditan compatibilidad nativa ODBC en Linux/IBM i.
