/// Client Search Dialog for Pedidos
/// =================================
/// Bottom sheet with debounced search to select a client for the order

import 'dart:async';
import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../../clients/data/clients_service.dart';

class ClientSearchDialog {
  /// Show the client search bottom sheet.
  /// Returns a Map with 'code' and 'name' keys if a client is selected.
  static Future<Map<String, String>?> show(
    BuildContext context, {
    required String vendedorCodes,
  }) {
    return showModalBottomSheet<Map<String, String>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.darkSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => DraggableScrollableSheet(
        initialChildSize: 0.85,
        minChildSize: 0.5,
        maxChildSize: 0.95,
        expand: false,
        builder: (ctx, scrollCtrl) => _ClientSearchBody(
          vendedorCodes: vendedorCodes,
          scrollController: scrollCtrl,
        ),
      ),
    );
  }
}

class _ClientSearchBody extends StatefulWidget {
  final String vendedorCodes;
  final ScrollController scrollController;

  const _ClientSearchBody({
    required this.vendedorCodes,
    required this.scrollController,
  });

  @override
  State<_ClientSearchBody> createState() => _ClientSearchBodyState();
}

class _ClientSearchBodyState extends State<_ClientSearchBody> {
  final _searchController = TextEditingController();
  Timer? _debounce;
  List<Map<String, dynamic>> _clients = [];
  bool _isLoading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadClients();
  }

  @override
  void dispose() {
    _searchController.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  void _onSearchChanged(String query) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      _loadClients(search: query);
    });
  }

  Future<void> _loadClients({String? search}) async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final clients = await ClientsService.getClientsList(
        vendedorCodes: widget.vendedorCodes,
        search: search,
        limit: 100,
      );
      if (mounted) {
        setState(() {
          _clients = clients;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Handle bar
        Center(
          child: Container(
            margin: const EdgeInsets.only(top: 8, bottom: 4),
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: Colors.white24,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
        ),
        // Title
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              const Icon(Icons.person_search, color: AppTheme.neonBlue, size: 22),
              const SizedBox(width: 8),
              Text(
                'Seleccionar cliente',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: Responsive.fontSize(context, small: 17, large: 20),
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
        ),
        // Search field
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: TextField(
            controller: _searchController,
            autofocus: true,
            style: const TextStyle(color: Colors.white),
            decoration: InputDecoration(
              hintText: 'Buscar por nombre, codigo, NIF, ciudad...',
              hintStyle: const TextStyle(color: Colors.white38),
              prefixIcon: const Icon(Icons.search, color: Colors.white54),
              suffixIcon: _searchController.text.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear, color: Colors.white54, size: 18),
                      onPressed: () {
                        _searchController.clear();
                        _loadClients();
                      },
                    )
                  : null,
              filled: true,
              fillColor: AppTheme.darkCard,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: AppTheme.borderColor),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: AppTheme.borderColor),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: AppTheme.neonBlue),
              ),
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            ),
            onChanged: _onSearchChanged,
          ),
        ),
        const SizedBox(height: 4),
        // Results
        Expanded(
          child: _buildResults(),
        ),
      ],
    );
  }

  Widget _buildResults() {
    if (_isLoading && _clients.isEmpty) {
      return const Center(
        child: CircularProgressIndicator(color: AppTheme.neonBlue),
      );
    }

    if (_error != null && _clients.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: AppTheme.error, size: 40),
            const SizedBox(height: 8),
            Text('Error al cargar clientes', style: TextStyle(color: Colors.white70, fontSize: Responsive.fontSize(context, small: 14, large: 16))),
            const SizedBox(height: 8),
            TextButton.icon(
              onPressed: () => _loadClients(search: _searchController.text),
              icon: const Icon(Icons.refresh, color: AppTheme.neonBlue),
              label: const Text('Reintentar', style: TextStyle(color: AppTheme.neonBlue)),
            ),
          ],
        ),
      );
    }

    if (_clients.isEmpty) {
      return Center(
        child: Text(
          'No se encontraron clientes',
          style: TextStyle(color: Colors.white54, fontSize: Responsive.fontSize(context, small: 14, large: 16)),
        ),
      );
    }

    return Stack(
      children: [
        ListView.builder(
          controller: widget.scrollController,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          itemCount: _clients.length,
          itemBuilder: (ctx, i) => _buildClientTile(_clients[i]),
        ),
        if (_isLoading)
          const Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: LinearProgressIndicator(color: AppTheme.neonBlue, backgroundColor: Colors.transparent),
          ),
      ],
    );
  }

  Widget _buildClientTile(Map<String, dynamic> client) {
    final code = (client['CODIGOCLIENTE'] ?? client['code'] ?? '').toString().trim();
    final name = (client['NOMBRECLIENTE'] ?? client['name'] ?? '').toString().trim();
    final city = (client['CIUDAD'] ?? client['city'] ?? '').toString().trim();
    final nif = (client['NIF'] ?? client['nif'] ?? '').toString().trim();

    return Card(
      color: AppTheme.darkCard,
      margin: const EdgeInsets.only(bottom: 4),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: AppTheme.borderColor, width: 0.5),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: () {
          Navigator.pop(context, {'code': code, 'name': name});
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: AppTheme.neonBlue.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Center(
                  child: Icon(Icons.storefront_outlined, color: AppTheme.neonBlue, size: 18),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w600,
                        fontSize: Responsive.fontSize(context, small: 13, large: 15),
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        Text(
                          code,
                          style: TextStyle(
                            color: AppTheme.neonBlue,
                            fontSize: Responsive.fontSize(context, small: 11, large: 12),
                          ),
                        ),
                        if (city.isNotEmpty) ...[
                          Text(' · ', style: TextStyle(color: Colors.white38, fontSize: Responsive.fontSize(context, small: 11, large: 12))),
                          Flexible(
                            child: Text(
                              city,
                              style: TextStyle(color: Colors.white54, fontSize: Responsive.fontSize(context, small: 11, large: 12)),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                        if (nif.isNotEmpty) ...[
                          Text(' · ', style: TextStyle(color: Colors.white38, fontSize: Responsive.fontSize(context, small: 11, large: 12))),
                          Text(
                            nif,
                            style: TextStyle(color: Colors.white54, fontSize: Responsive.fontSize(context, small: 11, large: 12)),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: Colors.white24, size: 18),
            ],
          ),
        ),
      ),
    );
  }
}
