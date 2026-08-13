import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/rutero_route_api.dart';
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
  bool _isSaving = false;
  bool _isOptimizing = false;
  bool _ordenOptimoEnabled = true;
  bool _loadingMeta = false;
  String? _error;
  String? _info;
  String? _selectedDocumentId;
  final ScrollController _listScrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _ordered = List<AlbaranEntrega>.from(widget.albaranes);
    _tabController = TabController(length: 2, vsync: this);
    _loadStopMeta();
  }

  @override
  void dispose() {
    _tabController.dispose();
    _listScrollController.dispose();
    super.dispose();
  }

  String get _dateYmd => '${widget.date.year.toString().padLeft(4, '0')}-'
      '${widget.date.month.toString().padLeft(2, '0')}-'
      '${widget.date.day.toString().padLeft(2, '0')}';

  RuteroStopWindow? _metaFor(AlbaranEntrega albaran) =>
      _metaByKey[albaran.id] ?? _metaByKey[albaran.codigoCliente];

  Future<void> _loadStopMeta() async {
    setState(() {
      _loadingMeta = true;
      _error = null;
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
          ..addEntries(stops.expand((s) {
            final entries = <MapEntry<String, RuteroStopWindow>>[];
            if (s.documentId.isNotEmpty) {
              entries.add(MapEntry(s.documentId, s));
            }
            if (s.cliente.isNotEmpty) {
              entries.add(MapEntry(s.cliente, s));
            }
            return entries;
          }));
        _loadingMeta = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadingMeta = false;
        // Meta is optional — list reorder still works.
        _info =
            'Horarios/GPS no disponibles ahora. Puedes reordenar manualmente.';
      });
    }
  }

  Future<void> _applyOptimalOrder() async {
    if (!_ordenOptimoEnabled || _ordered.isEmpty || _isOptimizing) return;
    setState(() {
      _isOptimizing = true;
      _error = null;
      _info = null;
    });
    HapticFeedback.selectionClick();
    try {
      final suggested = await RuteroRouteApi.optimizeOrder(
        repartidorId: widget.repartidorId,
        dateYmd: _dateYmd,
        stops: _ordered
            .map((a) => <String, dynamic>{
                  'documentId': a.id,
                  'cliente': a.codigoCliente,
                })
            .toList(growable: false),
      );

      final byId = {for (final a in _ordered) a.id: a};
      final next = <AlbaranEntrega>[];
      for (final stop in suggested) {
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
      setState(() {
        _ordered = next;
        _isOptimizing = false;
        _info =
            'Orden óptimo aplicado (temprano→tarde). Puedes seguir arrastrando.';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isOptimizing = false;
        _error = 'No se pudo calcular el orden óptimo: $e';
      });
    }
  }

  Future<void> _saveOrder() async {
    setState(() {
      _isSaving = true;
      _error = null;
    });
    try {
      final orden = _ordered.asMap().entries.map((entry) {
        return {
          'documentId': entry.value.id,
          'cliente': entry.value.codigoCliente,
          'posicion': entry.key,
        };
      }).toList();

      await ApiClient.put(
        '/repartidor/rutero/order/${widget.repartidorId}',
        data: {
          'date': _dateYmd,
          'orden': orden,
        },
      );

      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'Error al guardar: $e';
          _isSaving = false;
        });
      }
    }
  }

  void _onReorder(int oldIndex, int newIndex) {
    setState(() {
      if (oldIndex < newIndex) newIndex -= 1;
      final item = _ordered.removeAt(oldIndex);
      _ordered.insert(newIndex, item);
      _info = 'Orden manual activo';
    });
  }

  void _selectStop(String documentId) {
    setState(() => _selectedDocumentId = documentId);
    final index = _ordered.indexWhere((a) => a.id == documentId);
    if (index >= 0 && _listScrollController.hasClients) {
      _listScrollController.animateTo(
        (index * 76.0).clamp(0, _listScrollController.position.maxScrollExtent),
        duration: const Duration(milliseconds: 280),
        curve: Curves.easeOutCubic,
      );
    }
    if (_tabController.index != 0) {
      // Keep map visible; list highlight still scrolls under tab 0 when switched.
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
              onPressed: _ordered.isEmpty ? null : _saveOrder,
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
            Tab(text: 'Mapa 3D'),
          ],
        ),
      ),
      body: Column(
        children: [
          _buildToolbar(),
          if (_error != null)
            _banner(_error!, AppTheme.error.withValues(alpha: 0.12),
                AppTheme.error),
          if (_info != null)
            _banner(
                _info!, AppTheme.info.withValues(alpha: 0.12), AppTheme.info),
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
                  'Arrastra libremente · $_dateYmd',
                  style: const TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 12,
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
          Row(
            children: [
              Expanded(
                child: SwitchListTile.adaptive(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: const Text(
                    'Orden óptimo',
                    style: TextStyle(
                      color: AppTheme.textPrimary,
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                    ),
                  ),
                  subtitle: const Text(
                    'Para conductores nuevos · por ventana de entrega',
                    style: TextStyle(
                      color: AppTheme.textSecondary,
                      fontSize: 11,
                    ),
                  ),
                  value: _ordenOptimoEnabled,
                  activeThumbColor: AppTheme.info,
                  onChanged: (value) =>
                      setState(() => _ordenOptimoEnabled = value),
                ),
              ),
              const SizedBox(width: 8),
              FilledButton.tonalIcon(
                onPressed:
                    !_ordenOptimoEnabled || _isOptimizing || _ordered.isEmpty
                        ? null
                        : _applyOptimalOrder,
                icon: _isOptimizing
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.auto_awesome, size: 18),
                label: const Text('Aplicar'),
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
      child: Text(text, style: TextStyle(color: fg, fontSize: 13)),
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
        final closed = meta?.closedDay == true;
        final missingGps = meta == null || !meta.hasGps;

        return Material(
          key: ValueKey(a.id),
          color: selected
              ? AppTheme.info.withValues(alpha: 0.12)
              : Colors.transparent,
          child: ListTile(
            onTap: () => _selectStop(a.id),
            leading: CircleAvatar(
              radius: 14,
              backgroundColor: closed
                  ? AppTheme.warning.withValues(alpha: 0.25)
                  : AppTheme.info.withValues(alpha: 0.2),
              child: Text(
                '${index + 1}',
                style: TextStyle(
                  fontSize: 11,
                  color: closed ? AppTheme.warning : AppTheme.info,
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
                  '${window != null ? ' · $window' : ''}'
                  '${closed ? ' · cerrado hoy' : ''}'
                  '${missingGps ? ' · sin GPS' : ''}',
                  style: const TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 12,
                  ),
                ),
                if (obs.isNotEmpty)
                  Text(
                    obs,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: AppTheme.textSecondary.withValues(alpha: 0.9),
                      fontSize: 11,
                      fontStyle: FontStyle.italic,
                    ),
                  ),
              ],
            ),
            isThreeLine: obs.isNotEmpty,
            trailing: const Icon(
              Icons.drag_handle,
              color: AppTheme.textSecondary,
            ),
          ),
        );
      },
    );
  }
}
