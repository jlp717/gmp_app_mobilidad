import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/repartidor/application/rutero_tracking_notifier.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_tracking.dart';

class RuteroTrackingPanel extends ConsumerStatefulWidget {
  const RuteroTrackingPanel({
    required this.repartidorId,
    required this.routeDate,
    required this.stops,
    super.key,
  });

  final String repartidorId;
  final String routeDate;
  final List<RuteroTrackingStop> stops;

  @override
  ConsumerState<RuteroTrackingPanel> createState() =>
      _RuteroTrackingPanelState();
}

class _RuteroTrackingPanelState extends ConsumerState<RuteroTrackingPanel> {
  bool _expanded = true;
  bool _hasResolvedInitialExpansion = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_hasResolvedInitialExpansion) {
      _expanded = !Responsive.isPhone(context);
      _hasResolvedInitialExpansion = true;
    }
    _syncStopsAfterBuild();
  }

  @override
  void didUpdateWidget(covariant RuteroTrackingPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.routeDate != widget.routeDate ||
        oldWidget.repartidorId != widget.repartidorId ||
        oldWidget.stops != widget.stops) {
      _syncStopsAfterBuild();
    }
  }

  /// Notifier updates must run after the widget tree finishes building;
  /// mutating provider state from didChangeDependencies throws in Riverpod.
  void _syncStopsAfterBuild() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        ref.read(ruteroTrackingProvider.notifier).updateStops(widget.stops);
      }
    });
  }

  void _toggleExpanded() {
    setState(() => _expanded = !_expanded);
  }

  @override
  Widget build(BuildContext context) {
    final tracking = ref.watch(ruteroTrackingProvider);
    final notifier = ref.read(ruteroTrackingProvider.notifier);
    final canStop = tracking.sessionId != null &&
        (tracking.isActive ||
            tracking.status == RuteroTrackingStatus.error ||
            tracking.status == RuteroTrackingStatus.stopping);
    final busy = tracking.status == RuteroTrackingStatus.starting ||
        tracking.status == RuteroTrackingStatus.stopping;
    final accent = tracking.isActive ? AppTheme.success : AppTheme.info;
    final isPhone = Responsive.isPhone(context);
    final toggleLabel = tracking.isActive
        ? 'Seguimiento activo. '
            '${_expanded ? 'Contraer' : 'Desplegar'} panel de seguimiento'
        : '${_expanded ? 'Contraer' : 'Desplegar'} panel de seguimiento';

    return Card(
      margin: EdgeInsets.fromLTRB(12, isPhone ? 4 : 8, 12, isPhone ? 4 : 8),
      color: AppTheme.softPanel,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: accent.withValues(alpha: 0.35)),
      ),
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          14,
          isPhone ? 8 : 12,
          14,
          isPhone ? 8 : 10,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(
              button: true,
              expanded: _expanded,
              label: toggleLabel,
              onTap: _toggleExpanded,
              onTapHint: _expanded ? 'Contraer' : 'Desplegar',
              child: InkWell(
                key: const ValueKey('rutero-tracking-collapse'),
                onTap: _toggleExpanded,
                excludeFromSemantics: true,
                borderRadius: BorderRadius.circular(10),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: 44),
                  child: Row(
                    children: [
                      Icon(
                        tracking.isActive
                            ? Icons.my_location
                            : Icons.location_searching,
                        color: accent,
                        size: isPhone ? 20 : 24,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          tracking.isActive
                              ? 'Seguimiento activo'
                              : 'Seguimiento de ruta',
                          style: TextStyle(
                            color: AppTheme.textPrimary,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      if (tracking.isActive)
                        const ExcludeSemantics(
                          child: Padding(
                            padding: EdgeInsets.only(right: 4),
                            child: Chip(
                              label: Text('EN MARCHA'),
                              visualDensity: VisualDensity.compact,
                              labelStyle: TextStyle(fontSize: 10),
                            ),
                          ),
                        ),
                      Tooltip(
                        message: _expanded ? 'Contraer' : 'Desplegar',
                        child: Icon(
                          _expanded
                              ? Icons.keyboard_arrow_up
                              : Icons.keyboard_arrow_down,
                          color: AppTheme.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            if (_expanded) ...[
              const SizedBox(height: 6),
              Text(
                tracking.isActive
                    ? 'La ubicación se registra mientras repartes. '
                        'Puedes seguir usando otras aplicaciones.'
                    : 'Registra tu avance y recibe avisos sobre la próxima parada.',
                style: TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 12,
                ),
              ),
              const SizedBox(height: 10),
              if (tracking.nextStop != null)
                _NextStopSummary(tracking: tracking)
              else
                Text(
                  'No quedan paradas pendientes en esta ruta.',
                  style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
                ),
              if (tracking.position != null) ...[
                const SizedBox(height: 8),
                Wrap(
                  spacing: 12,
                  runSpacing: 4,
                  children: [
                    _Metric(
                      icon: Icons.gps_fixed,
                      text: 'Precisión ±' +
                          tracking.position!.accuracy.toStringAsFixed(0) +
                          ' m',
                    ),
                    if (tracking.position!.speedKmh != null)
                      _Metric(
                        icon: Icons.speed,
                        text: tracking.position!.speedKmh!.toStringAsFixed(0) +
                            ' km/h',
                      ),
                    if (tracking.lastSentAt != null)
                      _Metric(
                        icon: Icons.cloud_done,
                        text: 'Sincronizado ' + _time(tracking.lastSentAt!),
                      ),
                  ],
                ),
              ],
              if (tracking.pendingSamples > 0) ...[
                const SizedBox(height: 4),
                Text(
                  tracking.pendingSamples.toString() +
                      ' punto(s) pendiente(s) de sincronizar',
                  style: const TextStyle(
                    color: AppTheme.warning,
                    fontSize: 11,
                  ),
                ),
              ],
              if (tracking.error != null) ...[
                const SizedBox(height: 8),
                Text(
                  tracking.error!,
                  key: const ValueKey('rutero-tracking-error'),
                  style: const TextStyle(color: AppTheme.error, fontSize: 12),
                ),
                if (tracking.status == RuteroTrackingStatus.permissionDenied ||
                    tracking.status == RuteroTrackingStatus.unavailable)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: _openLocationSettings,
                      icon: const Icon(Icons.settings, size: 16),
                      label: const Text('Abrir ajustes'),
                    ),
                  ),
              ],
              const Divider(height: 18),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: busy
                          ? null
                          : canStop
                              ? notifier.stop
                              : () => notifier.start(
                                    repartidorId: widget.repartidorId,
                                    routeDate: widget.routeDate,
                                    stops: widget.stops,
                                  ),
                      icon: Icon(canStop ? Icons.stop : Icons.play_arrow),
                      label: Text(
                        busy
                            ? 'Procesando…'
                            : canStop
                                ? tracking.status == RuteroTrackingStatus.error
                                    ? 'Reintentar cierre'
                                    : 'Parar seguimiento'
                                : 'Iniciar seguimiento',
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Tooltip(
                    message: 'Avisos de voz',
                    child: Switch(
                      value: tracking.voiceEnabled,
                      onChanged: busy ? null : notifier.setVoiceEnabled,
                    ),
                  ),
                  Icon(
                    Icons.volume_up_outlined,
                    color: AppTheme.textSecondary,
                    size: 18,
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                'La distancia es aproximada en línea recta. Para indicaciones '
                'de giro, usa el botón Navegar de la parada.',
                style: TextStyle(
                  color: AppTheme.textTertiary,
                  fontSize: 10,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _openLocationSettings() async {
    final openedApp = await Geolocator.openAppSettings();
    if (!openedApp) await Geolocator.openLocationSettings();
  }

  String _time(DateTime value) {
    final local = value.toLocal();
    final hour = local.hour.toString().padLeft(2, '0');
    final minute = local.minute.toString().padLeft(2, '0');
    return '$hour:$minute';
  }
}

class _NextStopSummary extends StatelessWidget {
  const _NextStopSummary({required this.tracking});

  final RuteroTrackingState tracking;

  @override
  Widget build(BuildContext context) {
    final stop = tracking.nextStop!;
    final distance = tracking.distanceToNextStopKm;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppTheme.inkSurface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 16,
            backgroundColor: AppTheme.info.withValues(alpha: 0.2),
            child: const Icon(
              Icons.navigation,
              color: AppTheme.info,
              size: 18,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Próxima parada',
                  style: TextStyle(
                    color: AppTheme.textTertiary,
                    fontSize: 11,
                  ),
                ),
                Text(
                  stop.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: AppTheme.textPrimary,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          Text(
            distance == null
                ? 'GPS pendiente'
                : distance.toStringAsFixed(1) + ' km aprox.',
            style: const TextStyle(
              color: AppTheme.accentMint,
              fontWeight: FontWeight.w700,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: AppTheme.textTertiary),
        const SizedBox(width: 3),
        Text(
          text,
          style: TextStyle(color: AppTheme.textSecondary, fontSize: 11),
        ),
      ],
    );
  }
}
