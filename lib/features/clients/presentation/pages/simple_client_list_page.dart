import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/providers/filter_provider.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/currency_formatter.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/utils/vendor_scope.dart';
import 'package:gmp_app_mobilidad/core/widgets/global_vendor_selector.dart';
import 'package:gmp_app_mobilidad/core/widgets/modern_loading.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_sync_header.dart'; // Import Sync Header
import 'package:gmp_app_mobilidad/features/clients/data/clients_service.dart';
import 'package:gmp_app_mobilidad/features/kpi_alerts/data/kpi_alerts_service.dart';
import 'package:gmp_app_mobilidad/features/kpi_alerts/presentation/widgets/client_alerts_widget.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/pages/pedidos_page.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/client_balance_badge.dart';
import 'package:url_launcher/url_launcher.dart';

/// Simple Clients List Page with debounced search
class SimpleClientListPage extends ConsumerStatefulWidget {
  const SimpleClientListPage({
    required this.employeeCode,
    super.key,
    this.isJefeVentas = false,
    this.vendorSelectorCodes,
    this.includeAllVendorOption = true,
    this.forceShowVendorSelector = false,
  });
  final String employeeCode;
  final bool isJefeVentas;
  final List<String>? vendorSelectorCodes;
  final bool includeAllVendorOption;
  final bool forceShowVendorSelector;

  @override
  ConsumerState<SimpleClientListPage> createState() =>
      _SimpleClientListPageState();
}

enum _ClientSortOrder {
  salesDesc,
  salesAsc,
  nameAsc,
  cityAsc,
}

class _SimpleClientListPageState extends ConsumerState<SimpleClientListPage> {
  List<Map<String, dynamic>> _clients = [];
  bool _isLoading = true;
  String? _error;
  String _searchQuery = '';
  _ClientSortOrder _sortOrder = _ClientSortOrder.salesDesc;
  DateTime? _lastFetchTime; // Track last sync
  // final _currencyFormat = NumberFormat.currency(symbol: '€', decimalDigits: 0);
  Timer? _debounceTimer;
  final TextEditingController _searchController = TextEditingController();

  String _selectedAlertType = 'ALL';
  bool _onlyWithAlerts = false;
  Set<String> _clientsWithAlertsCodes = const <String>{};
  bool _alertsPrefetchLoaded = false;
  ProviderSubscription<String?>? _vendorSubscription;
  int _loadGeneration = 0;

  final List<Map<String, dynamic>> _availableVendors = [];
  final String _selectedVendorCode =
      ''; // Default to empty string (All) for Manager view, so it matches dropdown item

  @override
  void initState() {
    super.initState();
    _loadClients();
    if (widget.isJefeVentas || widget.forceShowVendorSelector) {
      _vendorSubscription =
          ref.listenManual<String?>(selectedVendorProvider, (previous, next) {
        if (previous != next) {
          _loadClients(
            query: _searchController.text.trim().isEmpty
                ? null
                : _searchController.text.trim(),
            clearExisting: true,
          );
        }
      });
    }
  }

  // ... (dispose and _onSearchChanged remain same)

