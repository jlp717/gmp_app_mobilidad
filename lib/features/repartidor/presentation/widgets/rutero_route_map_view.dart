import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/rutero_route_api.dart';
import 'package:latlong2/latlong.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_navigation_button.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_stop_status_badges.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// Sequence color: green (1st) → sky → orange (last).
Color ruteroStopColor(int index, int total) {
  if (total <= 1) return AppColors.success;
  final t = index / (total - 1);
  if (t <= 0.5) {
    return Color.lerp(AppColors.success, AppColors.info, t * 2)!;
  }
  return Color.lerp(AppColors.info, AppColors.legacyFFF97316, (t - 0.5) * 2)!;
}

// ponytail: Spain bbox 27-44 / -18-5 rejects Africa/0,0 garbage. Upgrade: tighten per delegación if needed.
bool _isValidSpainLatLng(double? lat, double? lng) {
  if (lat == null || lng == null) return false;
  if (!lat.isFinite || !lng.isFinite) return false;
  return lat >= 27 && lat <= 44 && lng >= -18 && lng <= 5;
}

const LatLng _kAlmeriaCenter = LatLng(36.834, -2.4637);

/// MapLibre with an accessible FlutterMap fallback.
class RuteroRouteMapView extends StatefulWidget {
  const RuteroRouteMapView({
    required this.ordered,
    required this.metaByDocumentId,
    this.selectedDocumentId,
    this.onStopSelected,
    this.routeExplanation,
    this.useWebView = true,
    this.fallbackTileProvider,
    super.key,
  });

  final List<AlbaranEntrega> ordered;
  final Map<String, RuteroStopWindow> metaByDocumentId;
  final String? selectedDocumentId;
  final ValueChanged<String>? onStopSelected;
  final RuteroRouteExplanation? routeExplanation;
  final bool useWebView;
  final TileProvider? fallbackTileProvider;

  @override
  State<RuteroRouteMapView> createState() => _RuteroRouteMapViewState();
}

class _RuteroRouteMapViewState extends State<RuteroRouteMapView> {
  WebViewController? _controller;
  bool _webReady = false;
  bool _useFallback = false;
  bool _loadingHtml = true;
  String? _lastPushSignature;
  late final MapController _mapController;

  @override
  void initState() {
    super.initState();
    _mapController = MapController();
    if (widget.useWebView) {
      unawaited(_initWebView());
    } else {
      _useFallback = true;
      _loadingHtml = false;
    }
  }

  @override
  void didUpdateWidget(covariant RuteroRouteMapView oldWidget) {
    super.didUpdateWidget(oldWidget);
    unawaited(_pushRouteToWeb());
    if (widget.selectedDocumentId != null &&
        widget.selectedDocumentId != oldWidget.selectedDocumentId) {
      unawaited(_highlightSelected());
    }
  }

  @override
  void dispose() {
    unawaited(
      _controller?.removeJavaScriptChannel('FlutterMapBridge') ??
          Future<void>.value(),
    );
    _mapController.dispose();
    super.dispose();
  }

  Future<void> _initWebView() async {
    try {
      final html = await rootBundle.loadString('assets/rutero_map/index.html');
      final controller = WebViewController();
      await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
      await controller.setBackgroundColor(AppTheme.inkSurface);
      await controller.addJavaScriptChannel(
        'FlutterMapBridge',
        onMessageReceived: (message) {
          if (!mounted) return;
          try {
            final data = jsonDecode(message.message) as Map<String, dynamic>;
            final type = data['type']?.toString();
            if (type == 'mapReady' || type == 'ready') {
              setState(() {
                _webReady = true;
                _loadingHtml = false;
              });
              unawaited(_pushRouteToWeb(force: true));
            } else if (type == 'markerTap') {
              final id = data['documentId']?.toString();
              if (id != null && id.isNotEmpty) {
                widget.onStopSelected?.call(id);
              }
            }
          } catch (e) {
            debugPrint('[RuteroMap] bridge parse error: $e');
          }
        },
      );
      await controller.setNavigationDelegate(
        NavigationDelegate(
          onWebResourceError: (error) {
            debugPrint('[RuteroMap] web error: ${error.description}');
            if (mounted) {
              setState(() {
                _useFallback = true;
                _loadingHtml = false;
              });
            }
          },
        ),
      );
      await controller.loadHtmlString(
        html,
        baseUrl: 'https://local.rutero.map/',
      );

      if (!mounted) return;
      setState(() {
        _controller = controller;
      });
      unawaited(_pushRouteToWeb(force: true));

      unawaited(
        Future<void>.delayed(const Duration(seconds: 8), () {
          if (!mounted || _webReady) return;
          setState(() {
            _useFallback = true;
            _loadingHtml = false;
          });
        }),
      );
    } catch (e) {
      debugPrint('[RuteroMap] html load failed: $e');
      if (mounted) {
        setState(() {
          _useFallback = true;
          _loadingHtml = false;
        });
      }
    }
  }

