import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/rutero_route_api.dart';
import 'package:latlong2/latlong.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

/// Sequence color: green (1st) → sky → orange (last).
Color ruteroStopColor(int index, int total) {
  if (total <= 1) return AppColors.success;
  final t = index / (total - 1);
  if (t <= 0.5) {
    return Color.lerp(AppColors.success, AppColors.info, t * 2)!;
  }
  return Color.lerp(AppColors.info, const Color(0xFFF97316), (t - 0.5) * 2)!;
}

// ponytail: Spain bbox 27-44 / -18-5 rejects Africa/0,0 garbage. Upgrade: tighten per delegación if needed.
bool _isValidSpainLatLng(double? lat, double? lng) {
  if (lat == null || lng == null) return false;
  if (!lat.isFinite || !lng.isFinite) return false;
  return lat >= 27 && lat <= 44 && lng >= -18 && lng <= 5;
}

const LatLng _kAlmeriaCenter = LatLng(36.834, -2.4637);

/// 3D MapLibre (OSM tiles, no Mapbox token) with flutter_map 2.5D fallback.
class RuteroRouteMapView extends StatefulWidget {
  const RuteroRouteMapView({
    required this.ordered,
    required this.metaByDocumentId,
    this.selectedDocumentId,
    this.onStopSelected,
    this.routeExplanation,
    super.key,
  });

