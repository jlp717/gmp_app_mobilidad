# Fuentes oficiales consultadas

Consulta: 18-09-2026. Se usan como referencia de controles, no como prueba de que GMP los cumple. Las recomendaciones concretas se derivan del código y riesgos descritos en la auditoría.

| Fuente | Uso limitado en este plan |
|---|---|
| [OWASP ASVS](https://github.com/owasp/asvs) | La versión estable publicada es5.0.0; marco para requisitos/pruebas backend. Fijar versión de IDs en la matriz. |
| [OWASP MASVS](https://mas.owasp.org/MASVS/) | Áreas móvil: storage, crypto, auth, network, platform, code, resilience, privacy. Los antiguos niveles MASVS no deben aplicarse como si siguieran vigentes. |
| [Dart HttpClient.badCertificateCallback](https://api.dart.dev/dart-io/HttpClient/badCertificateCallback.html) | Solo decide sobre certificados que no pueden autenticarse con raíces confiables; fundamenta la corrección del supuesto pinning. |
| [Flutter performance best practices](https://docs.flutter.dev/perf/best-practices) | Perfilar y medir costes de build/render antes de optimizar. |
| [Flutter DevTools performance](https://docs.flutter.dev/tools/devtools/performance) | Evidencia de timeline y frames en el entorno adecuado. |
| [Node.js releases](https://nodejs.org/en/about/previous-releases) | Node20 figura EOL. Elegir LTS mantenida y validar compatibilidad, no asumir que engines>=20 basta. |
| [Node.js security best practices](https://nodejs.org/en/learn/getting-started/security-best-practices) | Recursos, dependencias y hardening runtime. |
| [Express production security](https://expressjs.com/en/advanced/best-practice-security/) | TLS, entrada, cabeceras, cookies y dependencias; adaptar al runtime real. |
| [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use) | Permisos, acciones fijadas y fronteras entre PRs no confiables y secretos. |
| [OWASP File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) | Validación de archivos, límites y almacenamiento fuera de superficie pública. |
| [OWASP REST Security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html) | Controles de API y errores, sin sustituir pruebas de lógica GMP. |
| [W3C WCAG2.2](https://www.w3.org/TR/WCAG22/) | Referencia de accesibilidad; validación nativa/plataforma adicional. |

No se copiaron guías completas ni se incorporó una lista de CVEs memorizada. El resultado SCA citado corresponde a una ejecución concreta y a su alcance. Reconsultar versiones/soporte/advisories al implementar, porque cambian.