  String _docLabel(AlbaranEntrega a) {
    if (a.numeroFactura > 0) return 'Fac ${a.numeroFactura}';
    return 'Alb ${a.numeroAlbaran}';
  }

  String _docTipo(AlbaranEntrega a) {
    if (a.numeroFactura > 0) return 'FACTURA';
    return 'ALBARÁN';
  }

  List<Map<String, dynamic>> _stopPayload() {
    return widget.ordered.asMap().entries.map((entry) {
      final albaran = entry.value;
      final meta = widget.metaByDocumentId[albaran.id] ??
          widget.metaByDocumentId[albaran.codigoCliente];
      return <String, dynamic>{
        'documentId': albaran.id,
        'cliente': albaran.codigoCliente,
        'nombreCliente': albaran.nombreCliente,
        'index': entry.key,
        'next': entry.key == _nextIndex,
        'lat': _isValidSpainLatLng(meta?.lat, meta?.lng) ? meta?.lat : null,
        'lng': _isValidSpainLatLng(meta?.lat, meta?.lng) ? meta?.lng : null,
        'windowLabel': meta?.windowLabel,
        'etaLabel': meta?.etaLabel,
        'closedDay': meta?.closedDay ?? false,
        'docLabel': '${_docTipo(albaran)} · ${_docLabel(albaran)}',
        'reason': meta?.reason,
      };
    }).toList(growable: false);
  }

  Future<void> _pushRouteToWeb({bool force = false}) async {
    if (_useFallback || !_webReady || _controller == null) return;
    final payload = {
      'stops': _stopPayload(),
      'selectedId': widget.selectedDocumentId,
    };
    final signature = jsonEncode(payload);
    if (!force && signature == _lastPushSignature) return;
    _lastPushSignature = signature;
    try {
      await _controller!.runJavaScript(
        'window.setRoute && window.setRoute(${jsonEncode(payload)});',
      );
    } catch (e) {
      debugPrint('[RuteroMap] push failed: $e');
      if (mounted) setState(() => _useFallback = true);
    }
  }

  Future<void> _highlightSelected() async {
    final id = widget.selectedDocumentId;
    if (id == null || _controller == null || _useFallback || !_webReady) return;
    try {
      await _controller!.runJavaScript(
        'window.highlightStop && window.highlightStop(${jsonEncode(id)});',
      );
    } catch (_) {}
  }

  LatLng get _center {
    final points = _geoPoints();
    if (points.isEmpty) return _kAlmeriaCenter;
    final lat =
        points.map((p) => p.latitude).reduce((a, b) => a + b) / points.length;
    final lng =
        points.map((p) => p.longitude).reduce((a, b) => a + b) / points.length;
    return LatLng(lat, lng);
  }

  List<LatLng> _geoPoints() {
    final points = <LatLng>[];
    for (final albaran in widget.ordered) {
      final meta = widget.metaByDocumentId[albaran.id] ??
          widget.metaByDocumentId[albaran.codigoCliente];
      if (_isValidSpainLatLng(meta?.lat, meta?.lng)) {
        points.add(LatLng(meta!.lat!, meta.lng!));
      }
    }
    return points;
  }

  AlbaranEntrega? get _selectedAlbaran {
    final id = widget.selectedDocumentId;
    if (id == null) return null;
    for (final a in widget.ordered) {
      if (a.id == id) return a;
    }
    return null;
  }

  int get _nextIndex => widget.ordered.indexWhere((stop) =>
      stop.estado == EstadoEntrega.pendiente ||
      stop.estado == EstadoEntrega.enRuta);