  final List<AlbaranEntrega> ordered;
  final Map<String, RuteroStopWindow> metaByDocumentId;
  final String? selectedDocumentId;
  final ValueChanged<String>? onStopSelected;
  final RuteroRouteExplanation? routeExplanation;

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
    _initWebView();
  }

  @override
  void didUpdateWidget(covariant RuteroRouteMapView oldWidget) {
    super.didUpdateWidget(oldWidget);
    _pushRouteToWeb();
    if (widget.selectedDocumentId != null &&
        widget.selectedDocumentId != oldWidget.selectedDocumentId) {
      _highlightSelected();
    }
  }

  @override
  void dispose() {
    _controller?.removeJavaScriptChannel('FlutterMapBridge');
    _mapController.dispose();
    super.dispose();
  }

  Future<void> _initWebView() async {
    try {
      final html = await rootBundle.loadString('assets/rutero_map/index.html');
      final controller = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setBackgroundColor(AppTheme.inkSurface)
        ..addJavaScriptChannel(
          'FlutterMapBridge',
          onMessageReceived: (message) {
            try {
              final data = jsonDecode(message.message) as Map<String, dynamic>;
              final type = data['type']?.toString();
              if (type == 'mapReady' || type == 'ready') {
                setState(() {
                  _webReady = true;
                  _loadingHtml = false;
                });
                _pushRouteToWeb(force: true);
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
        )
        ..setNavigationDelegate(
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
        )
        ..loadHtmlString(html, baseUrl: 'https://local.rutero.map/');

      if (!mounted) return;
      setState(() {
        _controller = controller;
      });

      Future<void>.delayed(const Duration(seconds: 8), () {
        if (!mounted || _webReady) return;
        setState(() {
          _useFallback = true;
          _loadingHtml = false;
        });
      });
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
        'lat': _isValidSpainLatLng(meta?.lat, meta?.lng) ? meta?.lat : null,
        'lng': _isValidSpainLatLng(meta?.lat, meta?.lng) ? meta?.lng : null,
        'windowLabel': meta?.windowLabel,
        'etaLabel': meta?.etaLabel,
        'closedDay': meta?.closedDay == true,
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

  RuteroStopWindow? _metaFor(AlbaranEntrega a) =>
      widget.metaByDocumentId[a.id] ?? widget.metaByDocumentId[a.codigoCliente];

  @override
  Widget build(BuildContext context) {
    final selected = _selectedAlbaran;
    final explanation = widget.routeExplanation;
    final mappedStops = _geoPoints().length;
    if (widget.ordered.isNotEmpty && mappedStops == 0) {
      return _buildNoCoordinates();
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
        if (explanation != null && !explanation.isEmpty)
          Positioned(
            top: 10,
            left: 12,
            right: 56,
            child: _RouteWhyCard(explanation: explanation),
          ),
        if (selected != null)
          Positioned(
            left: 10,
            right: 10,
            bottom: 10,
            child: _StopDetailCard(
              albaran: selected,
              index: widget.ordered.indexWhere((a) => a.id == selected.id),
              total: widget.ordered.length,
              meta: _metaFor(selected),
              onClose: () => widget.onStopSelected?.call(''),
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
                    ? 'Mapa 2.5D · toca un nº para detalle'
                    : '$mappedStops/${widget.ordered.length} con GPS · toca un nodo',
                style: const TextStyle(
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
        child: const Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.location_off_outlined,
              color: AppTheme.warning,
              size: 32,
            ),
            SizedBox(height: 10),
            Text(
              'Sin GPS fiable para estas paradas',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: AppTheme.textPrimary,
                fontWeight: FontWeight.w700,
              ),
            ),
            SizedBox(height: 6),
            Text(
              'Muchos clientes no tienen coordenadas o estaban en África por error y ya se filtran.\n\nPuedes ordenar manualmente o usar la propuesta por horarios (sin GPS).\nAvisa al comercial para dar de alta GPS correcto desde ficha cliente.',
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
    return ClipRRect(
      child: Transform(
        alignment: Alignment.center,
        transform: Matrix4.identity()
          ..setEntry(3, 2, 0.0012)
          ..rotateX(-0.55)
          ..rotateZ(-0.08),
        child: FlutterMap(
          mapController: _mapController,
          options: MapOptions(
            initialCenter: _center,
            initialZoom: points.length <= 1 ? 12 : 11,
            initialRotation: -8,
            minZoom: 5,
            maxZoom: 18,
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'com.gmp.mobilidad',
              maxZoom: 19,
            ),
            if (points.length >= 2)
              PolylineLayer(
                polylines: [
                  Polyline(
                    points: points,
                    strokeWidth: 4,
                    color: AppTheme.info.withValues(alpha: 0.85),
                  ),
                ],
              ),
            MarkerLayer(
              markers: [
                for (var i = 0; i < widget.ordered.length; i++)
                  if (_pointFor(widget.ordered[i]) != null)
                    Marker(
                      point: _pointFor(widget.ordered[i])!,
                      width: 48,
                      height: 48,
                      child: GestureDetector(
                        onTap: () =>
                            widget.onStopSelected?.call(widget.ordered[i].id),
                        child: _NumberedPin(
                          index: i + 1,
                          color: ruteroStopColor(i, widget.ordered.length),
                          selected:
                              widget.selectedDocumentId == widget.ordered[i].id,
                          isFirst: i == 0,
                          isLast: i == widget.ordered.length - 1 &&
                              widget.ordered.length > 1,
                        ),
                      ),
                    ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  LatLng? _pointFor(AlbaranEntrega albaran) {
    final meta = widget.metaByDocumentId[albaran.id] ??
        widget.metaByDocumentId[albaran.codigoCliente];
    if (!_isValidSpainLatLng(meta?.lat, meta?.lng)) return null;
    return LatLng(meta!.lat!, meta.lng!);
  }
}

class _RouteWhyCard extends StatelessWidget {
  const _RouteWhyCard({required this.explanation});

  final RuteroRouteExplanation explanation;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surfaceOverlay.withValues(alpha: 0.94),
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            const Row(
              children: [
                Icon(Icons.route, size: 18, color: AppColors.teal),
                SizedBox(width: 6),
                Text(
                  'Por qué esta ruta',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontWeight: FontWeight.w700,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              explanation.summary,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 11,
                height: 1.3,
              ),
            ),
            if (explanation.factors.isNotEmpty) ...[
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 4,
                children: explanation.factors.map((f) {
                  return Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                    decoration: BoxDecoration(
                      color: AppColors.softPanel,
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(color: AppColors.borderColor),
                    ),
                    child: Text(
                      f,
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  );
                }).toList(),
              ),
            ],
          ],
        ),
      ),
    );
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
        (albaran.horaPrevista != null ? 'Prev. ${albaran.horaPrevista}' : null);
    final eta = meta?.etaLabel;
    final prep = meta?.prepReadyLabel;
    final pickup = meta?.pickupLabel ?? meta?.departureLabel;
    final reason = meta?.reason;

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
                    border: Border.all(color: Colors.white, width: 2),
                  ),
                  child: Text(
                    index >= 0 ? '${index + 1}' : '·',
                    style: const TextStyle(
                      color: Colors.white,
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
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontWeight: FontWeight.w700,
                          fontSize: 14,
                        ),
                      ),
                      Text(
                        '${albaran.codigoCliente} · $_docTipo · $_docLabel'
                        '${albaran.esCTR ? ' · CTR' : ''}',
                        style: const TextStyle(
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
            if ((albaran.direccion).trim().isNotEmpty ||
                (albaran.poblacion).trim().isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                [
                  albaran.direccion.trim(),
                  albaran.poblacion.trim(),
                ].where((s) => s.isNotEmpty).join(' · '),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
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
                _chip(Icons.schedule, 'Deseada', desired ?? 'Sin horario'),
                _chip(Icons.navigation, 'ETA nuestra', eta ?? '—'),
                _chip(Icons.inventory_2_outlined, 'Prep. lista', prep ?? '—'),
                _chip(Icons.local_shipping_outlined, 'Recogida', pickup ?? '—'),
                _chip(Icons.payments_outlined, 'Pago', _pagoLabel),
                if (albaran.ordenPreparacion != null)
                  _chip(
                    Icons.tag,
                    'Orden prep.',
                    '#${albaran.ordenPreparacion}',
                  ),
                if (meta?.distanceKmFromPrev != null)
                  _chip(
                    Icons.straighten,
                    'Desde ant.',
                    '${meta!.distanceKmFromPrev!.toStringAsFixed(1)} km',
                  ),
              ],
            ),
            if (_isValidSpainLatLng(meta?.lat, meta?.lng)) ...[
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: () async {
                    final lat = meta!.lat!;
                    final lng = meta!.lng!;
                    final url = Uri.parse(
                        'https://www.google.com/maps/dir/?api=1&destination=$lat,$lng');
                    try {
                      await launchUrl(url,
                          mode: LaunchMode.externalApplication);
                    } catch (_) {}
                  },
                  icon: const Icon(Icons.navigation, size: 20),
                  label: const Text('Navegar con Maps',
                      style:
                          TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                  style: FilledButton.styleFrom(
                      minimumSize: Size.fromHeight(48),
                      backgroundColor: AppColors.info),
                ),
              ),
            ],
            if (reason != null && reason.trim().isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(
                reason,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: AppColors.textSecondary.withValues(alpha: 0.95),
                  fontSize: 11,
                  fontStyle: FontStyle.italic,
                  height: 1.3,
                ),
              ),
            ],
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
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 9,
                  fontWeight: FontWeight.w600,
                ),
              ),
              Text(
                value,
                style: const TextStyle(
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
        color: selected ? AppTheme.warning : color,
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 2),
        boxShadow: [
          if (isFirst)
            BoxShadow(
              color: AppColors.success.withValues(alpha: 0.55),
              blurRadius: 8,
              spreadRadius: 1,
            ),
          if (isLast)
            BoxShadow(
              color: const Color(0xFFF97316).withValues(alpha: 0.45),
              blurRadius: 8,
              spreadRadius: 1,
            ),
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.35),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Text(
        '$index',
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.bold,
          fontSize: 12,
        ),
      ),
    );
  }
}
