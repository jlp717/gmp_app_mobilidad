import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../data/clients_service.dart';
import '../../../objectives/presentation/pages/enhanced_client_matrix_page.dart';

import '../../../../core/widgets/smart_sync_header.dart'; // Import Sync Header
import '../../../../core/widgets/modern_loading.dart';
import 'package:provider/provider.dart';
import '../../../../core/providers/filter_provider.dart';
import '../../../../core/widgets/global_vendor_selector.dart';
import '../../../../core/providers/auth_provider.dart';
import '../../../../core/utils/responsive.dart';

/// Simple Clients List Page with debounced search
class SimpleClientListPage extends StatefulWidget {
  final String employeeCode;
  final bool isJefeVentas;
  
  const SimpleClientListPage({super.key, required this.employeeCode, this.isJefeVentas = false});

  @override
  State<SimpleClientListPage> createState() => _SimpleClientListPageState();
}

class _SimpleClientListPageState extends State<SimpleClientListPage> {
  List<Map<String, dynamic>> _clients = [];
  bool _isLoading = true;
  String? _error;
  String _searchQuery = '';
  DateTime? _lastFetchTime; // Track last sync
  // final _currencyFormat = NumberFormat.currency(symbol: '€', decimalDigits: 0);
  Timer? _debounceTimer;
  final TextEditingController _searchController = TextEditingController();

  List<Map<String, dynamic>> _availableVendors = [];
  String? _selectedVendorCode = ''; // Default to empty string (All) for Manager view, so it matches dropdown item

  @override
  void initState() {
    super.initState();
    _loadClients();
  }

  // ... (dispose and _onSearchChanged remain same)

  @override
  void dispose() {
    _debounceTimer?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    _searchQuery = value;
    _debounceTimer?.cancel();
    _debounceTimer = Timer(const Duration(milliseconds: 400), () {
      if (value.length > 2 || value.isEmpty) {
        _loadClients(query: value);
      }
    });
  }

  Future<void> _loadClients({String? query}) async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      // Logic: If Manager + Selected Vendor -> Filter by that.
      // If Manager + No selection -> Show All (pass no code).
      // If Rep -> Show only theirs (pass employeeCode).
      
      String? codesToPass;
      if (widget.isJefeVentas) {
         // Use FilterProvider
         codesToPass = context.read<FilterProvider>().selectedVendor; 
      } else {
         codesToPass = widget.employeeCode;
      }

      final results = await ClientsService.getClientsList(
        vendedorCodes: codesToPass,
        search: query,
      );

      setState(() {
        _clients = results;
        _isLoading = false;
        _lastFetchTime = DateTime.now();
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  // ... (_navigateToClientMatrix)


  void _openWhatsApp(Map<String, dynamic> client) {
    // Backend now returns phones array with simple objects
    final phones = (client['phones'] as List?)?.map((p) => Map<String, dynamic>.from(p as Map)).toList() ?? [];
    
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
      backgroundColor: AppTheme.surfaceColor,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Enviar WhatsApp', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
            const SizedBox(height: 8),
            const Text('Selecciona el número:', style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
            const SizedBox(height: 12),
            if (phones.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: Text('No hay teléfonos guardados', style: TextStyle(color: AppTheme.textSecondary)),
              ),
            ...phones.map((p) => ListTile(
              leading: const Icon(Icons.phone_android, color: Color(0xFF25D366)),
              title: Text((p['number'] as String?) ?? ''),
              subtitle: Text((p['type'] as String?) ?? 'Teléfono'),
              onTap: () {
                Navigator.pop(ctx);
                _launchWhatsApp((p['number'] as String?) ?? '');
              },
            )),
            const Divider(),
            ListTile(
              leading: const Icon(Icons.dialpad, color: AppTheme.neonPink),
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
        backgroundColor: AppTheme.surfaceColor,
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
            child: const Text('Cancelar', style: TextStyle(color: Colors.grey)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, controller.text),
            style: ElevatedButton.styleFrom(
              backgroundColor: isWhatsApp ? const Color(0xFF25D366) : AppTheme.neonBlue,
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

  void _launchWhatsApp(String phone) async {
    // Clean phone number - remove non-digits except +
    String cleanPhone = phone.replaceAll(RegExp(r'[^0-9+]'), '');
    // Add Spain prefix if not present
    if (!cleanPhone.startsWith('+') && !cleanPhone.startsWith('34')) {
      cleanPhone = '34$cleanPhone';
    }
    if (cleanPhone.startsWith('+')) {
      cleanPhone = cleanPhone.substring(1);
    }

    // Personal identification
    final auth = context.read<AuthProvider>();
    final nombreComercial = auth.currentUser?.name ?? 'tu comercial';
    final manana = DateTime.now().add(const Duration(days: 1));
    final fecha = '${manana.day}/${manana.month}/${manana.year}';

    // Professional message
    final message = Uri.encodeComponent(
      'Hola, soy $nombreComercial de Mari Pepa. '
      'Mañana día $fecha tenemos visita. '
      '¿Necesitas cualquier cosilla?'
    );

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
          builder: (context) => EnhancedClientMatrixPage(
            clientCode: code,
            clientName: name,
            isJefeVentas: widget.isJefeVentas,
          ),
        ),
      );
    }
  }


  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Smart Sync Header
        SmartSyncHeader(
          title: 'Cartera de Clientes',
          subtitle: '${_clients.length} clientes encontrados',
          lastSync: _lastFetchTime,
          isLoading: _isLoading && _clients.isNotEmpty,
          onSync: () => _loadClients(query: _searchQuery),
          // error: _error, // Error is not in constructor anymore in updated file, wait.
        ),

        // Header & Filters
        Container(
          padding: EdgeInsets.all(Responsive.padding(context, small: 12, large: 16)),
          child: Column(
            children: [
              if (!Responsive.isLandscapeCompact(context))
                Row(
                  children: [
                    Icon(Icons.people, color: AppTheme.neonGreen, size: Responsive.iconSize(context, phone: 22, desktop: 28)),
                    const SizedBox(width: 12),
                    Text('Clientes', style: Theme.of(context).textTheme.headlineMedium),
                    const Spacer(),
                    Text(
                      '${_clients.length} clientes',
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: AppTheme.textSecondary,
                      ),
                    ),
                  ],
                ),
              if (widget.isJefeVentas) ...[
                 const SizedBox(height: 12),
                 GlobalVendorSelector(
                   isJefeVentas: true,
                   onChanged: () {
                     // The provider updates automatically, we just need to reload clients
                     _loadClients();
                   },
                 ),
              ],
            ],
          ),
        ),

        // Search Bar
        Padding(
          padding: EdgeInsets.symmetric(horizontal: Responsive.padding(context, small: 12, large: 16)),
          child: TextField(
            decoration: InputDecoration(
              hintText: 'Buscar cliente, NIF, Ciudad, Código...',
              prefixIcon: const Icon(Icons.search),
              filled: true,
              fillColor: AppTheme.surfaceColor,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide.none,
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
        padding: EdgeInsets.all(Responsive.padding(context, small: 24, large: 40)),
        child: ModernLoading(message: 'Cargando cartera de clientes...'),
      );
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.error_outline, size: 64, color: AppTheme.error),
            const SizedBox(height: 16),
            Text('Error: $_error'),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () => _loadClients(),
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
            Icon(Icons.people_outline, size: 64, color: AppTheme.textSecondary),
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
      onRefresh: () => _loadClients(query: _searchQuery),
      child: ListView.builder(
        padding: EdgeInsets.symmetric(horizontal: Responsive.padding(context, small: 12, large: 16)),
        itemCount: _clients.length,
        itemBuilder: (context, index) {
          final client = _clients[index];
          return _ClientCard(
            client: client,
            isJefeVentas: widget.isJefeVentas,
            onTap: () => _navigateToClientMatrix(client),
            onWhatsAppTap: () => _openWhatsApp(client),
          );
        },
      ),
    );
  }
}

class _ClientCard extends StatelessWidget {
  final Map<String, dynamic> client;
  final bool isJefeVentas;
  final VoidCallback? onTap;
  final VoidCallback? onWhatsAppTap;

