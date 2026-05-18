import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/providers/filter_provider.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/global_vendor_selector.dart';
import 'package:gmp_app_mobilidad/features/clients/data/clients_service.dart';
import 'package:gmp_app_mobilidad/features/cobros/presentation/pages/cobro_detail_screen.dart';
import 'package:gmp_app_mobilidad/features/cobros/providers/cobros_provider.dart';

class CobrosPage extends ConsumerStatefulWidget {
  const CobrosPage({
    required this.employeeCode,
    super.key,
    this.isJefeVentas = false,
    this.forceShowVendorSelector = false,
  });
  final String employeeCode;
  final bool isJefeVentas;
  final bool forceShowVendorSelector;

  @override
  ConsumerState<CobrosPage> createState() => _CobrosPageState();
}

class _CobrosPageState extends ConsumerState<CobrosPage> {
  List<Map<String, dynamic>> _foundClients = [];
  bool _isSearchingClients = false;
  final TextEditingController _searchController = TextEditingController();

  /// Filtro de estado: 'todos' | 'vencido' | 'pendiente' | 'aldia'.
  /// Por defecto 'pendiente' para que al abrir veas SOLO los clientes con
  /// algun pendiente, en vez de todos en verde que es confuso.
  String _estadoFilter = 'pendiente';
  Timer? _debounceTimer;
  bool _isInitialized = false;
  ProviderSubscription<String?>? _vendorSubscription;
  int _clientLoadGeneration = 0;
  bool _isLoadingSummary = true;
  String? _loadError;

