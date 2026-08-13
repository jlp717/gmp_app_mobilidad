import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/rutero_route_api.dart';
import 'package:latlong2/latlong.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// 3D MapLibre (OSM tiles, no Mapbox token) with flutter_map 2.5D fallback.
///
/// Fallback uses CSS-like perspective Transform + map rotation to simulate pitch
/// when WebView/MapLibre CDN is unavailable.
class RuteroRouteMapView extends StatefulWidget {
  const RuteroRouteMapView({
    required this.ordered,
    required this.metaByDocumentId,
    this.selectedDocumentId,
    this.onStopSelected,
    super.key,
  });

  final List<AlbaranEntrega> ordered;
  final Map<String, RuteroStopWindow> metaByDocumentId;
  final String? selectedDocumentId;
  final ValueChanged<String>? onStopSelected;

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
        ..setOnWebResourceError((error) {
          debugPrint('[RuteroMap] web error: ${error.description}');
          if (mounted) {
            setState(() {
              _useFallback = true;
              _loadingHtml = false;
            });
          }
        })
        ..loadHtmlString(html, baseUrl: 'https://local.rutero.map/');

      if (!mounted) return;
      setState(() {
        _controller = controller;
      });

      // Safety: if MapLibre CDN never answers, fall back.
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
        'lat': meta?.lat,
        'lng': meta?.lng,
        'windowLabel': meta?.windowLabel,
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
    if (points.isEmpty) return const LatLng(36.8340, -2.4637);
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
      if (meta?.lat != null && meta?.lng != null) {
        points.add(LatLng(meta!.lat!, meta.lng!));
      }
    }
    return points;
  }

  @override
  Widget build(BuildContext context) {
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
                  ? 'Mapa 2.5D OSM · sin token Mapbox'
                  : 'MapLibre 3D · tiles OSM gratis',
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
            initialRotation: -12,
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
                      width: 34,
                      height: 34,
                      child: GestureDetector(
                        onTap: () =>
                            widget.onStopSelected?.call(widget.ordered[i].id),
                        child: _NumberedPin(
                          index: i + 1,
                          selected:
                              widget.selectedDocumentId == widget.ordered[i].id,
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
    if (meta?.lat == null || meta?.lng == null) return null;
    return LatLng(meta!.lat!, meta.lng!);
  }
}

class _NumberedPin extends StatelessWidget {
  const _NumberedPin({required this.index, required this.selected});

  final int index;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    return Container(
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: selected ? AppTheme.warning : AppTheme.info,
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 2),
        boxShadow: [
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