  const _ClientCard({required this.client, this.isJefeVentas = false, this.onTap, this.onWhatsAppTap});

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
      color: AppTheme.surfaceColor,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: EdgeInsets.all(cardPadding),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Avatar
                  CircleAvatar(
                    radius: avatarRadius,
                    backgroundColor: AppTheme.neonGreen.withOpacity(0.2),
                    child: Text(
                      name.isNotEmpty ? name[0].toUpperCase() : 'C',
                      style: TextStyle(
                        color: AppTheme.neonGreen,
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
                          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.bold,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            Icon(Icons.location_on, size: 14, color: AppTheme.textSecondary),
                            const SizedBox(width: 4),
                            Expanded(
                              child: Text(
                                city.isNotEmpty ? city : 'Sin ciudad',
                                style: Theme.of(context).textTheme.bodySmall?.copyWith(
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
                              Icon(Icons.phone, size: 14, color: AppTheme.textSecondary),
                              const SizedBox(width: 4),
                              Text(
                                phone,
                                style: Theme.of(context).textTheme.bodySmall?.copyWith(
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
                              const Icon(Icons.person_outline, size: 14, color: AppTheme.neonPurple),
                              const SizedBox(width: 4),
                              Expanded(
                                child: Text(
                                  'Rep: ${client['vendorName']}',
                                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                    color: AppTheme.neonPurple,
                                    fontWeight: FontWeight.bold,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),

                  // Stats
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        CurrencyFormatter.formatWhole(totalPurchases),
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
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
                        const SizedBox(height: 2),
                        Text(
                          'Última: $lastPurchase',
                          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: AppTheme.textTertiary,
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
                      icon: const Icon(Icons.chat, color: Color(0xFF25D366), size: 24),
                      tooltip: 'WhatsApp',
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                    ),
                  ],
                ],
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
final String route = client['route'] as String? ?? '';
final String visitDays = client['visitDaysShort'] as String? ?? '';
final String deliveryDays = client['deliveryDaysShort'] as String? ?? '';

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
            color: AppTheme.neonPurple.withOpacity(0.15),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.route, size: 12, color: AppTheme.neonPurple),
              const SizedBox(width: 4),
              Text(
                'Ruta $route', 
                style: TextStyle(fontSize: 11, color: AppTheme.neonPurple, fontWeight: FontWeight.w500),
              ),
            ],
          ),
        ),
      
      // Visit Days Badge
      if (visitDays.isNotEmpty)
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            color: AppTheme.neonBlue.withOpacity(0.15),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.calendar_today, size: 12, color: AppTheme.neonBlue),
              const SizedBox(width: 4),
              Text(
                'Visita: $visitDays',
                style: TextStyle(fontSize: 11, color: AppTheme.neonBlue, fontWeight: FontWeight.w500),
              ),
            ],
          ),
        ),
      
      // Delivery Days Badge
      if (deliveryDays.isNotEmpty)
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            color: AppTheme.neonGreen.withOpacity(0.15),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.local_shipping, size: 12, color: AppTheme.neonGreen),
              const SizedBox(width: 4),
              Text(
                'Reparto: $deliveryDays',
                style: TextStyle(fontSize: 11, color: AppTheme.neonGreen, fontWeight: FontWeight.w500),
              ),
            ],
          ),
        ),
    ],
  ),
);
}
}
