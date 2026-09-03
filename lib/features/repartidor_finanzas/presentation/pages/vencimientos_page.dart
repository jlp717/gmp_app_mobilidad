// ignore_for_file: public_member_api_docs

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_executive_ui.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/finance_error_message.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/providers/repartidor_finanzas_providers.dart';
import 'package:intl/intl.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

enum VencimientoEstado {
  vencido,
  hoy,
  proximo,
  sinFecha,
  cobrado,
}

class VencimientoItem {
  const VencimientoItem({
    required this.cliente,
    required this.documento,
    required this.fecha,
    required this.importe,
    required this.estado,
    this.id,
    this.vendedor,
    this.notas,
    this.codigoCliente = '',
    this.nombreCliente = '',
    this.tipoDocumento = '',
    this.importePendiente = 0,
    this.keys = const {},
  });

  final String? id;
  final String cliente;
  final String documento;
  final DateTime? fecha;
  final double importe;
  final VencimientoEstado estado;
  final String? vendedor;
  final String? notas;
  final String codigoCliente;
  final String nombreCliente;
  final String tipoDocumento;
  final double importePendiente;
  final JsonMap keys;
}

enum VencimientosFiltro {
  todos,
  pendientes,
  vencidos,
  cobrados,
  hoy,
  proximos,
}

String documentTypeLabel(String tipoDocumento) {
  return switch (tipoDocumento.trim().toUpperCase()) {
    'CAC' => 'ALBARÁN',
    'COC' => 'FACTURA',
    'DEV' => 'DEVOLUCIÓN',
    final value when value.isNotEmpty => value,
    _ => 'DOCUMENTO',
  };
}

bool canCobrarVencimiento(VencimientoItem item, String repartidorId) {
  return !repartidorId.contains(',') &&
      item.documento.trim().isNotEmpty &&
      item.tipoDocumento.trim().isNotEmpty &&
      item.keys.isNotEmpty &&
      item.importePendiente > 0;
}

List<VencimientoItem> filterVencimientosBySearch(
  Iterable<VencimientoItem> items,
  String query,
) {
  final normalized = query.trim().toLowerCase();
  if (normalized.isEmpty) return items.toList();
  return items.where((item) {
    return item.cliente.toLowerCase().contains(normalized) ||
        item.codigoCliente.toLowerCase().contains(normalized) ||
        item.nombreCliente.toLowerCase().contains(normalized) ||
        item.documento.toLowerCase().contains(normalized);
  }).toList();
}

class VencimientosPage extends StatefulWidget {
  const VencimientosPage({
    super.key,
    this.title = 'Cobros',
    this.vencimientos = const [],
    this.initialFiltro = VencimientosFiltro.todos,
    this.initialTipoDocumento,
    this.onFiltroChanged,
    this.onTipoDocumentoChanged,
    this.onSearchSubmitted,
    this.onItemTap,
    this.total,
    this.hasMore = false,
    this.isLoadingMore = false,
    this.onLoadMore,
  });

  final String title;
  final List<VencimientoItem> vencimientos;
  final VencimientosFiltro initialFiltro;
  final String? initialTipoDocumento;
  final ValueChanged<VencimientosFiltro>? onFiltroChanged;
  final ValueChanged<String?>? onTipoDocumentoChanged;
  final ValueChanged<String>? onSearchSubmitted;
  final ValueChanged<VencimientoItem>? onItemTap;
  final int? total;
  final bool hasMore;
  final bool isLoadingMore;
  final VoidCallback? onLoadMore;

  @override
  State<VencimientosPage> createState() => _VencimientosPageState();
}

class _VencimientosPageState extends State<VencimientosPage> {
  late VencimientosFiltro _filtro = widget.initialFiltro;
  late String? _tipoDocumento = widget.initialTipoDocumento;
  String _searchQuery = '';

