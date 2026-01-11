/// COBROS PAGE - PÁGINA PRINCIPAL
/// Pestaña de cobros y entregas profesional

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/app_theme.dart';
import '../../providers/cobros_provider.dart';
import '../../data/models/cobros_models.dart';
import '../widgets/albaran_card.dart';
import '../widgets/cobros_summary_card.dart';
import '../widgets/entrega_detail_sheet.dart';
import '../widgets/cobros_filters.dart';

class CobrosPage extends StatefulWidget {
  final String employeeCode;
  final bool isJefeVentas;

  const CobrosPage({
    super.key,
    required this.employeeCode,
    this.isJefeVentas = false,
  });

  @override
  State<CobrosPage> createState() => _CobrosPageState();
}

class _CobrosPageState extends State<CobrosPage> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  late CobrosProvider _cobrosProvider;  final _currencyFormat = NumberFormat.currency(locale: 'es_ES', symbol: '€');

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _cobrosProvider = CobrosProvider(
      employeeCode: widget.employeeCode,
      isRepartidor: !widget.isJefeVentas,
    );
    _cobrosProvider.cargarAlbaranesPendientes();
  }

  @override
  void dispose() {
    _tabController.dispose();
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
            // Header con gradiente premium
            _buildHeader(),
            
            // Tabs
            _buildTabBar(),
            
            // Contenido
            Expanded(
              child: TabBarView(
                controller: _tabController,
                children: [
                  _buildEntregasTab(),
                  _buildCobrosTab(),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Consumer<CobrosProvider>(
      builder: (context, provider, _) {
        return Container(
          padding: const EdgeInsets.fromLTRB(24, 20, 24, 16),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                AppTheme.surfaceColor,
                AppTheme.surfaceColor.withOpacity(0.8),
              ],
            ),
            border: Border(
              bottom: BorderSide(
                color: AppTheme.neonBlue.withOpacity(0.2),
                width: 1,
              ),
            ),
          ),
          child: Row(
            children: [
              // Título con icono animado
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [
                      AppTheme.neonBlue.withOpacity(0.2),
                      AppTheme.neonPurple.withOpacity(0.2),
                    ],
                  ),
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: [
                    BoxShadow(
                      color: AppTheme.neonBlue.withOpacity(0.2),
                      blurRadius: 12,
                    ),
                  ],
                ),
                child: const Icon(
                  Icons.receipt_long,
                  color: AppTheme.neonBlue,
                  size: 28,
                ),
              ),
              const SizedBox(width: 16),
              
              // Título y subtítulo
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Cobros & Entregas',
                      style: TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.bold,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                    Text(
                      DateFormat('EEEE, d MMMM yyyy', 'es').format(DateTime.now()),
                      style: TextStyle(
                        fontSize: 13,
                        color: AppTheme.textSecondary.withOpacity(0.8),
                      ),
                    ),
                  ],
                ),
              ),
              
              // Estadísticas rápidas
              _buildQuickStat(
                icon: Icons.local_shipping,
                label: 'Pendientes',
                value: '${provider.totalEntregasPendientes}',
                color: Colors.orange,
              ),
              const SizedBox(width: 16),
              _buildQuickStat(
                icon: Icons.check_circle,
                label: 'Completadas',
                value: '${provider.totalEntregasCompletadas}',
                color: Colors.green,
              ),
              const SizedBox(width: 16),
              _buildQuickStat(
                icon: Icons.warning_amber,
                label: 'CTR',
                value: '${provider.totalCTRPendientes}',
                color: Colors.red,
              ),
              const SizedBox(width: 16),
              _buildQuickStat(
                icon: Icons.euro,
                label: 'Total Pendiente',
                value: _currencyFormat.format(provider.totalImportePendiente),
                color: AppTheme.neonBlue,
                isLarge: true,
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildQuickStat({
    required IconData icon,
    required String label,
    required String value,
    required Color color,
    bool isLarge = false,
  }) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: isLarge ? 20 : 16,
        vertical: 12,
      ),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: color.withOpacity(0.3),
          width: 1,
        ),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: isLarge ? 24 : 20),
          const SizedBox(width: 10),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: TextStyle(
                  fontSize: 10,
                  color: color.withOpacity(0.8),
                  fontWeight: FontWeight.w500,
                ),
              ),
              Text(
                value,
                style: TextStyle(
                  fontSize: isLarge ? 18 : 16,
                  fontWeight: FontWeight.bold,
                  color: color,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildTabBar() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: Colors.white.withOpacity(0.05),
        ),
      ),
      child: TabBar(
        controller: _tabController,
        indicator: BoxDecoration(
          gradient: LinearGradient(
            colors: [AppTheme.neonBlue, AppTheme.neonPurple],
          ),
          borderRadius: BorderRadius.circular(14),
          boxShadow: [
            BoxShadow(
              color: AppTheme.neonBlue.withOpacity(0.3),
              blurRadius: 8,
            ),
          ],
        ),
        indicatorSize: TabBarIndicatorSize.tab,
        labelColor: Colors.white,
        unselectedLabelColor: AppTheme.textSecondary,
        labelStyle: const TextStyle(fontWeight: FontWeight.w600),
        dividerHeight: 0,
        tabs: const [
          Tab(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.local_shipping, size: 20),
                SizedBox(width: 8),
                Text('Entregas'),
              ],
            ),
          ),
          Tab(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.payments, size: 20),
                SizedBox(width: 8),
                Text('Cobros'),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEntregasTab() {
    return Consumer<CobrosProvider>(
      builder: (context, provider, _) {
        if (provider.isLoading) {
          return const Center(
            child: CircularProgressIndicator(color: AppTheme.neonBlue),
          );
        }

        if (provider.error != null) {
          return _buildErrorState(provider.error!);
        }

        final albaranes = provider.albaranesFiltrados;

        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Panel izquierdo: Filtros y resumen
            Container(
              width: 280,
              margin: const EdgeInsets.all(16),
              child: Column(
                children: [
                  // Filtros
                  CobrosFilters(
                    onEstadoChanged: provider.setFiltroEstado,
                    onClienteChanged: provider.setFiltroCliente,
                    estadoActual: provider.filtroEstado,
                  ),
                  
                  const SizedBox(height: 16),
                  
                  // Resumen del día
                  CobrosSummaryCard(
                    totalPendientes: provider.totalEntregasPendientes,
                    totalCompletadas: provider.totalEntregasCompletadas,
                    totalCTR: provider.totalCTRPendientes,
                    importeTotal: provider.totalImportePendiente,
                  ),
                ],
              ),
            ),
            
            // Panel derecho: Lista de albaranes
            Expanded(
              child: albaranes.isEmpty
                  ? _buildEmptyState()
                  : ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: albaranes.length,
                      itemBuilder: (context, index) {
                        final albaran = albaranes[index];
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: AlbaranCard(
                            albaran: albaran,
                            onTap: () => _showEntregaDetail(albaran),
                            onQuickComplete: () => _completarEntrega(albaran),
                          ),
                        );
                      },
                    ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildCobrosTab() {
    return Consumer<CobrosProvider>(
      builder: (context, provider, _) {
        return Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: AppTheme.neonPurple.withOpacity(0.1),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.payments,
                  size: 64,
                  color: AppTheme.neonPurple,
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'Gestión de Cobros',
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                  color: AppTheme.textPrimary,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Selecciona un cliente para ver sus cobros pendientes',
                style: TextStyle(
                  fontSize: 14,
                  color: AppTheme.textSecondary.withOpacity(0.7),
                ),
              ),
              const SizedBox(height: 32),
              // Buscador de cliente
              Container(
                width: 400,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                decoration: BoxDecoration(
                  color: AppTheme.surfaceColor,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: Colors.white10),
                ),
                child: TextField(
                  decoration: const InputDecoration(
                    hintText: 'Buscar cliente por código o nombre...',
                    hintStyle: TextStyle(color: AppTheme.textSecondary),
                    prefixIcon: Icon(Icons.search, color: AppTheme.textSecondary),
                    border: InputBorder.none,
                  ),
                  style: const TextStyle(color: AppTheme.textPrimary),
                  onSubmitted: (value) {
                    if (value.isNotEmpty) {
                      provider.cargarCobrosPendientes(value);
                    }
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: Colors.green.withOpacity(0.1),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.check_circle_outline,
              size: 64,
              color: Colors.green,
            ),
          ),
          const SizedBox(height: 24),
          const Text(
            '¡Todo entregado!',
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.bold,
              color: AppTheme.textPrimary,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'No hay entregas pendientes para hoy',
            style: TextStyle(
              fontSize: 14,
              color: AppTheme.textSecondary.withOpacity(0.7),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorState(String error) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline, size: 64, color: AppTheme.error),
          const SizedBox(height: 16),
          Text(
            error,
            style: const TextStyle(color: AppTheme.textSecondary),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          ElevatedButton.icon(
            onPressed: () => _cobrosProvider.cargarAlbaranesPendientes(),
            icon: const Icon(Icons.refresh),
            label: const Text('Reintentar'),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.neonBlue,
              foregroundColor: Colors.white,
            ),
          ),
        ],
      ),
    );
  }

  void _showEntregaDetail(Albaran albaran) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => EntregaDetailSheet(
        albaran: albaran,
        onComplete: () {
          Navigator.pop(context);
          _completarEntrega(albaran);
        },
      ),
    );
  }

  Future<void> _completarEntrega(Albaran albaran) async {
    final success = await _cobrosProvider.completarEntrega(albaran.id);
    if (success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Row(
            children: [
              const Icon(Icons.check_circle, color: Colors.white),
              const SizedBox(width: 12),
              Text('Entrega ${albaran.numeroAlbaran} completada'),
            ],
          ),
          backgroundColor: Colors.green,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      );
    }
  }
}
