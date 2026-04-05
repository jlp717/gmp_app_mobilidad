import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../entregas/providers/entregas_provider.dart';
import '../widgets/entrega_card.dart';
import '../widgets/entregas_header.dart';
import 'albaran_detail_page.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../../../core/widgets/shimmer_skeleton.dart';
import '../../../../core/widgets/error_state_widget.dart';
import '../../../../core/widgets/optimized_list.dart';

/// Página principal de entregas para el repartidor
class EntregasPage extends ConsumerStatefulWidget {
  const EntregasPage({super.key});

  @override
  ConsumerState<EntregasPage> createState() => _EntregasPageState();
}

class _EntregasPageState extends ConsumerState<EntregasPage>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);

    // Cargar entregas al iniciar
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(entregasProvider.notifier).cargarAlbaranesPendientes();
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(entregasProvider);

    return Scaffold(
      backgroundColor: AppTheme.surfaceColor,
      body: SafeArea(
        child: Column(
          children: [
            // Header con resumen
            const EntregasHeader(),

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
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.pending_actions, size: 18),
                        const SizedBox(width: 4),
                        Text('Pendientes (${state.totalPendientes})'),
                      ],
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
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.check_circle, size: 18),
                        const SizedBox(width: 4),
                        Text('Entregados (${state.totalEntregados})'),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            // Contenido
            Expanded(
              child: Builder(
                builder: (context) {
                  if (state.isLoading) {
                    return const SkeletonList(itemCount: 5, itemHeight: 100);
                  }

                  if (state.error != null) {
                    return ErrorStateWidget(
                      message: state.error!,
                      onRetry: () => ref.read(entregasProvider.notifier).cargarAlbaranesPendientes(),
                    );
                  }

                  return TabBarView(
                    controller: _tabController,
                    children: [
                      // Tab Pendientes
                      _buildListaAlbaranes(state.albaranesPendientes),

                      // Tab En Ruta
                      _buildListaAlbaranes(state.albaranesEnRuta),

                      // Tab Entregados
                      _buildListaAlbaranes(state.albaranesEntregados),
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
          ref.read(entregasProvider.notifier).cargarAlbaranesPendientes();
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
      onRefresh: () => ref.read(entregasProvider.notifier).cargarAlbaranesPendientes(),
      child: OptimizedListView(
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
        builder: (_) => AlbaranDetailPage(albaran: albaran),
      ),
    );
  }
}