  @override
  Widget build(BuildContext context) {
    final visible = _filteredItems();
    final groups = _groupItems(visible);
    // Flat typed row specs so ListView.builder only creates widget configs
    // for the visible rows (virtualized grouped list).
    final rowSpecs = <_VencimientoRowSpec>[
      for (final entry in groups.entries) ...[
        _GroupHeaderSpec(
          entry.key,
          entry.value.length,
          _total(entry.value),
        ),
        for (final item in entry.value) _VencimientoItemSpec(item),
      ],
      if (widget.hasMore) const _LoadMoreSpec(),
    ];

    return Scaffold(
      backgroundColor: AppTheme.inkSurface,
      body: Column(
        children: [
          _FinanceHeader(
            icon: Icons.event_available,
            title: widget.title,
            subtitle:
                '${visible.length} documentos - ${_money(_total(visible))}',
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
            child: TextField(
              onChanged: (value) => setState(() => _searchQuery = value),
              onSubmitted: widget.onSearchSubmitted,
              textInputAction: TextInputAction.search,
              style: TextStyle(color: AppTheme.textPrimary),
              decoration: const InputDecoration(
                labelText: 'Buscar cliente, albarán o factura',
                prefixIcon: Icon(Icons.search),
                isDense: true,
              ),
            ),
          ),
          _FilterStrip(
            selected: _filtro,
            onSelected: (filtro) {
              setState(() => _filtro = filtro);
              widget.onFiltroChanged?.call(filtro);
            },
          ),
          _DocumentTypeFilter(
            selected: _tipoDocumento,
            onSelected: (tipoDocumento) {
              setState(() => _tipoDocumento = tipoDocumento);
              widget.onTipoDocumentoChanged?.call(tipoDocumento);
            },
          ),
          Expanded(
            child: visible.isEmpty && !widget.hasMore
                ? const _EmptyState(
                    message: 'No hay cobros pendientes para el filtro',
                  )
                : ListView.builder(
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 16),
                    itemCount: rowSpecs.length,
                    itemBuilder: (context, index) {
                      final spec = rowSpecs[index];
                      return switch (spec) {
                        _GroupHeaderSpec(
                          :final title,
                          :final count,
                          :final amount,
                        ) =>
                          Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: _GroupHeader(
                              title: title,
                              count: count,
                              amount: amount,
                            ),
                          ),
                        _VencimientoItemSpec(:final item) => Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: _VencimientoRow(
                              item: item,
                              onTap: widget.onItemTap == null
                                  ? null
                                  : () => widget.onItemTap?.call(item),
                            ),
                          ),
                        _LoadMoreSpec() => Center(
                            child: widget.isLoadingMore
                                ? const Padding(
                                    padding: EdgeInsets.all(12),
                                    child: CircularProgressIndicator(),
                                  )
                                : OutlinedButton.icon(
                                    onPressed: widget.onLoadMore,
                                    icon: const Icon(Icons.expand_more),
                                    label: const Text('Cargar más'),
                                  ),
                          ),
                      };
                    },
                  ),
          ),
        ],
      ),
    );
  }

  List<VencimientoItem> _filteredItems() {
    final byEstado = widget.vencimientos.where((item) {
      return switch (_filtro) {
        VencimientosFiltro.todos => true,
        VencimientosFiltro.pendientes =>
          item.importePendiente > 0 && item.estado != VencimientoEstado.vencido,
        VencimientosFiltro.vencidos => item.estado == VencimientoEstado.vencido,
        VencimientosFiltro.cobrados => item.estado == VencimientoEstado.cobrado,
        VencimientosFiltro.hoy => item.estado == VencimientoEstado.hoy,
        VencimientosFiltro.proximos => item.estado == VencimientoEstado.proximo,
      };
    });
    final byTipo = byEstado.where(
      (item) => _tipoDocumento == null || item.tipoDocumento == _tipoDocumento,
    );
    return filterVencimientosBySearch(byTipo, _searchQuery)
      ..sort((a, b) {
        if (a.fecha == null) return b.fecha == null ? 0 : 1;
        if (b.fecha == null) return -1;
        return a.fecha!.compareTo(b.fecha!);
      });
  }

  Map<String, List<VencimientoItem>> _groupItems(List<VencimientoItem> items) {
    final grouped = <String, List<VencimientoItem>>{};
    for (final item in items) {
      final key = switch (item.estado) {
        VencimientoEstado.vencido => 'Vencidos',
        VencimientoEstado.hoy => 'Vencen hoy',
        VencimientoEstado.proximo => 'Proximos',
        VencimientoEstado.sinFecha => 'Sin fecha válida',
        VencimientoEstado.cobrado => 'Cobrados',
      };
      grouped.putIfAbsent(key, () => []).add(item);
    }
    return grouped;
  }
}

