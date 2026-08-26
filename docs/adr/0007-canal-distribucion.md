# 0007 — Firebase App Distribution como canal primario para Android

- Estado: Propuesto — pendiente de primera ejecución real
- Fecha: 2026-08-26
- Decisores: Javier (@jlp717)
- Etiquetas: android, ci-cd, distribución

## Contexto

GMP App Mobilidad se distribuye a unas decenas de comerciales y hoy solo opera el target Android. El repositorio contiene el scaffold Flutter de iOS (`ios/Runner.xcodeproj`), pero iOS está fuera del alcance operativo actual: no hay firma iOS configurada ni cuenta Apple Developer integrada en el pipeline. El equipo necesita entregar versiones Android firmadas con rapidez, trazabilidad y acceso restringido, sin depender del ciclo de publicación de una tienda.

## Decisión

1. **Canal primario**: Firebase App Distribution distribuirá el APK firmado al grupo `comerciales`.
2. **Entrega inmediata**: el canal evita revisión de tienda, permite rollout inmediato y es gratuito para uso interno.
3. **Trazabilidad**: GitHub Actions usará `github.run_number` como build number, tags `v*` como ancla del changelog y nombres de artifact con build number y SHA corto.
4. **Firma**: keystore y credenciales vivirán en GitHub Secrets. `android/key.properties` se generará únicamente durante el job de build.
5. **Canal alternativo**: Fastlane conservará lane `internal` para Google Play si una exigencia futura obliga a distribuir AAB.

## Consecuencias

**Positivas**
- Distribución directa y rápida a comerciales autorizados.
- APK y AAB quedan disponibles como artifacts trazables de cada ejecución.
- Primera ejecución puede validar firma y artifacts aunque Firebase aún no esté configurado.

**Negativas / riesgos**
- Firebase requiere mantener token CLI, App ID y grupo `comerciales` operativos.
- Usuarios deben aceptar instalación o actualización fuera de Google Play.
- Pérdida de keystore o credenciales impide publicar hasta completar recuperación o rotación.

## Alternativas consideradas

1. **Google Play, track interno** — requiere cuenta Play Console con pago único de 25 USD, revisión aunque sea reducida y más fricción para una flota de unas decenas de comerciales. Se mantiene como lane alternativa si Google exige AAB en el futuro.
2. **Distribución manual de APK** — reduce automatización, trazabilidad y control de acceso; rechazada.
3. **iOS mediante TestFlight** — existe scaffold Flutter, pero no hay pipeline, firma configurada ni cuenta Apple Developer integrada. Si se activa iOS, se usará Fastlane match para gestionar firma y TestFlight para distribución.
