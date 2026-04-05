import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../../../core/widgets/global_vendor_selector.dart';
import '../../../../core/providers/filter_provider.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/providers/auth_notifier.dart';
import '../../providers/cobros_provider.dart';
import '../../../clients/data/clients_service.dart';
import 'cobro_detail_screen.dart';

class CobrosPage extends ConsumerStatefulWidget {
  final String employeeCode;
  final bool isJefeVentas;

  const CobrosPage({
    super.key,
    required this.employeeCode,
    this.isJefeVentas = false,
  });

  @override
  ConsumerState<CobrosPage> createState() => _CobrosPageState();
}

class _CobrosPageState extends ConsumerState<CobrosPage> {
  late CobrosProvider _cobrosProvider;

  List<Map<String, dynamic>> _foundClients = [];
  bool _isSearchingClients = false;
  final TextEditingController _searchController = TextEditingController();
  Timer? _debounceTimer;

  @override
  void initState() {
    super.initState();
    _cobrosProvider = CobrosProvider(
      employeeCode: widget.employeeCode,
      isRepartidor: false,
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadClients();
      _loadPendingSummary();
    });
  }

  void _loadClients([String query = '']) async {
    if (!mounted) return;
    setState(() => _isSearchingClients = true);
    try {
      final currentFilterVendor = ref.read(selectedVendorProvider);
      final queryCode = currentFilterVendor ?? widget.employeeCode;
      
      final results = await ClientsService.getClientsList(
        vendedorCodes: queryCode,
        search: query.isEmpty ? null : query,
      );
      if (mounted) {
        setState(() => _foundClients = results);
      }
    } catch (_) {}
    if (mounted) setState(() => _isSearchingClients = false);
  }

  void _loadPendingSummary() {
    final selectedVendor = ref.read(selectedVendorProvider);
    
    // Get all vendor codes from auth provider
    final authState = ProviderScope.containerOf(context)
        .read(authProvider)
        .value;
    final allVendorCodes = authState?.vendedorCodes ?? [];
    
    // Determine which vendors to use
    if (selectedVendor != null && selectedVendor.isNotEmpty) {
      // Single vendor selected
      _cobrosProvider.cargarPendingSummary(selectedVendor);
    } else if (allVendorCodes.isNotEmpty) {
      // Multiple vendors (jefe de ventas) - pass all codes
      _cobrosProvider.cargarPendingSummary(null, vendedorCodes: allVendorCodes);
    } else {
      // No vendors - use ALL
      _cobrosProvider.cargarPendingSummary(null);
    }
  }

  void _onSearchChanged(String query) {
    if (_debounceTimer?.isActive ?? false) _debounceTimer!.cancel();
    _debounceTimer = Timer(const Duration(milliseconds: 500), () {
      _loadClients(query);
    });
  }

  void _onVendorChanged() {
    _loadClients(_searchController.text);
    _loadPendingSummary();
  }

  @override
  void dispose() {
    _searchController.dispose();
    _debounceTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider.value(
      value: _cobrosProvider,
      child: Scaffold(
        backgroundColor: AppTheme.darkBase,
        body: Column(
          children: [
            _buildHeader(),
            GlobalVendorSelector(
              isJefeVentas: widget.isJefeVentas,
              onChanged: _onVendorChanged,
            ),
            _buildSearchArea(),
            Expanded(
              child: _foundClients.isEmpty && !_isSearchingClients
                  ? _buildNoClientsState()
                  : ListView.builder(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      itemCount: _foundClients.length,
                      itemBuilder: (context, index) {
                        return _buildClientCobroCard(_foundClients[index]);
                      },
                    ),
            ),
          ],
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
          bottom: BorderSide(
            color: AppTheme.neonBlue.withOpacity(0.2),
            width: 1,
          ),
        ),
      ),
      child: Row(
        children: [
          Container(
            padding: EdgeInsets.all(Responsive.value(context, phone: 8, desktop: 12)),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  AppTheme.neonBlue.withOpacity(0.2),
                  AppTheme.neonPurple.withOpacity(0.2),
                ],
              ),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Icon(
              Icons.payments,
              color: AppTheme.neonBlue,
              size: Responsive.iconSize(context, phone: 22, desktop: 28),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Cobros Pendientes',
                  style: TextStyle(
                    fontSize: Responsive.fontSize(context, small: 18, large: 24),
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textPrimary,
                  ),
                ),
                Text(
                  'Selecciona un cliente para comenzar',
                  style: TextStyle(
                    fontSize: Responsive.fontSize(context, small: 11, large: 13),
                    color: AppTheme.textSecondary.withOpacity(0.8),
                  ),
                ),
                if (_cobrosProvider.grandTotal > 0)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      'Total pendiente: ${_cobrosProvider.grandTotal.toStringAsFixed(2)} €',
                      style: TextStyle(
                        fontSize: Responsive.fontSize(context, small: 12, large: 14),
                        color: AppTheme.warning,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchArea() {
    return Container(
      padding: const EdgeInsets.all(16),
      child: TextField(
        controller: _searchController,
        onChanged: _onSearchChanged,
        style: const TextStyle(color: Colors.white),
        decoration: InputDecoration(
          hintText: 'Buscar cliente para cobrar...',
          hintStyle: const TextStyle(color: AppTheme.textSecondary),
          prefixIcon: const Icon(Icons.search, color: AppTheme.neonBlue),
          filled: true,
          fillColor: AppTheme.surfaceColor,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(16),
            borderSide: BorderSide.none,
          ),
          suffixIcon: _isSearchingClients 
              ? const SizedBox(width: 48, child: Center(child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))))
              : null,
        ),
      ),
    );
  }

  Widget _buildNoClientsState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.person_search, size: 64, color: AppTheme.textSecondary.withOpacity(0.2)),
          const SizedBox(height: 16),
          const Text('No se han encontrado clientes', style: TextStyle(color: AppTheme.textSecondary)),
        ],
      ),
    );
  }

  Widget _buildClientCobroCard(Map<String, dynamic> client) {
    final String name = (client['name'] ?? 'Cliente').toString();
    final String code = (client['code'] ?? '').toString();
    final pending = _cobrosProvider.pendingForClient(code);

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      color: AppTheme.surfaceColor,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: pending > 0
            ? BorderSide(color: AppTheme.warning.withOpacity(0.4))
            : BorderSide.none,
      ),
      child: InkWell(
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (context) => ChangeNotifierProvider.value(
                value: _cobrosProvider,
                child: CobroDetailScreen(
                  codigoCliente: code,
                  nombreCliente: name,
                ),
              ),
            ),
          );
        },
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              CircleAvatar(
                backgroundColor: AppTheme.neonBlue.withOpacity(0.1),
                child: Text(
                  name.isNotEmpty ? name[0].toUpperCase() : '?',
                  style: const TextStyle(
                    color: AppTheme.neonBlue,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                      ),
                    ),
                    Text(
                      'Código: $code',
                      style: const TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              if (pending > 0) ...[
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: AppTheme.warning.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                      color: AppTheme.warning.withOpacity(0.3),
                    ),
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text(
                        'Pendiente',
                        style: TextStyle(
                          color: AppTheme.warning,
                          fontSize: 9,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      Text(
                        '${pending.toStringAsFixed(2)} €',
                        style: const TextStyle(
                          color: AppTheme.warning,
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
              ],
              const Icon(
                Icons.arrow_forward_ios,
                size: 16,
                color: AppTheme.textSecondary,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