class RepartidorVencimientosPage extends ConsumerStatefulWidget {
  const RepartidorVencimientosPage({
    required this.repartidorId,
    super.key,
    this.title = 'Cobros',
  });

  final String repartidorId;
  final String title;

  @override
  ConsumerState<RepartidorVencimientosPage> createState() =>
      _RepartidorVencimientosPageState();
}

class RepartidorCobrosPage extends RepartidorVencimientosPage {
  const RepartidorCobrosPage({
    required super.repartidorId,
    super.key,
  }) : super(title: 'Cobros');
}

class _RepartidorVencimientosPageState
    extends ConsumerState<RepartidorVencimientosPage> {
  static const _pageSize = 100;

  final List<RepartidorVencimiento> _items = [];
  late DateTime _from;
  late DateTime _to;
  String? _nextCursor;
  String _serverSearch = '';
  VencimientosFiltro _filtro = VencimientosFiltro.todos;
  String? _estado;
  String? _tipoDocumento;
  Object? _error;
  int _total = 0;
  int _generation = 0;
  bool _isLoading = true;
  bool _isLoadingMore = false;

  @override
  void initState() {
    super.initState();
    _setDefaultRange();
    Future<void>.microtask(_loadFirstPage);
  }

  @override
  void didUpdateWidget(covariant RepartidorVencimientosPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.repartidorId != widget.repartidorId) {
      _loadFirstPage(forceRefresh: true);
    }
  }

  void _setDefaultRange() {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    _from = today.subtract(const Duration(days: 180));
    _to = today.add(const Duration(days: 180));
  }

  Future<void> _loadFirstPage({bool forceRefresh = false}) {
    return _loadPage(reset: true, forceRefresh: forceRefresh);
  }

  Future<void> _loadMore() {
    if (_nextCursor == null || _isLoadingMore) return Future<void>.value();
    return _loadPage(reset: false);
  }

  void _submitSearch(String value) {
    final normalized = value.trim();
    if (_serverSearch == normalized) {
      _loadFirstPage(forceRefresh: true);
      return;
    }
    setState(() => _serverSearch = normalized);
    _loadFirstPage(forceRefresh: true);
  }

  void _changeFiltro(VencimientosFiltro filtro) {
    final estado = switch (filtro) {
      VencimientosFiltro.vencidos => 'vencido',
      VencimientosFiltro.pendientes => 'pendiente',
      VencimientosFiltro.cobrados => 'cobrado',
      _ => null,
    };
    final serverFilterChanged = _estado != estado;
    setState(() {
      _filtro = filtro;
      _estado = estado;
    });
    if (serverFilterChanged) {
      _loadFirstPage(forceRefresh: true);
    }
  }

  void _changeTipoDocumento(String? tipoDocumento) {
    if (_tipoDocumento == tipoDocumento) return;
    setState(() => _tipoDocumento = tipoDocumento);
    _loadFirstPage(forceRefresh: true);
  }

  Future<void> _loadPage({
    required bool reset,
    bool forceRefresh = false,
  }) async {
    if (widget.repartidorId.isEmpty) {
      if (mounted) setState(() => _isLoading = false);
      return;
    }
    final generation = reset ? ++_generation : _generation;
    setState(() {
      if (reset) {
        _isLoading = true;
        _error = null;
        _items.clear();
        _nextCursor = null;
        _total = 0;
      } else {
        _isLoadingMore = true;
      }
    });
    final args = (
      repartidorId: widget.repartidorId,
      from: _from,
      to: _to,
      clientCode: null as String?,
      search: _serverSearch.isEmpty ? null : _serverSearch,
      estado: _estado,
      tipoDocumento: _tipoDocumento,
      cursor: reset ? null : _nextCursor,
      limit: _pageSize,
      forceRefresh: forceRefresh,
    );
    try {
      final page = await ref.read(repartidorVencimientosProvider(args).future);
      if (!mounted || generation != _generation) return;
      setState(() {
        if (reset) _items.clear();
        _items.addAll(page.items);
        _total = page.total;
        _nextCursor = page.nextCursor;
        _isLoading = false;
        _isLoadingMore = false;
      });
    } catch (error, stackTrace) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _error = error;
        _isLoading = false;
        _isLoadingMore = false;
      });
      try {
        await Sentry.captureException(error, stackTrace: stackTrace);
      } catch (_) {
        // Telemetry must never keep the page in a loading state.
      }
    }
  }

  Future<void> _pickDate({required bool isFrom}) async {
    final initialDate = isFrom ? _from : _to;
    final picked = await showDatePicker(
      context: context,
      initialDate: initialDate,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 730)),
    );
    if (picked == null || !mounted) return;
    if (isFrom && picked.isAfter(_to)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('La fecha inicial no puede superar la final'),
        ),
      );
      return;
    }
    if (!isFrom && picked.isBefore(_from)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('La fecha final no puede ser anterior a la inicial'),
        ),
      );
      return;
    }
    setState(() {
      if (isFrom) {
        _from = picked;
      } else {
        _to = picked;
      }
    });
    await _loadFirstPage(forceRefresh: true);
  }

  Widget _buildDateFilters() {
    final format = DateFormat('dd/MM/yyyy');
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          OutlinedButton.icon(
            onPressed: () => _pickDate(isFrom: true),
            icon: const Icon(Icons.calendar_today, size: 16),
            label: Text('Desde ${format.format(_from)}'),
          ),
          OutlinedButton.icon(
            onPressed: () => _pickDate(isFrom: false),
            icon: const Icon(Icons.event, size: 16),
            label: Text('Hasta ${format.format(_to)}'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (widget.repartidorId.isEmpty) {
      return Scaffold(
        backgroundColor: AppTheme.inkSurface,
        body: Center(
          child: Text(
            'Selecciona un repartidor para consultar cobros',
            style: TextStyle(color: AppTheme.textSecondary),
          ),
        ),
      );
    }
    if (_isLoading && _items.isEmpty) {
      return Scaffold(
        backgroundColor: AppTheme.inkSurface,
        body: Center(child: CircularProgressIndicator()),
      );
    }
    if (_error != null && _items.isEmpty) {
      return Scaffold(
        backgroundColor: AppTheme.inkSurface,
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                financeErrorMessage(
                  _error!,
                  'No se pudieron cargar los cobros',
                ),
                style: TextStyle(color: AppTheme.textSecondary),
              ),
              const SizedBox(height: 12),
              ElevatedButton(
                onPressed: () => _loadFirstPage(forceRefresh: true),
                child: const Text('Reintentar'),
              ),
            ],
          ),
        ),
      );
    }
    return Column(
      children: [
        _buildDateFilters(),
        Expanded(
          child: VencimientosPage(
            title: widget.title,
            vencimientos: _items.map(_mapVencimiento).toList(),
            initialFiltro: _filtro,
            initialTipoDocumento: _tipoDocumento,
            total: _total,
            hasMore: _nextCursor != null,
            isLoadingMore: _isLoadingMore,
            onLoadMore: _loadMore,
            onSearchSubmitted: _submitSearch,
            onFiltroChanged: _changeFiltro,
            onTipoDocumentoChanged: _changeTipoDocumento,
            onItemTap: (item) => _showDetail(
              context,
              ref,
              widget.repartidorId,
              item,
              onSaved: () => _loadFirstPage(forceRefresh: true),
            ),
          ),
        ),
      ],
    );
  }

  static VencimientoItem _mapVencimiento(RepartidorVencimiento item) {
    final fecha = item.dueDate;
    final today = DateTime.now();
    final todayDate = DateTime(today.year, today.month, today.day);
    final dueDate =
        fecha == null ? null : DateTime(fecha.year, fecha.month, fecha.day);
    final estado = item.importePendiente <= 0
        ? VencimientoEstado.cobrado
        : dueDate == null
            ? VencimientoEstado.sinFecha
            : dueDate.isBefore(todayDate)
                ? VencimientoEstado.vencido
                : dueDate.isAtSameMomentAs(todayDate)
                    ? VencimientoEstado.hoy
                    : VencimientoEstado.proximo;

    return VencimientoItem(
      id: item.documento,
      cliente: '${item.codigoCliente} ${item.nombreCliente}',
      documento: item.documento,
      fecha: fecha,
      importe: item.importePendiente,
      estado: estado,
      codigoCliente: item.codigoCliente,
      nombreCliente: item.nombreCliente,
      tipoDocumento: item.tipoDocumento,
      importePendiente: item.importePendiente,
      keys: item.keys,
      notas: [
        if (fecha == null) 'Sin fecha válida',
        if (item.tipoDocumento.isNotEmpty) item.tipoDocumento,
        if (item.nombreAlternativo.isNotEmpty) item.nombreAlternativo,
        if (item.poblacion.isNotEmpty) item.poblacion,
      ].join(' - '),
    );
  }

  static void _showDetail(
    BuildContext context,
    WidgetRef ref,
    String repartidorId,
    VencimientoItem item, {
    required VoidCallback onSaved,
  }) {
    final canAbonar = canCobrarVencimiento(item, repartidorId);
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.transparent,
      builder: (sheetContext) {
        return RepartidorExecutiveSheet(
          accentColor: _statusColor(item.estado),
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.cliente,
                    style: TextStyle(
                      color: AppTheme.textPrimary,
                      fontWeight: FontWeight.w800,
                      fontSize: 16,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      _DocumentTypePill(tipoDocumento: item.tipoDocumento),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          item.documento,
                          style: TextStyle(
                            color: AppTheme.textSecondary,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Vence: ${_formatDueDate(item.fecha)}',
                    style: TextStyle(color: AppTheme.textSecondary),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _money(item.importe),
                    style: const TextStyle(
                      color: AppTheme.success,
                      fontWeight: FontWeight.w900,
                      fontSize: 18,
                    ),
                  ),
                  if ((item.notas ?? '').isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text(
                      item.notas!,
                      style: TextStyle(color: AppTheme.textTertiary),
                    ),
                  ],
                  if (canAbonar) ...[
                    const SizedBox(height: 16),
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton.icon(
                        onPressed: () {
                          Navigator.of(sheetContext).pop();
                          _showAbonoDialog(
                            context,
                            ref,
                            repartidorId,
                            item,
                            onSaved: onSaved,
                          );
                        },
                        icon: const Icon(Icons.payments),
                        label: const Text('Abonar'),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  static Future<void> _showAbonoDialog(
    BuildContext context,
    WidgetRef ref,
    String repartidorId,
    VencimientoItem item, {
    required VoidCallback onSaved,
  }) async {
    final service = ref.read(repartidorFinanzasServiceProvider);
    final pendingIntent = service.findPendingVencimientoCobro(
      repartidorId: repartidorId,
      codigoCliente: item.codigoCliente,
      tipoDocumento: item.tipoDocumento,
      keys: item.keys,
    );
    if (pendingIntent != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            pendingIntent.requiresManualReview
                ? 'Este abono requiere revision manual; no se enviara otro.'
                : 'Este abono sigue pendiente de sincronizacion.',
          ),
          backgroundColor: pendingIntent.requiresManualReview
              ? AppTheme.error
              : AppTheme.warning,
        ),
      );
      return;
    }

    final idempotencyToken = createVencimientoCobroIdempotencyToken(
      repartidorId,
      item.documento,
    );
    final amountController = TextEditingController(
      text: item.importePendiente.toStringAsFixed(2).replaceAll('.', ','),
    );
    final notesController = TextEditingController();

    var formaPago = 'EFECTIVO';
    var saving = false;
    String? errorText;
    final rootContext = context;

    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) {
        return StatefulBuilder(
          builder: (contentContext, setState) {
            Future<void> submit() async {
              if (saving) return;
              final amount = double.tryParse(
                amountController.text.trim().replaceAll(',', '.'),
              );
              if (amount == null || amount <= 0) {
                setState(() => errorText = 'Importe invalido');
                return;
              }
              if (amount > item.importePendiente) {
                setState(() => errorText = 'Importe superior al pendiente');
                return;
              }
              setState(() {
                saving = true;
                errorText = null;
              });
              try {
                final result = await service.registerVencimientoCobro(
                  repartidorId: repartidorId,
                  codigoCliente: item.codigoCliente,
                  nombreCliente: item.nombreCliente,
                  tipoDocumento: item.tipoDocumento,
                  documento: item.documento,
                  keys: item.keys,
                  importeCobrado: amount,
                  importePendiente: item.importePendiente - amount,
                  formaPago: formaPago,
                  idempotencyToken: idempotencyToken,
                  notas: notesController.text,
                );
                if (result.isConfirmed) {
                  ref
                    ..invalidate(repartidorVencimientosProvider)
                    ..invalidate(repartidorDailySummaryProvider)
                    ..invalidate(repartidorCommissionSummaryProvider);
                  onSaved();
                }
                if (!dialogContext.mounted) return;
                Navigator.of(dialogContext).pop();
                if (!rootContext.mounted) return;
                final message = result.isConfirmed
                    ? 'Abono registrado'
                    : result.requiresManualReview
                        ? 'Abono pendiente de revision manual'
                        : 'Abono pendiente de sincronizacion';
                ScaffoldMessenger.of(rootContext).showSnackBar(
                  SnackBar(
                    content: Text(message),
                    backgroundColor: result.requiresManualReview
                        ? AppTheme.error
                        : result.isConfirmed
                            ? AppTheme.success
                            : AppTheme.warning,
                  ),
                );
              } catch (error, stackTrace) {
                if (!contentContext.mounted) return;
                setState(() {
                  saving = false;
                  errorText = financeErrorMessage(
                    error,
                    'No se pudo registrar el abono',
                  );
                });
                try {
                  await Sentry.captureException(error, stackTrace: stackTrace);
                } catch (_) {
                  // Telemetry must never keep the payment dialog blocked.
                }
              }
            }

            return PopScope(
              canPop: !saving,
              child: AlertDialog(
                backgroundColor: AppTheme.raisedSurface,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppTheme.radiusLg),
                  side: BorderSide(
                    color: AppTheme.info.withValues(alpha: 0.28),
                  ),
                ),
                title: Text(
                  'Abonar vencimiento',
                  style: TextStyle(color: AppTheme.textPrimary),
                ),
                content: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.documento,
                      style: TextStyle(color: AppTheme.textSecondary),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: amountController,
                      enabled: !saving,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      style: TextStyle(color: AppTheme.textPrimary),
                      decoration: InputDecoration(
                        labelText:
                            'Importe (pendiente ${item.importePendiente.toStringAsFixed(2)} €)',
                        prefixIcon: const Icon(Icons.euro),
                      ),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      initialValue: formaPago,
                      dropdownColor: AppTheme.raisedSurface,
                      style: TextStyle(color: AppTheme.textPrimary),
                      items: const [
                        DropdownMenuItem(
                          value: 'EFECTIVO',
                          child: Text('Efectivo'),
                        ),
                        DropdownMenuItem(
                          value: 'TARJETA',
                          child: Text('Tarjeta'),
                        ),
                        DropdownMenuItem(value: 'BIZUM', child: Text('Bizum')),
                        DropdownMenuItem(
                          value: 'TRANSFERENCIA',
                          child: Text('Transferencia'),
                        ),
                        DropdownMenuItem(
                            value: 'CHEQUE', child: Text('Cheque')),
                      ],
                      onChanged: saving
                          ? null
                          : (value) {
                              if (value != null) {
                                setState(() => formaPago = value);
                              }
                            },
                      decoration: const InputDecoration(
                        labelText: 'Forma de pago',
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: notesController,
                      enabled: !saving,
                      maxLength: 60,
                      minLines: 2,
                      maxLines: 4,
                      style: TextStyle(color: AppTheme.textPrimary),
                      decoration: const InputDecoration(
                        labelText: 'Observaciones (opcional)',
                        prefixIcon: Icon(Icons.notes),
                      ),
                    ),
                    if (errorText != null) ...[
                      const SizedBox(height: 10),
                      Text(
                        errorText!,
                        style: const TextStyle(color: AppTheme.error),
                      ),
                    ],
                  ],
                ),
                actions: [
                  TextButton(
                    onPressed: saving
                        ? null
                        : () => Navigator.of(contentContext).pop(),
                    child: const Text('Cancelar'),
                  ),
                  ElevatedButton.icon(
                    onPressed: saving ? null : submit,
                    icon: saving
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.payments),
                    label: const Text('Abonar'),
                  ),
                ],
              ),
            );
          },
        );
      },
    ).whenComplete(() {
      amountController.dispose();
      notesController.dispose();
    });
  }
}

