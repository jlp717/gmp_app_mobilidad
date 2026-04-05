import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../../../core/widgets/global_vendor_selector.dart';
import '../../../../core/providers/filter_provider.dart';
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
  List<Map<String, dynamic>> _foundClients = [];
  bool _isSearchingClients = false;
  final TextEditingController _searchController = TextEditingController();
  Timer? _debounceTimer;

  // Single source of truth: Riverpod provider
  CobrosProvider get _provider =>
      ref.read(cobrosProvider(CobrosParams(employeeCode: widget.employeeCode)));

  @override
  void initState() {
    super.initState();
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
      if (mounted) setState(() => _foundClients = results);
    } catch (_) {}
    if (mounted) setState(() => _isSearchingClients = false);
  }

  void _loadPendingSummary() {
    final selectedVendor = ref.read(selectedVendorProvider);
    final authState = ref.watch(authProvider).value;
    final allVendorCodes = authState?.vendedorCodes ?? [];

    if (selectedVendor != null && selectedVendor.isNotEmpty) {
      _provider.cargarPendingSummary(selectedVendor);
    } else if (allVendorCodes.isNotEmpty) {
      _provider.cargarPendingSummary(null, vendedorCodes: allVendorCodes);
    } else {
      _provider.cargarPendingSummary(null);
    }
  }

  void _onSearchChanged(String query) {
    if (_debounceTimer?.isActive ?? false) _debounceTimer!.cancel();
    _debounceTimer = Timer(const Duration(milliseconds: 500), () => _loadClients(query));
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
    // Watch provider for reactive state updates
    final cobros = ref.watch(cobrosProvider(CobrosParams(employeeCode: widget.employeeCode)));

    return Scaffold(
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
                ? _buildNoClientsState(cobros.grandTotal)
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
          bottom: BorderSide(color: AppTheme.neonBlue.withOpacity(0.2), width: 1),
        ),
      ),
      child: Row(
        children: [
          const Icon(Icons.account_balance_wallet, color: AppTheme.neonBlue, size: 28),
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
              hintStyle: TextStyle(color: AppTheme.textSecondary.withOpacity(0.6)),
              prefixIcon: Icon(Icons.search, color: AppTheme.neonBlue.withOpacity(0.7)),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide(color: AppTheme.neonBlue.withOpacity(0.3)),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide(color: AppTheme.neonBlue.withOpacity(0.3)),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide(color: AppTheme.neonBlue, width: 2),
              ),
              filled: true,
              fillColor: AppTheme.surfaceColor,
              suffixIcon: _isSearchingClients
                  ? const SizedBox(
                      width: 48,
                      child: Center(
                        child: SizedBox(
                          width: 20, height: 20,
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

  Widget _buildNoClientsState(double grandTotal) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.person_search, size: 64, color: AppTheme.textSecondary.withOpacity(0.2)),
          const SizedBox(height: 16),
          const Text('No se han encontrado clientes',
              style: TextStyle(color: AppTheme.textSecondary)),
          if (grandTotal > 0)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                'Total pendiente: ${grandTotal.toStringAsFixed(2)} €',
                style: TextStyle(
                  fontSize: Responsive.fontSize(context, small: 12, large: 14),
                  color: AppTheme.warning,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildClientCobroCard(Map<String, dynamic> client) {
    final String name = (client['name'] ?? 'Cliente').toString();
    final String code = (client['code'] ?? '').toString();
    final pending = _provider.pendingForClient(code);

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
              CircleAvatar(
                backgroundColor: AppTheme.neonBlue.withOpacity(0.1),
                child: Text(
                  name.isNotEmpty ? name[0].toUpperCase() : '?',
                  style: TextStyle(
                    color: AppTheme.neonBlue,
                    fontSize: Responsive.fontSize(context, small: 18, large: 24),
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
                      style: TextStyle(
                        fontSize: Responsive.fontSize(context, small: 14, large: 16),
                        fontWeight: FontWeight.w600,
                        color: Colors.white,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Código: $code',
                      style: TextStyle(
                        fontSize: Responsive.fontSize(context, small: 11, large: 13),
                        color: AppTheme.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              if (pending > 0)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: AppTheme.warning.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: AppTheme.warning.withOpacity(0.4)),
                  ),
                  child: Text(
                    '${pending.toStringAsFixed(2)} €',
                    style: TextStyle(
                      color: AppTheme.warning,
                      fontWeight: FontWeight.bold,
                      fontSize: Responsive.fontSize(context, small: 12, large: 14),
                    ),
                  ),
                ),
              if (pending == 0)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppTheme.success.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Icon(Icons.check_circle, color: AppTheme.success, size: 20),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
