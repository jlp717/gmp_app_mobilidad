import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/entregas_provider.dart';
import '../widgets/entrega_card.dart';
import '../widgets/entregas_header.dart';
import 'albaran_detail_page.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';

/// Página principal de entregas para el repartidor
class EntregasPage extends StatefulWidget {
  const EntregasPage({super.key});

  @override
  State<EntregasPage> createState() => _EntregasPageState();
}

class _EntregasPageState extends State<EntregasPage>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    
    // Cargar entregas al iniciar
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<EntregasProvider>().cargarAlbaranesPendientes();
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.surfaceColor,
      body: SafeArea(
        child: Column(
          children: [
            // Header con resumen
            EntregasHeader(),
            
            // Tabs
            Container(
              color: AppTheme.surfaceColor,
              child: TabBar(
                controller: _tabController,
                labelColor: Theme.of(context).primaryColor,
                unselectedLabelColor: Colors.grey,
                indicatorColor: Theme.of(context).primaryColor,
                tabs: [
                  Tab(
                    child: Consumer<EntregasProvider>(
                      builder: (_, p, __) => Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.pending_actions, size: 18),
                          const SizedBox(width: 4),
                          Text('Pendientes (${p.totalPendientes})'),
                        ],
                      ),
                    ),
                  ),
                  const Tab(
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.local_shipping, size: 18),
                        SizedBox(width: 4),
                        Text('En Ruta'),
                      ],
                    ),
                  ),
                  Tab(
                    child: Consumer<EntregasProvider>(
                      builder: (_, p, __) => Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.check_circle, size: 18),
                          const SizedBox(width: 4),
                          Text('Entregados (${p.totalEntregados})'),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            
            // Contenido
            Expanded(
              child: Consumer<EntregasProvider>(
                builder: (context, provider, _) {
                  if (provider.isLoading) {
                    return const Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          CircularProgressIndicator(),
                          SizedBox(height: 16),
                          Text('Cargando entregas del día...'),
                        ],
                      ),
                    );
                  }

                  if (provider.error != null) {
                    return Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.error_outline,
                            size: Responsive.iconSize(
                              context,
                              phone: 48,
                              desktop: 64,
                            ),
                            color: Colors.red.shade300,
                          ),
                          const SizedBox(height: 16),
                          Text(provider.error!,
                               textAlign: TextAlign.center),
                          const SizedBox(height: 16),
                          ElevatedButton.icon(
                            onPressed: () => provider.cargarAlbaranesPendientes(),
                            icon: const Icon(Icons.refresh),
                            label: const Text('Reintentar'),
                          ),
                        ],
                      ),
                    );
                  }

                  return TabBarView(
                    controller: _tabController,
                    children: [
                      // Tab Pendientes
                      _buildListaAlbaranes(provider.albaranesPendientes),
                      
                      // Tab En Ruta
                      _buildListaAlbaranes(provider.albaranesEnRuta),
                      
                      // Tab Entregados
                      _buildListaAlbaranes(provider.albaranesEntregados),
                    ],
                  );
                },
              ),
            ),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () {
          context.read<EntregasProvider>().cargarAlbaranesPendientes();
        },
        icon: const Icon(Icons.refresh),
        label: const Text('Actualizar'),
      ),
    );
  }

  Widget _buildListaAlbaranes(List<AlbaranEntrega> albaranes) {
    if (albaranes.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.inbox_outlined,
              size: Responsive.iconSize(
                context,
                phone: 48,
                desktop: 64,
              ),
              color: Colors.grey.shade400,
            ),
            const SizedBox(height: 16),
            Text(
              'No hay entregas en esta sección',
              style: TextStyle(
                color: Colors.grey.shade600,
                fontSize: Responsive.fontSize(
                  context,
                  small: 13,
                  large: 16,
                ),
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () => context.read<EntregasProvider>().cargarAlbaranesPendientes(),
      child: ListView.builder(
        padding: EdgeInsets.all(
          Responsive.padding(context, small: 10, large: 16),
        ),
        itemCount: albaranes.length,
        itemBuilder: (context, index) {
          final albaran = albaranes[index];
          return EntregaCard(
            albaran: albaran,
            onTap: () => _abrirDetalle(albaran),
          );
        },
      ),
    );
  }

  void _abrirDetalle(AlbaranEntrega albaran) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ChangeNotifierProvider.value(
          value: context.read<EntregasProvider>(),
          child: AlbaranDetailPage(albaran: albaran),
        ),
      ),
    );
  }
}