class _FinanceHeader extends StatelessWidget {
  const _FinanceHeader({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.fromLTRB(
        16,
        MediaQuery.of(context).padding.top + 14,
        16,
        14,
      ),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        border: Border(
          bottom: BorderSide(
            color: AppTheme.borderColor.withValues(alpha: 0.9),
          ),
        ),
      ),
      child: Row(
        children: [
          RepartidorExecutiveIcon(
            icon: icon,
            color: AppTheme.info,
            size: 22,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    color: AppTheme.textPrimary,
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _FilterStrip extends StatelessWidget {
  const _FilterStrip({
    required this.selected,
    required this.onSelected,
  });

  final VencimientosFiltro selected;
  final ValueChanged<VencimientosFiltro> onSelected;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: AppTheme.inkSurface,
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            _chip(VencimientosFiltro.todos, 'Todos'),
            _chip(VencimientosFiltro.pendientes, 'Pendientes'),
            _chip(VencimientosFiltro.vencidos, 'Vencidos'),
            _chip(VencimientosFiltro.cobrados, 'Cobrados'),
            _chip(VencimientosFiltro.hoy, 'Hoy'),
            _chip(VencimientosFiltro.proximos, 'Proximos'),
          ],
        ),
      ),
    );
  }

  Widget _chip(VencimientosFiltro filtro, String label) {
    final isSelected = selected == filtro;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: RepartidorExecutivePill(
        label: label,
        color: AppTheme.info,
        selected: isSelected,
        onTap: () => onSelected(filtro),
      ),
    );
  }
}