  @override
  void didUpdateWidget(covariant SimpleClientListPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.employeeCode != widget.employeeCode ||
        oldWidget.isJefeVentas != widget.isJefeVentas ||
        oldWidget.forceShowVendorSelector != widget.forceShowVendorSelector) {
      _loadClients(
        query: _searchController.text.trim().isEmpty
            ? null
            : _searchController.text.trim(),
        clearExisting: true,
      );
    }
  }

  @override
  void dispose() {
    _vendorSubscription?.close();
    _debounceTimer?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    final query = value.trim();
    _searchQuery = query;
    _debounceTimer?.cancel();
    _debounceTimer = Timer(const Duration(milliseconds: 250), () {
      _loadClients(query: query);
    });
  }

  List<Map<String, dynamic>> _sortClients(
    Iterable<Map<String, dynamic>> clients,
  ) {
    final sorted = List<Map<String, dynamic>>.from(clients);
    sorted.sort((a, b) {
      switch (_sortOrder) {
        case _ClientSortOrder.salesDesc:
          return _compareAmountDescThenName(a, b);
        case _ClientSortOrder.salesAsc:
          return _compareAmountAscThenName(a, b);
        case _ClientSortOrder.nameAsc:
          return _compareNameThenCity(a, b);
        case _ClientSortOrder.cityAsc:
          return _compareCityThenName(a, b);
      }
    });
    return sorted;
  }

  int _compareAmountDescThenName(
    Map<String, dynamic> a,
    Map<String, dynamic> b,
  ) {
    final amountCompare = _clientAmount(b).compareTo(_clientAmount(a));
    if (amountCompare != 0) return amountCompare;
    return _compareClientText(a, b, 'name');
  }

  int _compareAmountAscThenName(
    Map<String, dynamic> a,
    Map<String, dynamic> b,
  ) {
    final amountCompare = _clientAmount(a).compareTo(_clientAmount(b));
    if (amountCompare != 0) return amountCompare;
    return _compareClientText(a, b, 'name');
  }

  int _compareNameThenCity(Map<String, dynamic> a, Map<String, dynamic> b) {
    final nameCompare = _compareClientText(a, b, 'name');
    if (nameCompare != 0) return nameCompare;
    return _compareClientText(a, b, 'city');
  }

  int _compareCityThenName(Map<String, dynamic> a, Map<String, dynamic> b) {
    final cityCompare = _compareClientText(a, b, 'city', emptyLast: true);
    if (cityCompare != 0) return cityCompare;
    return _compareClientText(a, b, 'name');
  }

  int _compareClientText(
    Map<String, dynamic> a,
    Map<String, dynamic> b,
    String key, {
    bool emptyLast = false,
  }) {
    final left = _clientText(a, key);
    final right = _clientText(b, key);
    if (emptyLast) {
      if (left.isEmpty && right.isNotEmpty) return 1;
      if (left.isNotEmpty && right.isEmpty) return -1;
    }
    return left.compareTo(right);
  }

  double _clientAmount(Map<String, dynamic> client) {
    final value = client['totalPurchases'];
    if (value is num) return value.toDouble();
    final raw = value?.toString().trim() ?? '';
    if (raw.isEmpty) return 0;
    var cleaned = raw.replaceAll(RegExp('[^0-9,.-]'), '');
    if (cleaned.contains(',') &&
        cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      cleaned = cleaned.replaceAll('.', '').replaceAll(',', '.');
    }
    return double.tryParse(cleaned) ?? 0;
  }

  String _clientText(Map<String, dynamic> client, String key) {
    return (client[key]?.toString() ?? '').trim().toUpperCase();
  }

  void _onSortChanged(_ClientSortOrder? value) {
    if (value == null || value == _sortOrder) return;
    setState(() {
      _sortOrder = value;
      _clients = _sortClients(_clients);
    });
  }

  Future<void> _loadClients({
    String? query,
    bool clearExisting = false,
    bool forceRefresh = false,
  }) async {
    final generation = ++_loadGeneration;
    setState(() {
      _isLoading = true;
      _error = null;
      if (clearExisting) {
        _clients = [];
      }
    });

    try {
      // Logic: If Manager + Selected Vendor -> Filter by that.
      // If Manager + No selection -> Show All (pass no code).
      // If Rep -> Show only theirs (pass employeeCode).

      String? codesToPass;
      final authState = ref.read(authProvider).value;
      final authVendorCodes = authState?.vendedorCodes ?? const <String>[];
      if (hasScopedVendorAccess(
        userCode: authState?.user?.code,
        vendorCodes: authVendorCodes,
      )) {
        codesToPass = resolveScopedVendorCodes(
          userCode: authState?.user?.code,
          authVendorCodes: authVendorCodes,
          selectedVendor: ref.read(selectedVendorProvider),
          fallbackVendorCodes: widget.employeeCode,
        );
      } else if (widget.isJefeVentas || widget.forceShowVendorSelector) {
        codesToPass = ref.read(selectedVendorProvider);
        if (!widget.includeAllVendorOption &&
            (codesToPass == null ||
                codesToPass.isEmpty ||
                codesToPass == 'ALL')) {
          codesToPass = widget.employeeCode;
        }
      } else {
        codesToPass = widget.employeeCode;
      }

      final normalizedQuery = query?.trim();
      final isSearchLoad =
          normalizedQuery != null && normalizedQuery.isNotEmpty;
      final needsAlertPrefetch =
          !isSearchLoad || _onlyWithAlerts || _selectedAlertType != 'ALL';

      final results = await ClientsService.getClientsList(
        vendedorCodes: codesToPass,
        search: normalizedQuery,
        limit: isSearchLoad ? 80 : 200,
        forceRefresh: forceRefresh,
      );

      // Batch-compatible KPI prefetch: one request per list load, never one
      // request per client row. Compact row badges consume this set only.
      var alertCodesSet = _clientsWithAlertsCodes;
      var alertsPrefetchLoaded = _alertsPrefetchLoaded;
      if (needsAlertPrefetch) {
        try {
          final alertCodes =
              await KpiAlertsService.instance.getClientsWithAlerts(
            vendedorCodes: codesToPass,
            type: _selectedAlertType,
            forceRefresh: forceRefresh,
          );
          alertCodesSet = alertCodes.toSet();
          alertsPrefetchLoaded = true;
        } catch (_) {
          alertCodesSet = const <String>{};
          alertsPrefetchLoaded = false;
        }
      }

      var filteredResults = results;
      if (_onlyWithAlerts || _selectedAlertType != 'ALL') {
        filteredResults = results.where((c) {
          final code = c['code']?.toString() ?? '';
          return alertCodesSet.contains(code);
        }).toList();
      }

      if (!mounted || generation != _loadGeneration) return;
      setState(() {
        _clients = _sortClients(filteredResults);
        _clientsWithAlertsCodes = alertCodesSet;
        _alertsPrefetchLoaded = alertsPrefetchLoaded;
        _isLoading = false;
        _lastFetchTime = DateTime.now();
      });
    } catch (e) {
      if (!mounted || generation != _loadGeneration) return;
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  // ... (_navigateToClientMatrix)

  void _openWhatsApp(Map<String, dynamic> client) {
    // Backend now returns phones array with simple objects
    final phones = (client['phones'] as List?)
            ?.map((p) => Map<String, dynamic>.from(p as Map))
            .toList() ??
        [];

    // Fallback if phones array is empty but phone fields exist (legacy compat)
    if (phones.isEmpty) {
      if (client['phone'] != null && (client['phone'] as String).isNotEmpty) {
        phones.add({'type': 'Teléfono 1', 'number': client['phone']});
      }
      if (client['phone2'] != null && (client['phone2'] as String).isNotEmpty) {
        phones.add({'type': 'Teléfono 2', 'number': client['phone2']});
      }
    }

    // Always show selector with custom option
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.raisedSurface,
      shape: RoundedRectangleBorder(
        borderRadius: const BorderRadius.vertical(
          top: Radius.circular(AppTheme.radiusXl),
        ),
        side: BorderSide(color: AppTheme.borderColor.withValues(alpha: 0.72)),
      ),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Enviar WhatsApp',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
            ),
            const SizedBox(height: 8),
            const Text(
              'Selecciona el número:',
              style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
            ),
            const SizedBox(height: 12),
            if (phones.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  'No hay teléfonos guardados',
                  style: TextStyle(color: AppTheme.textSecondary),
                ),
              ),
            ...phones.map(
              (p) => ListTile(
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                ),
                leading: const Icon(
                  Icons.phone_android,
                  color: AppColors.whatsappGreen,
                ),
                title: Text((p['number'] as String?) ?? ''),
                subtitle: Text((p['type'] as String?) ?? 'Teléfono'),
                onTap: () {
                  Navigator.pop(ctx);
                  _launchWhatsApp((p['number'] as String?) ?? '');
                },
              ),
            ),
            const Divider(),
            ListTile(
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
              ),
              leading: const Icon(Icons.dialpad, color: AppTheme.accentRose),
              title: const Text('Introducir número manualmente'),
              subtitle: const Text('Escribe un número personalizado'),
              onTap: () {
                Navigator.pop(ctx);
                _showCustomPhoneDialog(isWhatsApp: true);
              },
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  Future<void> _showCustomPhoneDialog({required bool isWhatsApp}) async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.raisedSurface,
        title: Text(isWhatsApp ? 'WhatsApp' : 'Llamar'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.phone,
          decoration: InputDecoration(
            labelText: 'Número de teléfono',
            hintText: 'Ej: 600 123 456',
            prefixIcon: Icon(isWhatsApp ? Icons.chat : Icons.phone),
            border: const OutlineInputBorder(),
          ),
          autofocus: true,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text(
              'Cancelar',
              style: TextStyle(color: AppTheme.textSecondary),
            ),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, controller.text),
            style: ElevatedButton.styleFrom(
              backgroundColor:
                  isWhatsApp ? AppColors.whatsappGreen : AppTheme.info,
            ),
            child: Text(isWhatsApp ? 'Enviar WhatsApp' : 'Llamar'),
          ),
        ],
      ),
    );

    if (result != null && result.trim().isNotEmpty) {
      _launchWhatsApp(result.trim());
    }
  }

  Future<void> _launchWhatsApp(String phone) async {
    // Clean phone number - remove non-digits except +
    var cleanPhone = phone.replaceAll(RegExp('[^0-9+]'), '');
    // Add Spain prefix if not present
    if (!cleanPhone.startsWith('+') && !cleanPhone.startsWith('34')) {
      cleanPhone = '34$cleanPhone';
    }
    if (cleanPhone.startsWith('+')) {
      cleanPhone = cleanPhone.substring(1);
    }

    // Personal identification
    final authState =
        ProviderScope.containerOf(context).read(authProvider).value;
    final nombreComercial = authState?.user?.name ?? 'tu comercial';
    final manana = DateTime.now().add(const Duration(days: 1));
    final fecha = '${manana.day}/${manana.month}/${manana.year}';

    // Professional message
    final message =
        Uri.encodeComponent('Hola, soy $nombreComercial de Mari Pepa. '
            'Mañana día $fecha tenemos visita. '
            '¿Necesitas cualquier cosilla?');

    final uri = Uri.parse('https://wa.me/$cleanPhone?text=$message');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No se pudo abrir WhatsApp')),
      );
    }
  }

  void _navigateToClientMatrix(Map<String, dynamic> client) {
    final code = client['code'] as String? ?? '';
    final name = client['name'] as String? ?? 'Cliente';
    if (code.isNotEmpty) {
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (context) => PedidosPage(
            employeeCode: widget.employeeCode,
            isJefeVentas: widget.isJefeVentas,
            initialClientCode: code,
            initialClientName: name,
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final pagePadding = Responsive.padding(context, small: 12, large: 16);

    return Column(
      children: [
        // Smart Sync Header
        SmartSyncHeader(
          title: 'Cartera de Clientes',
          subtitle: '${_clients.length} clientes encontrados',
          lastSync: _lastFetchTime,
          isLoading: _isLoading && _clients.isNotEmpty,
          onSync: () => _loadClients(
            query: _searchQuery,
            forceRefresh: true,
          ),
        ),

        Padding(
          padding: EdgeInsets.fromLTRB(pagePadding, 12, pagePadding, 0),
          child: Container(
            padding: EdgeInsets.all(pagePadding),
            decoration: BoxDecoration(
              gradient: AppTheme.commandGradient,
              borderRadius: BorderRadius.circular(AppTheme.radiusLg),
              border: Border.all(
                color: AppTheme.success.withValues(alpha: 0.24),
              ),
              boxShadow: [
                ...AppTheme.elevation2,
                BoxShadow(
                  color: AppTheme.success.withValues(alpha: 0.08),
                  blurRadius: 24,
                ),
              ],
            ),
            child: Column(
              children: [
                if (!Responsive.isLandscapeCompact(context))
                  Row(
                    children: [
                      Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: [
                              AppTheme.success.withValues(alpha: 0.22),
                              AppTheme.success.withValues(alpha: 0.07),
                            ],
                          ),
                          borderRadius:
                              BorderRadius.circular(AppTheme.radiusMd),
                          border: Border.all(
                            color: AppTheme.success.withValues(alpha: 0.28),
                          ),
                        ),
                        child: const Icon(
                          Icons.people_alt_outlined,
                          color: AppTheme.success,
                          size: 20,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          'Clientes',
                          style: Theme.of(context)
                              .textTheme
                              .titleLarge
                              ?.copyWith(fontWeight: FontWeight.w700),
                        ),
                      ),
                      _ClientCountPill(count: _clients.length),
                    ],
                  ),
                if (widget.isJefeVentas || widget.forceShowVendorSelector) ...[
                  if (!Responsive.isLandscapeCompact(context))
                    const SizedBox(height: 12),
                  GlobalVendorSelector(
                    isJefeVentas: widget.isJefeVentas,
                    allowedVendorCodes: widget.vendorSelectorCodes,
                    includeAllOption: widget.includeAllVendorOption,
                    defaultVendorCode: widget.employeeCode,
                    forceShow: widget.forceShowVendorSelector,
                  ),
                ],
              ],
            ),
          ),
        ),

        // KPI Filters Bar
        _buildKpiFilters(),

        _buildSortSelector(pagePadding),

        // Search Bar
        Padding(
          padding: EdgeInsets.symmetric(horizontal: pagePadding),
          child: TextField(
            decoration: InputDecoration(
              hintText: 'Buscar cliente, NIF, Ciudad, Código...',
              prefixIcon: const Icon(Icons.search),
              filled: true,
              fillColor: AppTheme.surfaceCommand,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                borderSide: BorderSide(
                  color: AppTheme.success.withValues(alpha: 0.18),
                ),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                borderSide: BorderSide(
                  color: AppTheme.success.withValues(alpha: 0.18),
                ),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                borderSide: const BorderSide(
                  color: AppTheme.success,
                  width: 1.6,
                ),
              ),
            ),
            controller: _searchController,
            onChanged: _onSearchChanged,
          ),
        ),

        const SizedBox(height: 16),

        // Content
        Expanded(
          child: _buildContent(),
        ),
      ],
    );
  }

  Widget _buildContent() {
    if (_isLoading) {
      return Padding(
        padding:
            EdgeInsets.all(Responsive.padding(context, small: 24, large: 40)),
        child: const ModernLoading(message: 'Cargando cartera de clientes...'),
      );
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 64, color: AppTheme.error),
            const SizedBox(height: 16),
            Text('Error: $_error'),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _loadClients,
              child: const Text('Reintentar'),
            ),
          ],
        ),
      );
    }

    if (_clients.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(
              Icons.people_outline,
              size: 64,
              color: AppTheme.textSecondary,
            ),
            const SizedBox(height: 16),
            const Text('No se encontraron clientes'),
            const SizedBox(height: 8),
            Text(
              'Vendedor: ${widget.employeeCode}',
              style: const TextStyle(color: AppTheme.textSecondary),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () => _loadClients(
        query: _searchQuery,
        forceRefresh: true,
      ),
      child: ListView.builder(
        padding: EdgeInsets.symmetric(
          horizontal: Responsive.padding(context, small: 12, large: 16),
        ),
        itemCount: _clients.length,
        itemBuilder: (context, index) {
          final client = _clients[index];
          final code = client['code']?.toString() ?? '';
          return _ClientCard(
            client: client,
            isJefeVentas: widget.isJefeVentas,
            hasPrefetchedAlerts:
                _alertsPrefetchLoaded && _clientsWithAlertsCodes.contains(code),
            onTap: () => _navigateToClientMatrix(client),
            onWhatsAppTap: () => _openWhatsApp(client),
          );
        },
      ),
    );
  }

  Widget _buildKpiFilters() {
    final alertTypes = {
      'ALL': 'Todas las Alertas',
      'DESVIACION_VENTAS': 'Ventas vs Objetivo',
      'CUOTA_SIN_COMPRA': 'Sin Compras',
      'DESVIACION_REFERENCIACION': 'Productos Pendientes',
      'PROMOCION': 'Promociones',
      'ALTA_CLIENTE': 'Cliente Nuevo',
      'AVISO': 'Avisos',
      'MEDIOS_CLIENTE': 'Equipamiento',
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Container(
                  height: 40,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  decoration: BoxDecoration(
                    gradient: AppTheme.cardGradient,
                    borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                    border: Border.all(
                      color: _selectedAlertType != 'ALL'
                          ? AppTheme.warning
                          : AppTheme.activeRing.withValues(alpha: 0.14),
                    ),
                    boxShadow: _selectedAlertType != 'ALL'
                        ? [
                            BoxShadow(
                              color: AppTheme.warning.withValues(alpha: 0.12),
                              blurRadius: 16,
                            ),
                          ]
                        : null,
                  ),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<String>(
                      value: _selectedAlertType,
                      isExpanded: true,
                      dropdownColor: AppTheme.raisedSurface,
                      icon: const Icon(Icons.filter_list, size: 20),
                      style: TextStyle(
                        fontSize: 13,
                        color: _selectedAlertType != 'ALL'
                            ? AppTheme.warning
                            : AppTheme.textPrimary,
                        fontWeight: _selectedAlertType != 'ALL'
                            ? FontWeight.bold
                            : FontWeight.normal,
                      ),
                      items: alertTypes.entries
                          .map(
                            (e) => DropdownMenuItem(
                              value: e.key,
                              child: Text(e.value),
                            ),
                          )
                          .toList(),
                      onChanged: (value) {
                        if (value != null) {
                          setState(() => _selectedAlertType = value);
                          _loadClients(query: _searchQuery);
                        }
                      },
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              FilterChip(
                label: const Text('Con Alertas'),
                selected: _onlyWithAlerts,
                selectedColor: AppTheme.warning.withValues(alpha: 0.24),
                backgroundColor: AppTheme.surfaceCommand,
                checkmarkColor: AppTheme.warning,
                labelStyle: TextStyle(
                  fontSize: 12,
                  color: _onlyWithAlerts
                      ? AppTheme.warning
                      : AppTheme.textSecondary,
                  fontWeight:
                      _onlyWithAlerts ? FontWeight.bold : FontWeight.normal,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                  side: BorderSide(
                    color: _onlyWithAlerts
                        ? AppTheme.warning
                        : AppTheme.activeRing.withValues(alpha: 0.14),
                  ),
                ),
                onSelected: (val) {
                  setState(() => _onlyWithAlerts = val);
                  _loadClients(query: _searchQuery);
                },
              ),
            ],
          ),
          if (_selectedAlertType != 'ALL' || _onlyWithAlerts)
            Padding(
              padding: const EdgeInsets.only(top: 8, left: 4),
              child: InkWell(
                onTap: () {
                  setState(() {
                    _selectedAlertType = 'ALL';
                    _onlyWithAlerts = false;
                  });
                  _loadClients(query: _searchQuery);
                },
                child: const Text(
                  'Limpiar filtros KPI',
                  style: TextStyle(
                    color: AppTheme.warning,
                    fontSize: 11,
                    decoration: TextDecoration.underline,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildSortSelector(double pagePadding) {
    return Padding(
      padding: EdgeInsets.fromLTRB(pagePadding, 0, pagePadding, 10),
      child: Container(
        height: 44,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        decoration: BoxDecoration(
          gradient: AppTheme.cardGradient,
          borderRadius: BorderRadius.circular(AppTheme.radiusMd),
          border: Border.all(color: AppTheme.success.withValues(alpha: 0.18)),
          boxShadow: AppTheme.elevation1,
        ),
        child: Row(
          children: [
            const Icon(Icons.sort, size: 20, color: AppTheme.textSecondary),
            const SizedBox(width: 8),
            Expanded(
              child: DropdownButtonHideUnderline(
                child: DropdownButton<_ClientSortOrder>(
                  value: _sortOrder,
                  isExpanded: true,
                  dropdownColor: AppTheme.raisedSurface,
                  icon: const Icon(Icons.expand_more, size: 20),
                  style: const TextStyle(
                    fontSize: 13,
                    color: AppTheme.textPrimary,
                    fontWeight: FontWeight.w600,
                  ),
                  items: const [
                    DropdownMenuItem(
                      value: _ClientSortOrder.salesDesc,
                      child: Text('Importe: mayor a menor'),
                    ),
                    DropdownMenuItem(
                      value: _ClientSortOrder.salesAsc,
                      child: Text('Importe: menor a mayor'),
                    ),
                    DropdownMenuItem(
                      value: _ClientSortOrder.nameAsc,
                      child: Text('Orden alfabetico'),
                    ),
                    DropdownMenuItem(
                      value: _ClientSortOrder.cityAsc,
                      child: Text('Localidad'),
                    ),
                  ],
                  onChanged: _onSortChanged,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ClientCountPill extends StatelessWidget {
  const _ClientCountPill({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppTheme.success.withValues(alpha: 0.18),
            AppTheme.success.withValues(alpha: 0.06),
          ],
        ),
        borderRadius: BorderRadius.circular(AppTheme.radiusFull),
        border: Border.all(color: AppTheme.success.withValues(alpha: 0.30)),
      ),
      child: Text(
        '$count clientes',
        style: Theme.of(context).textTheme.labelMedium?.copyWith(
              color: AppTheme.textSecondary,
              fontWeight: FontWeight.w600,
            ),
      ),
    );
  }
}

class _ClientCard extends StatelessWidget {
  const _ClientCard({
    required this.client,
    this.isJefeVentas = false,
    this.hasPrefetchedAlerts = false,
    this.onTap,
    this.onWhatsAppTap,
  });
  final Map<String, dynamic> client;
  final bool isJefeVentas;
  final bool hasPrefetchedAlerts;
  final VoidCallback? onTap;
  final VoidCallback? onWhatsAppTap;

  @override
  Widget build(BuildContext context) {
    final name = (client['name'] as String?) ?? 'Sin nombre';
    final code = (client['code'] as String?) ?? '';
    final city = (client['city'] as String?) ?? '';
    final phone = (client['phone'] as String?) ?? '';
    final route = (client['route'] as String?) ?? '';
    final totalPurchases = (client['totalPurchases'] as num?)?.toDouble() ?? 0;
    final numOrders = (client['numOrders'] as int?) ?? 0;
    final lastPurchase = (client['lastPurchase'] as String?) ?? '';

    final avatarRadius = Responsive.value(context, phone: 20, desktop: 28);
    final avatarFontSize = Responsive.fontSize(context, small: 15, large: 20);
    final cardPadding = Responsive.padding(context, small: 12, large: 16);

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      color: AppTheme.surfaceCommand,
      elevation: 4,
      shadowColor: AppTheme.success.withValues(alpha: 0.12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        side: BorderSide(
          color: (hasPrefetchedAlerts ? AppTheme.warning : AppTheme.success)
              .withValues(alpha: hasPrefetchedAlerts ? 0.42 : 0.20),
        ),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        child: Padding(
          padding: EdgeInsets.all(cardPadding),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Avatar
                  Container(
                    width: avatarRadius * 2,
                    height: avatarRadius * 2,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          AppTheme.success.withValues(alpha: 0.24),
                          AppTheme.surfaceCommand,
                          AppTheme.success.withValues(alpha: 0.08),
                        ],
                      ),
                      border: Border.all(
                        color: AppTheme.success.withValues(alpha: 0.42),
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: AppTheme.success.withValues(alpha: 0.10),
                          blurRadius: 16,
                        ),
                      ],
                    ),
                    child: Text(
                      name.isNotEmpty ? name[0].toUpperCase() : 'C',
                      style: TextStyle(
                        color: AppTheme.textPrimary,
                        fontWeight: FontWeight.bold,
                        fontSize: avatarFontSize,
                      ),
                    ),
                  ),
                  const SizedBox(width: 16),

                  // Info
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          name,
                          style:
                              Theme.of(context).textTheme.titleMedium?.copyWith(
                                    fontWeight: FontWeight.bold,
                                  ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            const Icon(
                              Icons.location_on,
                              size: 14,
                              color: AppTheme.textSecondary,
                            ),
                            const SizedBox(width: 4),
                            Expanded(
                              child: Text(
                                city.isNotEmpty ? city : 'Sin ciudad',
                                style: Theme.of(context)
                                    .textTheme
                                    .bodySmall
                                    ?.copyWith(
                                      color: AppTheme.textSecondary,
                                    ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                        if (phone.isNotEmpty) ...[
                          const SizedBox(height: 2),
                          Row(
                            children: [
                              const Icon(
                                Icons.phone,
                                size: 14,
                                color: AppTheme.textSecondary,
                              ),
                              const SizedBox(width: 4),
                              Text(
                                phone,
                                style: Theme.of(context)
                                    .textTheme
                                    .bodySmall
                                    ?.copyWith(
                                      color: AppTheme.textSecondary,
                                    ),
                              ),
                            ],
                          ),
                        ],
                        if (isJefeVentas && client['vendorName'] != null) ...[
                          const SizedBox(height: 4),
                          Row(
                            children: [
                              const Icon(
                                Icons.person_outline,
                                size: 14,
                                color: AppTheme.accentIndigo,
                              ),
                              const SizedBox(width: 4),
                              Expanded(
                                child: Text(
                                  'Rep: ${client['vendorName']}',
                                  style: Theme.of(context)
                                      .textTheme
                                      .bodySmall
                                      ?.copyWith(
                                        color: AppTheme.accentIndigo,
                                        fontWeight: FontWeight.bold,
                                      ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                        ],
                        if (clientDebtIsVisible(client))
                          ClientDebtStatusChip(balance: client),
                      ],
                    ),
                  ),

                  // Stats
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        CurrencyFormatter.formatWhole(totalPurchases),
                        style:
                            Theme.of(context).textTheme.titleMedium?.copyWith(
                                  fontWeight: FontWeight.bold,
                                  color: AppTheme.success,
                                ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '$numOrders pedidos',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: AppTheme.textSecondary,
                            ),
                      ),
                      if (lastPurchase.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: AppTheme.softPanel,
                            borderRadius: BorderRadius.circular(
                              AppTheme.radiusFull,
                            ),
                            border: Border.all(
                              color:
                                  AppTheme.borderColor.withValues(alpha: 0.9),
                            ),
                          ),
                          child: Text(
                            'Último pedido: $lastPurchase',
                            style: Theme.of(context)
                                .textTheme
                                .labelSmall
                                ?.copyWith(
                                  color: AppTheme.textSecondary,
                                  fontWeight: FontWeight.w500,
                                ),
                          ),
                        ),
                      ],
                    ],
                  ),

                  // WhatsApp button
                  if (phone.isNotEmpty && onWhatsAppTap != null) ...[
                    const SizedBox(width: 8),
                    IconButton(
                      onPressed: onWhatsAppTap,
                      icon: const Icon(
                        Icons.chat,
                        color: AppColors.whatsappGreen,
                        size: 24,
                      ),
                      tooltip: 'WhatsApp',
                      padding: EdgeInsets.zero,
                      constraints:
                          const BoxConstraints(minWidth: 40, minHeight: 40),
                    ),
                  ],
                ],
              ),

              // KPI alert badges
              if (code.isNotEmpty)
                ClientAlertsWidget(
                  clientId: code,
                  compact: true,
                  fetchWhenCompact: false,
                  hasPrefetchedAlerts: hasPrefetchedAlerts,
                ),

              // Route & Days Badges
              _buildRouteDaysRow(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRouteDaysRow() {
    final route = client['route'] as String? ?? '';
    final visitDays = client['visitDaysShort'] as String? ?? '';
    final deliveryDays = client['deliveryDaysShort'] as String? ?? '';

    if (route.isEmpty && visitDays.isEmpty && deliveryDays.isEmpty) {
      return const SizedBox.shrink();
    }

    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Wrap(
        spacing: 8,
        runSpacing: 4,
        children: [
          // Route Badge
          if (route.isNotEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: AppTheme.accentIndigo.withValues(alpha: 0.13),
                borderRadius: BorderRadius.circular(AppTheme.radiusSm),
                border: Border.all(
                  color: AppTheme.accentIndigo.withValues(alpha: 0.22),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.route,
                    size: 12,
                    color: AppTheme.accentIndigo,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    'Ruta $route',
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppTheme.accentIndigo,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),

          // Visit Days Badge
          if (visitDays.isNotEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: AppTheme.info.withValues(alpha: 0.13),
                borderRadius: BorderRadius.circular(AppTheme.radiusSm),
                border: Border.all(
                  color: AppTheme.info.withValues(alpha: 0.22),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.calendar_today,
                    size: 12,
                    color: AppTheme.info,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    'Visita: $visitDays',
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppTheme.info,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),

          // Delivery Days Badge
          if (deliveryDays.isNotEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: AppTheme.success.withValues(alpha: 0.13),
                borderRadius: BorderRadius.circular(AppTheme.radiusSm),
                border: Border.all(
                  color: AppTheme.success.withValues(alpha: 0.22),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.local_shipping,
                    size: 12,
                    color: AppTheme.success,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    'Reparto: $deliveryDays',
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppTheme.success,
                      fontWeight: FontWeight.w500,
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
