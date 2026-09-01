/// Offline state widgets (piloto estados offline, pasada 1)
/// ==========================================================
/// Estado UI estandar para desconexion, reutilizando
/// `connectivityStatusProvider` (lib/core/offline/connectivity_provider.dart).
///
/// Patrones visuales copiados de widgets existentes (NO diseno nuevo):
/// - `ErrorStateWidget`: esqueleto de estado centrado (circulo + mensaje +
///   reintentar) y animaciones con soporte reduceMotion.
/// - `_PendingSyncChip` (repartidor_rutero_page): franja compacta con icono
///   18 + texto 12 w600 en tono warning.
/// - Vocabulario: 'Sin conexion' / 'Conexion limitada' de
///   core/offline/offline_aware_api.dart.
library;

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/offline/connectivity_provider.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Estado offline a pantalla completa (gemelo de `ErrorStateWidget` en tono
/// warning: la desconexion es una condicion, no un error).
///
/// Uso: paginas sin datos que fallan por red. El callback opcional
/// [onRetry] muestra el boton 'Reintentar'.
class OfflineStateWidget extends StatelessWidget {
  /// Crea el estado offline a pantalla completa.
  const OfflineStateWidget({
    this.message = 'Sin conexión',
    this.detail,
    this.onRetry,
    this.retryLabel = 'Reintentar',
    this.iconSize = 48,
    super.key,
  });

  /// Titulo corto del estado. Mantener el estandar 'Sin conexión' para
  /// consistencia con el resto de la app.
  final String message;

  /// Linea explicativa opcional bajo el titulo.
  final String? detail;

  /// Callback opcional del boton reintentar. Si es null no se muestra boton.
  final VoidCallback? onRetry;

  /// Texto del boton reintentar.
  final String retryLabel;

  /// Tamano del icono principal.
  final double iconSize;

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.of(context).disableAnimations;
    final semanticLabel = detail == null ? message : '$message. $detail';

    return Semantics(
      container: true,
      label: semanticLabel,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: AppTheme.cardGradient,
                  border: Border.all(
                    color: AppTheme.warning.withValues(alpha: 0.48),
                  ),
                  boxShadow: [
                    ...AppTheme.elevation2,
                    BoxShadow(
                      color: AppTheme.warning.withValues(alpha: 0.14),
                      blurRadius: 26,
                    ),
                  ],
                ),
                child: Icon(
                  Icons.cloud_off_rounded,
                  color: AppTheme.warning,
                  size: iconSize,
                ),
              )
                  .animate()
                  .fadeIn(
                    duration: reduceMotion ? 1.ms : 220.ms,
                  )
                  .scale(
                    begin: reduceMotion
                        ? const Offset(1, 1)
                        : const Offset(0.96, 0.96),
                  ),
              const SizedBox(height: 16),
              ExcludeSemantics(
                child: Text(
                  message,
                  style: const TextStyle(
                    color: AppTheme.textPrimary,
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0,
                  ),
                  textAlign: TextAlign.center,
                ).animate().fadeIn(delay: 80.ms, duration: 180.ms),
              ),
              if (detail != null) ...[
                const SizedBox(height: 8),
                ExcludeSemantics(
                  child: Text(
                    detail!,
                    style: const TextStyle(
                      color: AppTheme.textSecondary,
                      fontSize: 14,
                      height: 1.5,
                      letterSpacing: 0,
                    ),
                    textAlign: TextAlign.center,
                  ).animate().fadeIn(delay: 100.ms, duration: 180.ms),
                ),
              ],
              if (onRetry != null) ...[
                const SizedBox(height: 20),
                OutlinedButton.icon(
                  onPressed: onRetry,
                  icon: const Icon(Icons.refresh_rounded, size: 18),
                  label: Text(retryLabel),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppTheme.warning,
                    side: BorderSide(
                      color: AppTheme.warning.withValues(alpha: 0.38),
                    ),
                  ),
                ).animate().fadeIn(delay: 120.ms, duration: 180.ms),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Franja reactiva de conectividad para insertar al inicio del body de una
/// pagina. Vigila `connectivityStatusProvider` con `select()` (rebuild fino
/// solo cuando cambia el status) y se colapsa a [SizedBox.shrink] cuando hay
/// conexion verificada, sin coste de render.
///
/// - offline: 'Sin conexión' + aviso de datos desactualizados.
/// - limited (VPN sin ruta / portal cautivo): 'Conexión limitada'.
/// - online: nada (la pagina renderiza su UI normal).
///
/// El boton reintentar, si se provee [onRetry], lo usa; si no, ejecuta el
/// rechequeo de conectividad de [ConnectivityService.forceRecheck].
class OfflineBanner extends ConsumerWidget {
  /// Crea la franja reactiva de conectividad.
  const OfflineBanner({super.key, this.onRetry});

  /// Callback opcional del boton reintentar. Por defecto fuerza un
  /// rechequeo inmediato de conectividad.
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // select(): rebuild solo cuando cambia ConnectivityStatus; loading y
    // otros estados de AsyncValue no reconstruyen la pagina huésped.
    final status = ref.watch(
      connectivityStatusProvider.select(
        (async) => async.value ?? ConnectivityStatus.online,
      ),
    );
    if (status == ConnectivityStatus.online) return const SizedBox.shrink();

    final isOffline = status == ConnectivityStatus.offline;
    final title = isOffline ? 'Sin conexión' : 'Conexión limitada';
    final detail = isOffline
        ? 'Los datos mostrados pueden estar desactualizados. '
            'Se sincronizarán al reconectar.'
        : 'No se puede alcanzar el servidor. '
            'Se muestran los últimos datos guardados.';
    final message = '$title. $detail';

    return Semantics(
      container: true,
      liveRegion: true,
      label: message,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
        decoration: BoxDecoration(
          color: AppTheme.raisedSurface,
          border: Border(
            bottom: BorderSide(
              color: AppTheme.warning.withValues(alpha: 0.35),
            ),
          ),
        ),
        child: Row(
          children: [
            const Icon(
              Icons.cloud_off_rounded,
              size: 18,
              color: AppTheme.warning,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: ExcludeSemantics(
                child: Text(
                  message,
                  style: const TextStyle(
                    color: AppTheme.warning,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0,
                  ),
                ),
              ),
            ),
            IconButton(
              tooltip: 'Reintentar conexión',
              onPressed: onRetry ?? ConnectivityService.instance.forceRecheck,
              icon: const Icon(
                Icons.refresh_rounded,
                size: 18,
                color: AppTheme.warning,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