class _DocumentTypeFilter extends StatelessWidget {
  const _DocumentTypeFilter({
    required this.selected,
    required this.onSelected,
  });

  final String? selected;
  final ValueChanged<String?> onSelected;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          _chip(null, 'Todos los documentos'),
          _chip('COC', 'Facturas'),
          _chip('CAC', 'Albaranes'),
          _chip('DEV', 'Devoluciones'),
        ],
      ),
    );
  }

  Widget _chip(String? value, String label) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: RepartidorExecutivePill(
        label: label,
        color: AppTheme.success,
        selected: selected == value,
        onTap: () => onSelected(value),
      ),
    );
  }
}

/// Lightweight typed specs for the virtualized vencimientos list: the flat
/// row list holds data, and ListView.builder only instantiates widgets for
/// visible rows.
sealed class _VencimientoRowSpec {
  const _VencimientoRowSpec();
}

class _GroupHeaderSpec extends _VencimientoRowSpec {
  const _GroupHeaderSpec(this.title, this.count, this.amount);

  final String title;
  final int count;
  final double amount;
}

class _VencimientoItemSpec extends _VencimientoRowSpec {
  const _VencimientoItemSpec(this.item);

  final VencimientoItem item;
}

class _LoadMoreSpec extends _VencimientoRowSpec {
  const _LoadMoreSpec();
}