  Widget _buildSummary() {
    final remaining = widget.ordered
        .where((stop) =>
            stop.estado == EstadoEntrega.pendiente ||
            stop.estado == EstadoEntrega.enRuta)
        .toList();
    final metas = remaining.map(_metaFor).toList();
    final measured = remaining.isNotEmpty &&
        widget.routeExplanation != null &&
        metas.every((m) =>
            m?.distanceKmFromPrev != null && m?.travelMinutesFromPrev != null);
    final km = measured
        ? metas.fold<double>(0, (sum, m) => sum + m!.distanceKmFromPrev!)
        : null;
    final minutes = measured
        ? metas.fold<int>(0, (sum, m) => sum + m!.travelMinutesFromPrev!)
        : null;
    return Material(
        color: AppTheme.inkSurface,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
            padding: const EdgeInsets.all(10),
            child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                      '${remaining.length} paradas restantes · ${widget.ordered.length} en total',
                      style: TextStyle(
                          color: AppTheme.textPrimary,
                          fontWeight: FontWeight.bold)),
                  Text(
                      '${km == null ? "Distancia sin calcular" : "~${km.toStringAsFixed(1)} km"} · ${minutes == null ? "Tiempo sin calcular" : "~$minutes min de conducción"}',
                      style: TextStyle(
                          color: AppTheme.textSecondary, fontSize: 12)),
                  if (_nextIndex >= 0)
                    TextButton.icon(
                      onPressed: () => widget.onStopSelected
                          ?.call(widget.ordered[_nextIndex].id),
                      icon: const Icon(Icons.near_me),
                      label: Text(
                          'Siguiente: parada ${_nextIndex + 1} · ${widget.ordered[_nextIndex].nombreCliente}',
                          maxLines: 2),
                    ),
                  Text(
                      '1 → 2 → 3: orden de visita. Borde amarillo: siguiente. Línea orientativa, no trazado por carretera. '
                      '${widget.ordered.length - _geoPoints().length} sin ubicación: permanecen en la lista; faltan sus tramos.',
                      style: TextStyle(
                          color: AppTheme.textSecondary, fontSize: 11)),
                ])));
  }

  RuteroStopWindow? _metaFor(AlbaranEntrega a) =>
      widget.metaByDocumentId[a.id] ?? widget.metaByDocumentId[a.codigoCliente];

  @override
  Widget build(BuildContext context) {
    final selected = _selectedAlbaran;
    final mappedStops = _geoPoints().length;
    if (widget.ordered.isNotEmpty && mappedStops == 0) {
      return SingleChildScrollView(
          child: Column(children: [
        Padding(padding: const EdgeInsets.all(12), child: _buildSummary()),
        _buildNoCoordinates(),
      ]));
    }

    return Stack(
      children: [
        if (!_useFallback && _controller != null)
          WebViewWidget(controller: _controller!)
        else
          _buildFallbackMap(),
        if (_loadingHtml && !_useFallback)
          const Center(
            child: CircularProgressIndicator(color: AppTheme.info),
          ),
        Positioned(top: 10, left: 12, right: 56, child: _buildSummary()),
        if (selected != null)
          Positioned(
            left: 10,
            right: 10,
            bottom: 10,
            child: ConstrainedBox(
              constraints: BoxConstraints(
                  maxHeight: MediaQuery.sizeOf(context).height * 0.35),
              child: SingleChildScrollView(
                  child: _StopDetailCard(
                albaran: selected,
                index: widget.ordered.indexWhere((a) => a.id == selected.id),
                total: widget.ordered.length,
                meta: _metaFor(selected),
                onClose: () => widget.onStopSelected?.call(''),
              )),
            ),
          )
        else
          Positioned(
            left: 12,
            bottom: 12,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              decoration: BoxDecoration(
                color: AppTheme.inkSurface.withValues(alpha: 0.92),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppTheme.borderColor),
              ),
              child: Text(
                _useFallback
                    ? 'Toca el número de una parada para ver sus datos'
                    : '$mappedStops/${widget.ordered.length} con ubicación · toca una parada',
                style: TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildNoCoordinates() {
    return Center(
      child: Container(
        margin: const EdgeInsets.all(24),
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: AppTheme.inkSurface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppTheme.borderColor),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.location_off_outlined,
              color: AppTheme.warning,
              size: 32,
            ),
            SizedBox(height: 10),
            Text(
              'No hay ubicaciones disponibles',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: AppTheme.textPrimary,
                fontWeight: FontWeight.w700,
              ),
            ),
            SizedBox(height: 6),
            Text(
              'Las paradas siguen en la lista y puedes cambiar su orden. No se pueden dibujar la ruta ni sus distancias sin ubicaciones válidas.\n\nPide al comercial que revise la ubicación de los clientes.',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFallbackMap() {
    final points = _geoPoints();
    final groups = <String, List<int>>{};
    final positions = <int, LatLng>{};
    for (var i = 0; i < widget.ordered.length; i++) {
      final point = _pointFor(widget.ordered[i]);
      if (point == null) continue;
      positions[i] = point;
      groups
          .putIfAbsent('${point.latitude},${point.longitude}', () => [])
          .add(i);
    }
    return FlutterMap(
      mapController: _mapController,
      options: MapOptions(
        initialCenter: _center,
        initialZoom: points.length <= 1 ? 12 : 11,
        minZoom: 5,
        maxZoom: 18,
      ),
      children: [
        TileLayer(
            tileProvider: widget.fallbackTileProvider,
            urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            userAgentPackageName: 'com.gmp.mobilidad',
            maxZoom: 19),
        PolylineLayer(polylines: [
          for (var i = 1; i < widget.ordered.length; i++)
            if (positions[i - 1] != null && positions[i] != null)
              Polyline(
                  points: [positions[i - 1]!, positions[i]!],
                  strokeWidth: 5,
                  borderStrokeWidth: 2,
                  borderColor: AppTheme.inkSurface,
                  color: AppTheme.info),
        ]),
        MarkerLayer(markers: [
          for (var i = 1; i < widget.ordered.length; i++)
            if (positions[i - 1] != null &&
                positions[i] != null &&
                positions[i - 1] != positions[i])
              _directionMarker(positions[i - 1]!, positions[i]!),
          for (final indices in groups.values)
            Marker(
              point: positions[indices.first]!,
              width: indices.length * 60.0,
              height: 60,
              child: Row(children: [
                for (final i in indices)
                  SizedBox(
                      width: 60,
                      height: 60,
                      child: Padding(
                        padding: const EdgeInsets.all(2),
                        child: Semantics(
                          button: true,
                          label:
                              'Parada ${i + 1}, ${widget.ordered[i].nombreCliente}${i == _nextIndex ? ", siguiente" : ""}',
                          child: GestureDetector(
                            onTap: () => widget.onStopSelected
                                ?.call(widget.ordered[i].id),
                            child: _NumberedPin(
                              index: i + 1,
                              color: ruteroStopColor(i, widget.ordered.length),
                              selected: widget.selectedDocumentId ==
                                  widget.ordered[i].id,
                              isFirst: i == _nextIndex,
                            ),
                          ),
                        ),
                      )),
              ]),
            ),
        ]),
        RichAttributionWidget(
          attributions: const [TextSourceAttribution('OpenStreetMap')],
        ),
      ],
    );
  }

  Marker _directionMarker(LatLng from, LatLng to) {
    final angle = math.atan2(
        -(to.latitude - from.latitude),
        (to.longitude - from.longitude) *
            math.cos(from.latitude * math.pi / 180));
    return Marker(
      point: LatLng((from.latitude + to.latitude) / 2,
          (from.longitude + to.longitude) / 2),
      width: 28,
      height: 28,
      child: ExcludeSemantics(
          child: Transform.rotate(
              angle: angle,
              child: Icon(Icons.arrow_forward,
                  size: 26, color: AppTheme.inkSurface))),
    );
  }

  LatLng? _pointFor(AlbaranEntrega albaran) {
    final meta = widget.metaByDocumentId[albaran.id] ??
        widget.metaByDocumentId[albaran.codigoCliente];
    if (!_isValidSpainLatLng(meta?.lat, meta?.lng)) return null;
    return LatLng(meta!.lat!, meta.lng!);
  }
}

class _StopDetailCard extends StatelessWidget {
  const _StopDetailCard({
    required this.albaran,
    required this.index,
    required this.total,
    required this.meta,
    required this.onClose,
  });

  final AlbaranEntrega albaran;
  final int index;
  final int total;
  final RuteroStopWindow? meta;
  final VoidCallback onClose;

  String get _docTipo => albaran.numeroFactura > 0 ? 'FACTURA' : 'ALBARÁN';

  String get _docLabel => albaran.numeroFactura > 0
      ? 'Fac ${albaran.numeroFactura}'
      : 'Alb ${albaran.numeroAlbaran}';

  String get _pagoLabel {
    final tipo = albaran.tipoPago.trim();
    final forma = albaran.formaPagoDesc.trim().isNotEmpty
        ? albaran.formaPagoDesc
        : albaran.formaPago;
    if (albaran.esCTR) {
      return 'CONTADO / cobro en ruta${forma.isNotEmpty ? ' · $forma' : ''}';
    }
    if (tipo.isNotEmpty || forma.isNotEmpty) {
      return [tipo, forma].where((s) => s.isNotEmpty).join(' · ');
    }
    return '—';
  }

  @override
  Widget build(BuildContext context) {
    final color = index >= 0 ? ruteroStopColor(index, total) : AppColors.info;
    final desired = meta?.windowLabel ??
        (albaran.horaPrevista != null
            ? 'Prevista ${albaran.horaPrevista}'
            : null);
    final eta = meta?.etaLabel;
    final prep = meta?.prepReadyLabel;
    final pickup = meta?.pickupLabel ?? meta?.departureLabel;

    return Material(
      elevation: 8,
      color: AppColors.raisedSurface,
      borderRadius: BorderRadius.circular(14),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 10, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Container(
                  width: 28,
                  height: 28,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: color,
                    shape: BoxShape.circle,
                    border: Border.all(color: AppColors.themedWhite, width: 2),
                  ),
                  child: Text(
                    index >= 0 ? '${index + 1}' : '·',
                    style: TextStyle(
                      color: AppColors.themedWhite,
                      fontWeight: FontWeight.w800,
                      fontSize: 14,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        albaran.nombreCliente,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontWeight: FontWeight.w700,
                          fontSize: 14,
                        ),
                      ),
                      Text(
                        '${albaran.codigoCliente} · $_docTipo · $_docLabel'
                        '${albaran.esCTR ? ' · CTR' : ''}',
                        style: TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  visualDensity: VisualDensity.compact,
                  onPressed: onClose,
                  icon: const Icon(Icons.close, size: 18),
                  color: AppColors.textSecondary,
                ),
              ],
            ),
            if (albaran.direccion.trim().isNotEmpty ||
                albaran.poblacion.trim().isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                [
                  albaran.direccion.trim(),
                  albaran.poblacion.trim(),
                ].where((s) => s.isNotEmpty).join(' · '),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 11,
                ),
              ),
            ],
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _chip(Icons.schedule, 'Horario de entrega',
                    desired ?? 'Sin horario'),
                _chip(Icons.navigation, 'Llegada estimada',
                    eta ?? 'Sin calcular'),
                _chip(Icons.inventory_2_outlined, 'Preparación lista',
                    prep ?? 'Sin calcular'),
                _chip(Icons.local_shipping_outlined, 'Recogida', pickup ?? '—'),
                _chip(Icons.payments_outlined, 'Pago', _pagoLabel),
                if (albaran.ordenPreparacion != null)
                  _chip(
                    Icons.tag,
                    'Orden de preparación',
                    '#${albaran.ordenPreparacion}',
                  ),
                if (meta?.distanceKmFromPrev != null)
                  _chip(
                    Icons.straighten,
                    'Desde la parada anterior',
                    '${meta!.distanceKmFromPrev!.toStringAsFixed(1)} km',
                  ),
              ],
            ),
            if (_isValidSpainLatLng(meta?.lat, meta?.lng)) ...[
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: RuteroNavigationButton(lat: meta!.lat!, lng: meta!.lng!),
              ),
            ],
            RuteroStopStatusBadges(albaran: albaran),
            if ((meta?.observaciones ?? albaran.observaciones ?? '')
                .trim()
                .isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                (meta?.observaciones ?? albaran.observaciones)!.trim(),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.ochre,
                  fontSize: 11,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _chip(IconData icon, String label, String value) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.softPanel,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.borderColor),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: AppColors.teal),
          const SizedBox(width: 5),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 9,
                  fontWeight: FontWeight.w600,
                ),
              ),
              Text(
                value,
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _NumberedPin extends StatelessWidget {
  const _NumberedPin({
    required this.index,
    required this.color,
    required this.selected,
    this.isFirst = false,
    this.isLast = false,
  });

  final int index;
  final Color color;
  final bool selected;
  final bool isFirst;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    return Container(
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: AppTheme.inkSurface,
        shape: BoxShape.circle,
        border: Border.all(
            color: isFirst
                ? AppTheme.warning
                : selected
                    ? AppTheme.info
                    : AppColors.themedWhite,
            width: isFirst ? 5 : 3),
        boxShadow: [
          if (isFirst)
            BoxShadow(
              color: AppColors.success.withValues(alpha: 0.55),
              blurRadius: 8,
              spreadRadius: 1,
            ),
          if (isLast)
            BoxShadow(
              color: AppColors.legacyFFF97316.withValues(alpha: 0.45),
              blurRadius: 8,
              spreadRadius: 1,
            ),
          BoxShadow(
            color: AppColors.systemBlack.withValues(alpha: 0.35),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Text(
        '$index',
        style: TextStyle(
          color: AppColors.themedWhite,
          fontWeight: FontWeight.bold,
          fontSize: 22,
        ),
      ),
    );
  }
}
