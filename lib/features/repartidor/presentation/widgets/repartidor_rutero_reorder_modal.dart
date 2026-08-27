import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/rutero_route_api.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_route_feedback.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_day_move_dialog.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_stop_status_badges.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_route_map_view.dart';

class RepartidorRuteroReorderModal extends StatefulWidget {
  const RepartidorRuteroReorderModal({
    required this.repartidorId,
    required this.date,
    required this.albaranes,
    super.key,
  });

  final String repartidorId;
  final DateTime date;
  final List<AlbaranEntrega> albaranes;

  @override
  State<RepartidorRuteroReorderModal> createState() =>
      _RepartidorRuteroReorderModalState();
}

class _RepartidorRuteroReorderModalState
    extends State<RepartidorRuteroReorderModal>
    with SingleTickerProviderStateMixin {
  late List<AlbaranEntrega> _ordered;
  late TabController _tabController;
  final Map<String, RuteroStopWindow> _metaByKey = {};
  RuteroRouteExplanation? _routeExplanation;
  bool _isSaving = false;
  bool _loadingOrder = true;
  bool _routeComplete = false;
  bool _isOptimizing = false;
  RuteroRouteStrategy _strategy = RuteroRouteStrategy.balanced;
  RuteroRouteOrigin? _origin;
  late int _departureMinute;
  String _revision = '';
  bool _loadingMeta = false;
  bool _isDirty = false;
  bool _isPolling = false;
  bool _remoteChangePending = false;
  String? _error;
  String? _info;
  String? _selectedDocumentId;
  final ScrollController _listScrollController = ScrollController();
  Timer? _refreshTimer;

  @override
  void initState() {
    super.initState();
    _ordered = List<AlbaranEntrega>.from(widget.albaranes);
    final now = TimeOfDay.now();
    _departureMinute = now.hour * 60 + now.minute;
    _tabController = TabController(length: 2, vsync: this);
    _initializeRoute();
    _refreshTimer = Timer.periodic(
      const Duration(seconds: 15),
      (_) => _pollOrderState(),
    );
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _tabController.dispose();
    _listScrollController.dispose();
    super.dispose();
  }

  String get _dateYmd => '${widget.date.year.toString().padLeft(4, '0')}-'
      '${widget.date.month.toString().padLeft(2, '0')}-'
      '${widget.date.day.toString().padLeft(2, '0')}';

  Future<void> _initializeRoute() async {
    setState(() {
      _loadingOrder = true;
      _routeComplete = false;
      _revision = '';
    });
    try {
      final documents = await RuteroRouteApi.fetchDayDocuments(
          repartidorId: widget.repartidorId, dateYmd: _dateYmd);
      final fullRoute = documents.map(AlbaranEntrega.fromJson).toList();
      if (!isCompleteDocumentPermutation(
          currentIds: fullRoute.map((a) => a.id),
          proposedIds: fullRoute.map((a) => a.id))) {
        throw ApiException('Duplicate route documents', statusCode: 422);
      }
      if (!mounted) return;
      setState(() {
        _ordered = fullRoute;
        _routeComplete = true;
      });
    } catch (error) {
      if (mounted)
        setState(() {
          _error = ruteroRouteError(error);
          _loadingOrder = false;
        });
      return;
    }
    await _reloadFromRemote(silent: true);
    if (mounted) await _loadStopMeta();
  }

  List<AlbaranEntrega> _mergePersistedOrder(Iterable<String> documentIds) {
    final pending = {for (final item in _ordered) item.id: item};
    final merged = <AlbaranEntrega>[];
    for (final id in documentIds) {
      final item = pending.remove(id);
      if (item != null) merged.add(item);
    }
    merged.addAll(pending.values);
    return merged;
  }

  Future<void> _reloadFromRemote({bool silent = false}) async {
    if (mounted) setState(() => _loadingOrder = true);
    try {
      final state = await RuteroRouteApi.fetchOrderState(
        repartidorId: widget.repartidorId,
        dateYmd: _dateYmd,
      );
      if (!mounted) return;
      setState(() {
        _ordered = _mergePersistedOrder(state.orden);
        _revision = state.revision;
        _isDirty = false;
        _remoteChangePending = false;
        _error = null;
        _clearTimeline();
        if (!silent) {
          _info = 'Se ha cargado el orden guardado. Puedes volver a ajustarlo.';
        }
      });
      _refreshLocalEtas();
    } catch (error) {
      if (mounted) {
        setState(() => _error = ruteroRouteError(error));
      }
    } finally {
      if (mounted) setState(() => _loadingOrder = false);
    }
  }

  Future<void> _pollOrderState() async {
    if (!_routeComplete ||
        _isPolling ||
        _isSaving ||
        _isOptimizing ||
        _loadingOrder ||
        !mounted) return;
    _isPolling = true;
    try {
      final state = await RuteroRouteApi.fetchOrderState(
        repartidorId: widget.repartidorId,
        dateYmd: _dateYmd,
      );
      if (!mounted ||
          _isSaving ||
          _isOptimizing ||
          _loadingOrder ||
          state.revision == _revision) return;
      if (_isDirty) {
        setState(() => _remoteChangePending = true);
      } else {
        setState(() {
          _ordered = _mergePersistedOrder(state.orden);
          _revision = state.revision;
          _info = 'El orden se ha actualizado desde otra sesión.';
        });
        _refreshLocalEtas();
        await _loadStopMeta();
      }
    } catch (_) {
      // Refresh must never interrupt a manual order.
    } finally {
      _isPolling = false;
    }
  }

  int get _gpsCoverage =>
      _ordered.where((albaran) => _metaFor(albaran)?.hasGps ?? false).length;

  String _friendlyError(Object error, {required String fallback}) {
    return ruteroRouteError(error);
  }

  Future<void> _useCurrentLocation() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        setState(
          () => _error =
              'Activa la ubicación del dispositivo para usarla como salida.',
        );
        return;
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        if (mounted) {
          setState(() => _error = 'No se concedió acceso a la ubicación.');
        }
        return;
      }
      final position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.medium,
        timeLimit: const Duration(seconds: 12),
      );
      if (mounted) {
        setState(() {
          _origin = RuteroRouteOrigin(
            lat: position.latitude,
            lng: position.longitude,
          );
          _info = 'La propuesta usará tu ubicación actual como salida.';
        });
      }
    } catch (_) {
      if (mounted) setState(() => _error = 'No se pudo obtener tu ubicación.');
    }
  }

  String get _departureLabel {
    final hour = (_departureMinute ~/ 60).toString().padLeft(2, '0');
    final minute = (_departureMinute % 60).toString().padLeft(2, '0');
    return '$hour:$minute';
  }

  Future<void> _pickDepartureTime() async {
    final selected = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(
        hour: _departureMinute ~/ 60,
        minute: _departureMinute % 60,
      ),
    );
    if (selected == null || !mounted) return;
    setState(() {
      _departureMinute = selected.hour * 60 + selected.minute;
      _info = 'La propuesta usará salida a las $_departureLabel.';
    });
  }

  RuteroStopWindow? _metaFor(AlbaranEntrega albaran) =>
      _metaByKey[albaran.id] ?? _metaByKey[albaran.codigoCliente];

  void _refreshLocalEtas() {
    final annotated = RuteroRouteApi.annotateEtasForOrder(
      ordered: _ordered
          .map(
            (a) => RuteroEtaStopRef(
              id: a.id,
              codigoCliente: a.codigoCliente,
              nombreCliente: a.nombreCliente,
            ),
          )
          .toList(growable: false),
      metaByKey: _metaByKey,
    );
    _metaByKey
      ..clear()
      ..addAll(annotated);
  }

  Future<void> _loadStopMeta() async {
    setState(() {
      _loadingMeta = true;
    });
    try {
      final clientes = _ordered
          .map((a) => a.codigoCliente.trim())
          .where((c) => c.isNotEmpty)
          .toSet()
          .toList(growable: false);
      final stops = await RuteroRouteApi.fetchStopsGeo(
        repartidorId: widget.repartidorId,
        dateYmd: _dateYmd,
        clientes: clientes,
      );
      if (!mounted) return;
      setState(() {
        _metaByKey
          ..clear()
          ..addEntries(
            stops.expand((s) {
              final entries = <MapEntry<String, RuteroStopWindow>>[];
              if (s.documentId.isNotEmpty) {
                entries.add(
                    MapEntry(s.documentId, s.copyWith(clearTimeline: true)));
              }
              if (s.cliente.isNotEmpty) {
                entries
                    .add(MapEntry(s.cliente, s.copyWith(clearTimeline: true)));
              }
              return entries;
            }),
          );
        _refreshLocalEtas();
        _loadingMeta = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadingMeta = false;
        // Meta is optional — list reorder still works.
        _info =
            'No se pudieron cargar las ubicaciones y horarios. Puedes cambiar el orden en la lista.';
      });
    }
  }

  Future<void> _applyOptimalOrder() async {
    if (_ordered.isEmpty || _isOptimizing) return;
    setState(() {
      _isOptimizing = true;
      _error = null;
      _info = null;
    });
    await HapticFeedback.selectionClick();
    try {
      final result = await RuteroRouteApi.optimizeOrder(
        repartidorId: widget.repartidorId,
        dateYmd: _dateYmd,
        stops: _ordered
            .map(
              (a) => <String, dynamic>{
                'documentId': a.id,
                'cliente': a.codigoCliente,
              },
            )
            .toList(growable: false),
        strategy: _strategy,
        origin: _origin,
        departureMinute: _departureMinute,
      );
      if (!isCompleteDocumentPermutation(
        currentIds: _ordered.map((albaran) => albaran.id),
        proposedIds: result.orden.map((stop) => stop.documentId),
      )) {
        if (mounted) {
          setState(() {
            _isOptimizing = false;
            _error =
                'La propuesta recibida está incompleta. El orden actual no se ha modificado.';
          });
        }
        return;
      }

      final byId = {for (final a in _ordered) a.id: a};
      final next = <AlbaranEntrega>[];
      for (final stop in result.orden) {
        final match = byId.remove(stop.documentId);
        if (match != null) next.add(match);
        if (stop.documentId.isNotEmpty) {
          _metaByKey[stop.documentId] = stop;
        }
        if (stop.cliente.isNotEmpty) {
          _metaByKey[stop.cliente] = stop;
        }
      }
      next.addAll(byId.values);

      if (!mounted) return;
      final expl = result.explanation;
      final end = expl?.estimatedEndLabel;
      final km = expl?.estimatedKm;
      setState(() {
        _ordered = next;
        _routeExplanation = expl;
        _isOptimizing = false;
        _isDirty = true;
        final departure = result.departureLabel ?? expl?.departureLabel;
        _info = 'Propuesta calculada'
            '${departure != null ? ' · salida $departure' : ''}'
            '${end != null ? ' · fin ~$end' : ''}'
            '${km != null ? ' · ~${km.toStringAsFixed(0)} km' : ''}. '
            'Puedes ajustar las posiciones en Lista. Pulsa Guardar para conservarlas.';
      });
      if (_tabController.index != 1) {
        _tabController.animateTo(1);
      }
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _isOptimizing = false;
        _error = _friendlyError(
          error,
          fallback: 'No se pudo calcular la propuesta de ruta.',
        );
      });
    }
  }

  Future<void> _saveOrder() async {
    if (!_routeComplete ||
        _isSaving ||
        _isOptimizing ||
        _loadingOrder ||
        _remoteChangePending) return;
    setState(() {
      _isSaving = true;
      _error = null;
    });
    try {
      if (_revision.isEmpty) {
        throw ApiException('Revision required',
            statusCode: 422, code: 'RUTERO_ORDER_REVISION_REQUIRED');
      }

      final orden = _ordered.asMap().entries.map((entry) {
        return {
          'documentId': entry.value.id,
          'cliente': entry.value.codigoCliente,
          'posicion': entry.key,
        };
      }).toList();

      await RuteroRouteApi.saveOrder(
        repartidorId: widget.repartidorId,
        dateYmd: _dateYmd,
        baseRevision: _revision,
        orden: orden,
      );

      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = _friendlyError(
            error,
            fallback: 'No se pudo guardar el orden de ruta.',
          );
          if (error is ApiException && error.statusCode == 409) {
            _remoteChangePending = true;
          }
          _isSaving = false;
        });
      }
    }
  }

  void _onReorder(int oldIndex, int newIndex) {
    if (_isSaving || _isOptimizing || _loadingOrder) return;
    setState(() {
      if (oldIndex < newIndex) newIndex -= 1;
      final item = _ordered.removeAt(oldIndex);
      _ordered.insert(newIndex, item);
      _clearTimeline();
      _refreshLocalEtas();
      _isDirty = true;
      _info =
          'Orden pendiente de guardar. Las horas se recalculan al aplicar una nueva propuesta.';
    });
  }

  void _clearTimeline() {
    _routeExplanation = null;
    _metaByKey.updateAll((key, value) => value.copyWith(clearTimeline: true));
  }

  Future<void> _changePosition(int index) async {
    final target = await showDialog<int>(
        context: context,
        builder: (ctx) => SimpleDialog(
              title: const Text('Elegir posición'),
              children: [
                for (var i = 0; i < _ordered.length; i++)
                  SimpleDialogOption(
                    onPressed: () => Navigator.pop(ctx, i),
                    child: Text('Parada ${i + 1}'),
                  )
              ],
            ));
    if (target != null && mounted)
      _onReorder(index, target > index ? target + 1 : target);
  }

  Future<void> _moveDay(AlbaranEntrega stop, {bool wholeClient = false}) async {
    final moved = await showDialog<bool>(
        context: context,
        builder: (_) => RuteroDayMoveDialog(
              date: widget.date,
              repartidorId: widget.repartidorId,
              stops: wholeClient
                  ? _ordered
                      .where((a) => a.codigoCliente == stop.codigoCliente)
                      .toList()
                  : [stop],
            ));
    if (moved == true && mounted) Navigator.of(context).pop(true);
  }

  void _selectStop(String documentId) {
    if (documentId.isEmpty) {
      setState(() => _selectedDocumentId = null);
      return;
    }
    setState(() => _selectedDocumentId = documentId);
    final index = _ordered.indexWhere((a) => a.id == documentId);
    if (index >= 0 && _listScrollController.hasClients) {
      _listScrollController.animateTo(
        (index * 76.0).clamp(0, _listScrollController.position.maxScrollExtent),
        duration: const Duration(milliseconds: 280),
        curve: Curves.easeOutCubic,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.inkSurface,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text(
          'Ordenar ruta del día',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        actions: [
          if (_isSaving)
            const Center(
              child: Padding(
                padding: EdgeInsets.only(right: 16),
                child: SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: AppTheme.info,
                  ),
                ),
              ),
            )
          else
            TextButton.icon(
              onPressed: !_routeComplete ||
                      _ordered.isEmpty ||
                      _revision.isEmpty ||
                      _loadingOrder ||
                      _isOptimizing ||
                      _remoteChangePending
                  ? null
                  : _saveOrder,
              icon: const Icon(Icons.save, color: AppTheme.info),
              label: const Text(
                'Guardar',
                style: TextStyle(
                  color: AppTheme.info,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
        ],
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: AppTheme.info,
          labelColor: AppTheme.textPrimary,
          unselectedLabelColor: AppTheme.textSecondary,
          tabs: const [
            Tab(text: 'Lista'),
            Tab(text: 'Mapa'),
          ],
        ),
      ),
      body: Column(
        children: [
          _buildToolbar(),
          if (_loadingOrder) const LinearProgressIndicator(),
          if (_error != null || _revision.isEmpty)
            TextButton.icon(
                onPressed: _isSaving || _loadingOrder ? null : _initializeRoute,
                icon: const Icon(Icons.refresh),
                label: const Text('Recargar orden guardado')),
          if (_error != null)
            _banner(
              _error!,
              AppTheme.error.withValues(alpha: 0.12),
              AppTheme.error,
            ),
          if (_info != null)
            _banner(
              _info!,
              AppTheme.info.withValues(alpha: 0.12),
              AppTheme.info,
            ),
          if (_remoteChangePending) _buildRemoteChangeBanner(),
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                _buildList(),
                RuteroRouteMapView(
                  ordered: _ordered,
                  metaByDocumentId: _metaByKey,
                  selectedDocumentId: _selectedDocumentId,
                  onStopSelected: _selectStop,
                  routeExplanation: _routeExplanation,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildToolbar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Para cambiar el orden, usa el menú de cada parada y elige su posición. También puedes arrastrar el icono de líneas. Después pulsa Guardar. · $_dateYmd',
                  style: const TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 13,
                  ),
                ),
              ),
              if (_loadingMeta)
                const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
            ],
          ),
          const SizedBox(height: 8),
          const SizedBox(height: 4),
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              'Ubicación disponible: $_gpsCoverage/${_ordered.length}. Las paradas sin ubicación siguen en la lista, pero no se dibujan en el mapa.',
              style: const TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 11,
              ),
            ),
          ),
          ExpansionTile(
            title: const Text('Propuesta de ruta'),
            children: [
              const Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Criterio de propuesta',
                  style: TextStyle(color: AppTheme.textSecondary, fontSize: 11),
                ),
              ),
              const SizedBox(height: 4),
              SegmentedButton<RuteroRouteStrategy>(
                segments: RuteroRouteStrategy.values
                    .map(
                      (strategy) => ButtonSegment<RuteroRouteStrategy>(
                        value: strategy,
                        label: Text(strategy.label),
                      ),
                    )
                    .toList(growable: false),
                selected: {_strategy},
                showSelectedIcon: false,
                style: const ButtonStyle(visualDensity: VisualDensity.compact),
                onSelectionChanged: (selected) {
                  setState(() => _strategy = selected.single);
                },
              ),
              const SizedBox(height: 6),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  OutlinedButton.icon(
                    onPressed: _useCurrentLocation,
                    icon: Icon(
                      _origin == null
                          ? Icons.my_location_outlined
                          : Icons.my_location,
                      size: 16,
                    ),
                    label: Text(
                      _origin == null
                          ? 'Usar mi ubicación actual'
                          : 'Salida: ubicación actual',
                    ),
                  ),
                  OutlinedButton.icon(
                    onPressed: _pickDepartureTime,
                    icon: const Icon(Icons.schedule_outlined, size: 16),
                    label: Text('Salida $_departureLabel'),
                  ),
                  FilledButton.tonalIcon(
                    onPressed: _isSaving ||
                            _loadingOrder ||
                            _isOptimizing ||
                            _ordered.isEmpty
                        ? null
                        : _applyOptimalOrder,
                    icon: _isOptimizing
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.auto_awesome, size: 18),
                    label: const Text('Aplicar propuesta'),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _banner(String text, Color bg, Color fg) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Semantics(
          liveRegion: true,
          child: Text(text, style: TextStyle(color: fg, fontSize: 13))),
    );
  }

  Widget _buildRemoteChangeBanner() {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
      decoration: BoxDecoration(
        color: AppTheme.warning.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          const Expanded(
            child: Text(
              'Otro usuario guardó cambios. Recarga antes de guardar los tuyos.',
              style: TextStyle(color: AppTheme.warning, fontSize: 12),
            ),
          ),
          TextButton(
            onPressed: _isSaving || _loadingOrder ? null : _initializeRoute,
            child: const Text('Recargar'),
          ),
        ],
      ),
    );
  }

  Widget _buildList() {
    if (_ordered.isEmpty) {
      return const Center(
        child: Text(
          'No hay albaranes para ordenar',
          style: TextStyle(color: AppTheme.textSecondary),
        ),
      );
    }
    return ReorderableListView.builder(
      buildDefaultDragHandles: false,
      scrollController: _listScrollController,
      itemCount: _ordered.length,
      onReorder: _onReorder,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      itemBuilder: (context, index) {
        final a = _ordered[index];
        final meta = _metaFor(a);
        final docLabel = a.numeroFactura > 0
            ? 'Fac ${a.numeroFactura}'
            : 'Alb ${a.numeroAlbaran}';
        final selected = _selectedDocumentId == a.id;
        final window = meta?.windowLabel;
        final obs = meta?.observacionesSnippet ?? '';
        final closed = meta?.closedDay ?? false;
        final missingGps = meta == null || !meta.hasGps;
        final seqColor = ruteroStopColor(index, _ordered.length);
        final eta = meta?.etaLabel;

        return Material(
          key: ValueKey(a.id),
          color: selected
              ? AppTheme.info.withValues(alpha: 0.12)
              : Colors.transparent,
          child: ListTile(
            onTap: () => _selectStop(a.id),
            leading: CircleAvatar(
              radius: 20,
              backgroundColor: closed
                  ? AppTheme.warning.withValues(alpha: 0.25)
                  : seqColor.withValues(alpha: 0.22),
              child: Text(
                '${index + 1}',
                style: TextStyle(
                  fontSize: 14,
                  color: closed ? AppTheme.warning : seqColor,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
            title: Text(
              a.nombreCliente,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppTheme.textPrimary,
                fontWeight: FontWeight.w600,
              ),
            ),
            subtitle: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${a.codigoCliente} · $docLabel'
                  '${eta != null ? ' · Llegada estimada $eta' : ''}'
                  '${window != null ? ' · $window' : ''}'
                  '${closed ? ' · cerrado hoy' : ''}'
                  '${missingGps ? ' · sin ubicación' : ''}',
                  style: const TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 12,
                  ),
                ),
                RuteroStopStatusBadges(albaran: a),
                if (obs.isNotEmpty)
                  Text(
                    obs,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: AppTheme.textSecondary.withValues(alpha: 0.9),
                      fontSize: 14,
                      fontStyle: FontStyle.italic,
                    ),
                  ),
              ],
            ),
            isThreeLine: obs.isNotEmpty,
            trailing: Row(mainAxisSize: MainAxisSize.min, children: [
              PopupMenuButton<String>(
                tooltip: 'Opciones de la parada ${index + 1}',
                enabled: !_isSaving && !_isOptimizing && !_loadingOrder,
                onSelected: (value) {
                  if (value == 'position') _changePosition(index);
                  if (value == 'day') _moveDay(a);
                  if (value == 'client') _moveDay(a, wholeClient: true);
                },
                itemBuilder: (_) => const [
                  PopupMenuItem(
                      value: 'position', child: Text('Cambiar posición')),
                  PopupMenuItem(
                      value: 'day', child: Text('Cambiar esta parada de día')),
                  PopupMenuItem(
                      value: 'client', child: Text('Cambiar cliente de día')),
                ],
              ),
              ReorderableDragStartListener(
                  index: index,
                  enabled: !_isSaving && !_isOptimizing && !_loadingOrder,
                  child: const SizedBox(
                      width: 48,
                      height: 48,
                      child: Icon(Icons.drag_handle,
                          color: AppTheme.textSecondary, size: 28))),
            ]),
          ),
        );
      },
    );
  }
}