class _GroupHeader extends StatelessWidget {
  const _GroupHeader({
    required this.title,
    required this.count,
    required this.amount,
  });

  final String title;
  final int count;
  final double amount;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(
        children: [
          Expanded(
            child: Text(
              '$title ($count)',
              style: TextStyle(
                color: AppTheme.textPrimary,
                fontSize: 13,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          Text(
            _money(amount),
            style: const TextStyle(
              color: AppTheme.success,
              fontSize: 13,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _VencimientoRow extends StatelessWidget {
  const _VencimientoRow({
    required this.item,
    this.onTap,
  });

  final VencimientoItem item;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final color = _statusColor(item.estado);

    return RepartidorExecutivePanel(
      accentColor: color,
      padding: EdgeInsets.zero,
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Container(
              width: 4,
              height: 52,
              decoration: BoxDecoration(
                color: color,
                borderRadius: BorderRadius.circular(4),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.cliente,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: AppTheme.textPrimary,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      _DocumentTypePill(tipoDocumento: item.tipoDocumento),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          '${item.documento} - '
                          '${_formatDueDate(item.fecha)}',
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: AppTheme.textSecondary,
                            fontSize: 12,
                          ),
                        ),
                      ),
                    ],
                  ),
                  if ((item.vendedor ?? '').isNotEmpty) ...[
                    const SizedBox(height: 3),
                    Text(
                      item.vendedor!,
                      style: TextStyle(
                        color: AppTheme.textTertiary,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 10),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  _money(item.importe),
                  style: TextStyle(
                    color: AppTheme.textPrimary,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 5),
                _StatusPill(label: _statusLabel(item.estado), color: color),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _DocumentTypePill extends StatelessWidget {
  const _DocumentTypePill({required this.tipoDocumento});

  final String tipoDocumento;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: AppTheme.info.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        documentTypeLabel(tipoDocumento),
        style: const TextStyle(
          color: AppTheme.info,
          fontSize: 9,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Text(
        message,
        style: TextStyle(color: AppTheme.textSecondary),
      ),
    );
  }
}

double _total(List<VencimientoItem> items) {
  return items.fold<double>(0, (sum, item) => sum + item.importe);
}

Color _statusColor(VencimientoEstado estado) {
  return switch (estado) {
    VencimientoEstado.vencido => AppTheme.error,
    VencimientoEstado.hoy => AppTheme.warning,
    VencimientoEstado.proximo => AppTheme.info,
    VencimientoEstado.sinFecha => AppTheme.textTertiary,
    VencimientoEstado.cobrado => AppTheme.success,
  };
}

String _statusLabel(VencimientoEstado estado) {
  return switch (estado) {
    VencimientoEstado.vencido => 'Vencido',
    VencimientoEstado.hoy => 'Hoy',
    VencimientoEstado.proximo => 'Proximo',
    VencimientoEstado.sinFecha => 'Sin fecha válida',
    VencimientoEstado.cobrado => 'Cobrado',
  };
}

String _formatDueDate(DateTime? value) {
  return value == null
      ? 'Sin fecha válida'
      : DateFormat('dd/MM/yyyy').format(value);
}

String _money(double value) {
  final fixed = value.toStringAsFixed(2).replaceAll('.', ',');
  return '$fixed €';
}