  // Single source of truth: Riverpod provider
  CobrosProvider get _provider =>
      ref.read(cobrosProvider(CobrosParams(employeeCode: widget.employeeCode)));

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _isInitialized = true;
      _loadClients();
      _loadPendingSummary();
    });

    _vendorSubscription =
        ref.listenManual<String?>(selectedVendorProvider, (previous, next) {
      if (_isInitialized && previous != next) {
        _loadClients();
        _loadPendingSummary();
      }
    });
  }

  Future<void> _loadClients([String query = '']) async {
    if (!mounted) return;
    final generation = ++_clientLoadGeneration;
    setState(() => _isSearchingClients = true);
    try {
      final currentFilterVendor = ref.read(selectedVendorProvider);
      final queryCode = currentFilterVendor ?? widget.employeeCode;
      final results = await ClientsService.getClientsList(
        vendedorCodes: queryCode,
        search: query.isEmpty ? null : query,
      );
      if (mounted && generation == _clientLoadGeneration) {
        setState(() => _foundClients = results);
      }
    } catch (e) {
      if (mounted && generation == _clientLoadGeneration) {
        setState(() {
          _foundClients = [];
          _loadError = 'Error cargando clientes: $e';
        });
      }
    } finally {
      if (mounted && generation == _clientLoadGeneration) {
        setState(() => _isSearchingClients = false);
      }
    }
  }

  Future<void> _loadPendingSummary() async {
    setState(() {
      _isLoadingSummary = true;
      _loadError = null;
    });
    final selectedVendor = ref.read(selectedVendorProvider);
    final authState = ref.read(authProvider).value;
    final allVendorCodes = authState?.vendedorCodes ?? [];

    try {
      if (selectedVendor != null && selectedVendor.isNotEmpty) {
        await _provider.cargarPendingSummary(selectedVendor);
      } else if (allVendorCodes.isNotEmpty) {
        await _provider.cargarPendingSummary(null, vendedorCodes: allVendorCodes);
      } else {
        await _provider.cargarPendingSummary(null);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _loadError = 'Error cargando resumen: $e');
      }
    } finally {
      if (mounted) {
        setState(() => _isLoadingSummary = false);
      }
    }
  }

  void _onSearchChanged(String query) {
    if (_debounceTimer?.isActive ?? false) _debounceTimer!.cancel();
    _debounceTimer =
        Timer(const Duration(milliseconds: 500), () => _loadClients(query));
  }

  Future<void> _onRefresh() async {
    _loadClients(_searchController.text);
    await _loadPendingSummary();
  }

  @override
  void dispose() {
    _vendorSubscription?.close();
    _searchController.dispose();
    _debounceTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Watch pendingSummary to trigger rebuilds only when pending data changes
    ref.watch(
      cobrosProvider(CobrosParams(employeeCode: widget.employeeCode))
          .select((p) => p.pendingSummary),
    );
    // Read full provider for grandTotal (not watched, just accessed when needed)
    final cobros = ref.read(
      cobrosProvider(CobrosParams(employeeCode: widget.employeeCode)),
    );
    final visibleClients = _visibleClients(cobros);
    final search = _searchController.text.trim();

    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: RefreshIndicator(
        onRefresh: _onRefresh,
        color: AppTheme.neonBlue,
        child: Column(
          children: [
            _buildHeader(),
            GlobalVendorSelector(
              isJefeVentas: widget.isJefeVentas,
              forceShow: widget.forceShowVendorSelector,
            ),
            // Loading state para pendingSummary
            if (_isLoadingSummary)
              const Expanded(
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_loadError != null)
              Expanded(
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.error_outline,
                          color: AppTheme.error,
                          size: 48,
                        ),
                        const SizedBox(height: 12),
                        Text(
                          _loadError!,
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: AppTheme.error),
                        ),
                        const SizedBox(height: 16),
                        ElevatedButton.icon(
                          onPressed: _onRefresh,
                          icon: const Icon(Icons.refresh),
                          label: const Text('Reintentar'),
                        ),
                      ],
                    ),
                  ),
                ),
              )
            else ...[
              _buildSummaryCard(cobros),
              _buildSearchArea(),
              _buildEstadoFilterChips(),
              Expanded(
                child: visibleClients.isEmpty && !_isSearchingClients
                    ? _buildNoClientsState(cobros, search)
                    : ListView.builder(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        itemCount: visibleClients.length,
                        itemBuilder: (context, index) {
                          return _buildClientCobroCard(visibleClients[index]);
                        },
                      ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  List<Map<String, dynamic>> _visibleClients(CobrosProvider cobros) {
    final search = _searchController.text.trim();
    if (search.isNotEmpty || cobros.pendingSummary.isEmpty) {
      return _foundClients;
    }

    // Merge foundClients con pendingSummary para tener nombres reales de CLI
    // cuando un cliente tiene deuda ERP pero no esta en la lista del comercial.
    final byCode = <String, Map<String, dynamic>>{};
    for (final client in _foundClients) {
      final code =
          (client['code'] ?? client['codigoCliente'] ?? client['codigo'] ?? '')
              .toString()
              .trim();
      if (code.isNotEmpty) byCode[code] = client;
    }

    final entries = cobros.pendingSummary.entries.where((entry) {
      final total = (entry.value['total'] as num?)?.toDouble() ?? 0;
      final vencido = (entry.value['vencido'] as num?)?.toDouble() ?? 0;
      final estado = vencido > 0
          ? 'vencido'
          : (total > 0 ? 'pendiente' : 'aldia');
      switch (_estadoFilter) {
        case 'vencido':
          return estado == 'vencido';
        case 'pendiente':
          return estado == 'pendiente' || estado == 'vencido';
        case 'aldia':
          return estado == 'aldia';
        case 'todos':
        default:
          return true;
      }
    }).toList()
      ..sort((a, b) {
        final aTotal = (a.value['total'] as num?)?.toDouble() ?? 0;
        final bTotal = (b.value['total'] as num?)?.toDouble() ?? 0;
        return bTotal.compareTo(aTotal);
      });

    return entries.map((entry) {
      final existing = byCode[entry.key] ?? const <String, dynamic>{};
      // Prioridad de nombre: lista de clientes > nombre desde CLI (API) > fallback
      final apiName = (entry.value['nombre'] as String?)?.trim();
      final name = (existing['name'] ??
              existing['nombre'] ??
              existing['nombreCliente'] ??
              apiName ??
              'Cliente ${entry.key}')
          .toString();
      return {
        ...existing,
        'code': entry.key,
        'name': name,
        // Flag para saber si el cliente viene solo de CVC (no es cliente del comercial)
        'fromErpDebt': existing.isEmpty && apiName != null,
      };
    }).toList();
  }

  /// Card resumen agregada en la cabecera: total pendiente, total vencido,
  /// numero de clientes con deuda. De un vistazo el comercial/jefe ve el
  /// estado global de cobros antes de entrar en el detalle por cliente.
  Widget _buildSummaryCard(CobrosProvider cobros) {
    final fmtMoney = (num v) {
      final s = v.toStringAsFixed(2).replaceAllMapped(
            RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
            (m) => '${m[1]}.',
          );
      return '$s€';
    };
    final tienePendiente = cobros.grandTotal > 0;
    final tieneVencido = cobros.grandTotalVencido > 0;

    return Container(
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 4),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            (tieneVencido ? Colors.redAccent : AppTheme.neonBlue)
                .withValues(alpha: 0.12),
            AppTheme.darkSurface.withValues(alpha: 0.6),
          ],
        ),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: (tieneVencido
                  ? Colors.redAccent
                  : (tienePendiente ? Colors.amber : AppTheme.neonGreen))
              .withValues(alpha: 0.3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: _summaryItem(
                  'Pendiente total',
                  fmtMoney(cobros.grandTotal),
                  Icons.account_balance_wallet,
                  Colors.amber,
                ),
              ),
              Container(
                width: 1, height: 36,
                color: Colors.white.withValues(alpha: 0.08),
              ),
              Expanded(
                child: _summaryItem(
                  'Vencido',
                  fmtMoney(cobros.grandTotalVencido),
                  Icons.error_outline,
                  Colors.redAccent,
                ),
              ),
              Container(
                width: 1, height: 36,
                color: Colors.white.withValues(alpha: 0.08),
              ),
              Expanded(
                child: _summaryItem(
                  'Clientes',
                  '${cobros.clientsWithDebt}'
                      '${cobros.clientsWithVencido > 0 ? ' (${cobros.clientsWithVencido}v)' : ''}',
                  Icons.people_outline,
                  AppTheme.neonBlue,
                ),
              ),
            ],
          ),
          // Fuente de datos: CVC = deuda real del ERP (vencimientos comerciales)
          const SizedBox(height: 6),
          Row(
            children: [
              Icon(
                Icons.info_outline,
                size: 11,
                color: Colors.white.withValues(alpha: 0.35),
              ),
              const SizedBox(width: 4),
              Text(
                'Deuda comercial real (ERP · CVC)',
                style: TextStyle(
                  fontSize: 9,
                  color: Colors.white.withValues(alpha: 0.35),
                  fontStyle: FontStyle.italic,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _summaryItem(String label, String value, IconData icon, Color color) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color, size: 13),
              const SizedBox(width: 4),
              Text(
                label,
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.55),
                  fontSize: 10,
                ),
              ),
            ],
          ),
          const SizedBox(height: 2),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              value,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 15,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Chip bar de filtros por estado de deuda. Permite alternar entre:
  /// - "Pendientes" (default): todos con cobro pendiente (vencido + pendiente)
  /// - "Vencidos": solo los que tienen importes vencidos
  /// - "Al dia": solo los que no deben nada
  /// - "Todos": no filtra
  Widget _buildEstadoFilterChips() {
    final filters = const [
      _FilterDef('pendiente', 'Pendientes', Icons.schedule, Colors.amber),
      _FilterDef('vencido', 'Vencidos', Icons.error_outline, Colors.redAccent),
      _FilterDef('aldia', 'Al dia', Icons.check_circle_outline, AppTheme.neonGreen),
      _FilterDef('todos', 'Todos', Icons.list, Colors.white70),
    ];
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppTheme.darkSurface.withValues(alpha: 0.4),
        border: Border(
          bottom: BorderSide(color: Colors.white.withValues(alpha: 0.05)),
        ),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: filters.map((f) {
            final selected = _estadoFilter == f.value;
            return Padding(
              padding: const EdgeInsets.only(right: 8),
              child: FilterChip(
                avatar: Icon(f.icon, size: 16,
                    color: selected ? Colors.white : f.color,),
                label: Text(f.label),
                selected: selected,
                onSelected: (_) =>
                    setState(() => _estadoFilter = f.value),
                backgroundColor: AppTheme.darkCard,
                selectedColor: f.color.withValues(alpha: 0.25),
                labelStyle: TextStyle(
                  color: selected ? Colors.white : Colors.white70,
                  fontWeight:
                      selected ? FontWeight.w600 : FontWeight.normal,
                ),
                side: BorderSide(
                  color: selected
                      ? f.color.withValues(alpha: 0.6)
                      : Colors.white.withValues(alpha: 0.1),
                ),
              ),
            );
          }).toList(),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: EdgeInsets.fromLTRB(
        Responsive.padding(context, small: 12, large: 24),
        Responsive.padding(context, small: 12, large: 20),
        Responsive.padding(context, small: 12, large: 24),
        Responsive.padding(context, small: 10, large: 16),
      ),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        border: Border(
          bottom: BorderSide(color: AppTheme.neonBlue.withValues(alpha: 0.2)),
        ),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.account_balance_wallet,
            color: AppTheme.neonBlue,
            size: 28,
          ),
          const SizedBox(width: 12),
          Text(
            'Gestión de Cobros',
            style: TextStyle(
              fontSize: Responsive.fontSize(context, small: 18, large: 22),
              fontWeight: FontWeight.bold,
              color: Colors.white,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchArea() {
    return Container(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          TextField(
            controller: _searchController,
            onChanged: _onSearchChanged,
            style: const TextStyle(color: Colors.white),
            decoration: InputDecoration(
              hintText: 'Buscar por nombre, código, NIF...',
              hintStyle:
                  TextStyle(color: AppTheme.textSecondary.withValues(alpha: 0.6)),
              prefixIcon:
                  Icon(Icons.search, color: AppTheme.neonBlue.withValues(alpha: 0.7)),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide:
                    BorderSide(color: AppTheme.neonBlue.withValues(alpha: 0.3)),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide:
                    BorderSide(color: AppTheme.neonBlue.withValues(alpha: 0.3)),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide:
                    const BorderSide(color: AppTheme.neonBlue, width: 2),
              ),
              filled: true,
              fillColor: AppTheme.surfaceColor,
              suffixIcon: _isSearchingClients
                  ? const SizedBox(
                      width: 48,
                      child: Center(
                        child: SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      ),
                    )
                  : null,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNoClientsState(CobrosProvider cobros, String searchQuery) {
    final hasDebt = cobros.grandTotal > 0;
    final isFiltering = searchQuery.isNotEmpty || _estadoFilter != 'pendiente';

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              isFiltering ? Icons.search_off : Icons.check_circle_outline,
              size: 64,
              color: (isFiltering
                      ? AppTheme.textSecondary
                      : AppTheme.success)
                  .withValues(alpha: 0.3),
            ),
            const SizedBox(height: 16),
            Text(
              isFiltering
                  ? 'No se encontraron resultados'
                  : (hasDebt
                      ? 'No hay clientes con deuda'
                      : 'Todo al dia'),
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: AppTheme.textSecondary,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              isFiltering
                  ? 'Prueba con otro termino de busqueda o filtro'
                  : (hasDebt
                      ? 'Los clientes con deuda no coinciden con el filtro actual'
                      : 'No hay cobros pendientes para este comercial'),
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 13,
                color: AppTheme.textSecondary.withValues(alpha: 0.7),
              ),
            ),
            if (hasDebt && !isFiltering) ...[
              const SizedBox(height: 12),
              Text(
                'Pendiente total: ${cobros.grandTotal.toStringAsFixed(2)} €',
                style: TextStyle(
                  fontSize: 14,
                  color: AppTheme.warning,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
            if (isFiltering) ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: () {
                  _searchController.clear();
                  setState(() => _estadoFilter = 'pendiente');
                },
                icon: const Icon(Icons.clear_all, size: 16),
                label: const Text('Limpiar filtros'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppTheme.neonBlue,
                  side: BorderSide(color: AppTheme.neonBlue.withValues(alpha: 0.3)),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildClientCobroCard(Map<String, dynamic> client) {
    final code =
        (client['code'] ?? client['codigoCliente'] ?? client['codigo'] ?? '')
            .toString();
    final pending = _provider.pendingForClient(code);
    final vencido = _provider.vencidoForClient(code);
    final estado = _provider.estadoForClient(code);
    final fromErpDebt = client['fromErpDebt'] == true;

    // Nombre: usar el que viene del backend (NOMBREALTERNATIVO > DESCRIPCIONCLIENTE)
    // Si el cliente esta en la lista del comercial, usar ese nombre.
    final name = (client['name'] ??
            client['nombre'] ??
            client['nombreCliente'] ??
            'Cliente')
        .toString();

    // Badge tricolor segun estado consolidado del cliente.
    final Color badgeColor;
    switch (estado) {
      case 'VENCIDO':
        badgeColor = AppTheme.error;
        break;
      case 'PENDIENTE':
        badgeColor = AppTheme.warning;
        break;
      default:
        badgeColor = AppTheme.success;
    }

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      color: AppTheme.surfaceColor,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: pending > 0
            ? BorderSide(color: badgeColor.withValues(alpha: 0.45))
            : BorderSide.none,
      ),
      child: InkWell(
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (context) => CobroDetailScreen(
                codigoCliente: code,
                nombreCliente: name,
                employeeCode: widget.employeeCode,
              ),
            ),
          );
        },
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              // Avatar con inicial
              CircleAvatar(
                backgroundColor: fromErpDebt
                    ? AppTheme.warning.withValues(alpha: 0.1)
                    : AppTheme.neonBlue.withValues(alpha: 0.1),
                child: Text(
                  name.isNotEmpty ? name[0].toUpperCase() : '?',
                  style: TextStyle(
                    color: fromErpDebt ? AppTheme.warning : AppTheme.neonBlue,
                    fontSize:
                        Responsive.fontSize(context, small: 18, large: 24),
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Nombre del cliente (NOMBREALTERNATIVO o fallback)
                    Text(
                      name,
                      style: TextStyle(
                        fontSize:
                            Responsive.fontSize(context, small: 14, large: 16),
                        fontWeight: FontWeight.w600,
                        color: Colors.white,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    // Codigo de cliente debajo del nombre
                    Text(
                      'Código: $code',
                      style: TextStyle(
                        fontSize:
                            Responsive.fontSize(context, small: 11, large: 13),
                        color: AppTheme.textSecondary,
                      ),
                    ),
                    // Badge "Deuda ERP" para clientes que no son del comercial
                    if (fromErpDebt) ...[
                      const SizedBox(height: 2),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: AppTheme.warning.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          'Deuda ERP',
                          style: TextStyle(
                            fontSize: 9,
                            color: AppTheme.warning,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              // Columna derecha: importe pendiente/vencido o tick verde
              if (pending > 0)
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: badgeColor.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                          color: badgeColor.withValues(alpha: 0.4),
                        ),
                      ),
                      child: Text(
                        '${pending.toStringAsFixed(2)} €',
                        style: TextStyle(
                          color: badgeColor,
                          fontWeight: FontWeight.bold,
                          fontSize: Responsive.fontSize(
                            context,
                            small: 12,
                            large: 14,
                          ),
                        ),
                      ),
                    ),
                    if (vencido > 0) ...[
                      const SizedBox(height: 4),
                      Text(
                        'Vencido: ${vencido.toStringAsFixed(2)} €',
                        style: TextStyle(
                          color: AppTheme.error,
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ],
                ),
              // Tick verde: solo si NO tiene pendiente Y NO tiene vencido
              if (pending == 0 && vencido == 0)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppTheme.success.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Icon(
                    Icons.check_circle,
                    color: AppTheme.success,
                    size: 20,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Definicion de un chip de filtro de estado.
class _FilterDef {
  const _FilterDef(this.value, this.label, this.icon, this.color);
  final String value;
  final String label;
  final IconData icon;
  final Color color;
}
