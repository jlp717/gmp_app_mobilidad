/// Bolsa Comercial Page (Req #3)
/// ===============================
/// Pantalla principal de Bolsa Comercial: muestra saldo, acumulado,
/// consumido, % consumo, y lista de movimientos. JEFE_VENTAS puede
/// editar el límite mensual.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/providers/filter_provider.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/modern_loading.dart';
import 'package:gmp_app_mobilidad/features/bolsa/data/bolsa_models.dart';
import 'package:gmp_app_mobilidad/features/bolsa/providers/bolsa_provider.dart';

class BolsaPage extends ConsumerStatefulWidget {
  const BolsaPage({super.key});

  @override
  ConsumerState<BolsaPage> createState() => _BolsaPageState();
}

class _BolsaPageState extends ConsumerState<BolsaPage> {
  String? _lastLoadedVendor;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadIfNeeded());
  }

  void _loadIfNeeded() {
    if (!mounted) return;
    final vendor = _resolveVendor();
    if (vendor != null &&
        vendor.isNotEmpty &&
        vendor != _lastLoadedVendor &&
        vendor.toUpperCase() != 'ALL') {
      _lastLoadedVendor = vendor;
      ref.read(bolsaProvider).load(vendor);
    }
  }

  String? _resolveVendor() {
    final authState = ref.read(authProvider).value;
    final user = authState?.user;
    if (user == null) return null;
    if (user.isJefeVentas) {
      final selected = ref.read(selectedVendorProvider);
      return selected;
    }
    final codes = authState?.vendedorCodes ?? [];
    return codes.isNotEmpty ? codes.first : null;
  }

  @override
  Widget build(BuildContext context) {
    // Reaccionar a cambios de vendedor (solo JEFE_VENTAS).
    ref.listen<String?>(selectedVendorProvider, (prev, next) {
      if (next != prev) _loadIfNeeded();
    });
    final provider = ref.watch(bolsaProvider);
    final authState = ref.watch(authProvider).value;
    final user = authState?.user;
    final canEdit = user?.isJefeVentas == true;

    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      appBar: AppBar(
        title: const Text('Bolsa Comercial'),
        backgroundColor: AppTheme.darkSurface,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Recargar',
            onPressed: provider.isLoading ? null : provider.refresh,
          ),
          if (canEdit && provider.status != null)
            IconButton(
              icon: const Icon(Icons.tune),
              tooltip: 'Configurar límite',
              onPressed: () => _showConfigDialog(context, provider),
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: provider.refresh,
        child: _buildBody(provider),
      ),
    );
  }

  Widget _buildBody(BolsaProvider provider) {
    if (provider.isLoading && provider.status == null) {
      return const Center(child: ModernLoading(message: 'Cargando bolsa…'));
    }
    if (provider.error != null && provider.status == null) {
      return _ErrorView(message: provider.error!, onRetry: provider.refresh);
    }
    final status = provider.status;
    if (status == null) {
      return _EmptyVendorView();
    }
    final months = const [
      'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
      'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
    ];
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _BolsaSummaryCard(
          status: status,
          monthLabel: months[(status.mes - 1).clamp(0, 11)],
        ),
        const SizedBox(height: 16),
        _ProgressBar(status: status),
        const SizedBox(height: 24),
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 8),
          child: Text(
            'Movimientos del mes (${provider.movements.length})',
            style: TextStyle(
              color: Colors.white,
              fontSize: Responsive.fontSize(context, small: 14, large: 16),
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
        if (provider.movements.isEmpty)
          Container(
            padding: const EdgeInsets.all(20),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppTheme.darkSurface,
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Text(
              'No hay movimientos este mes',
              style: TextStyle(color: Colors.white54),
            ),
          )
        else
          ...provider.movements.map((m) => _MovimientoTile(movimiento: m)),
        const SizedBox(height: 32),
      ],
    );
  }

  Future<void> _showConfigDialog(
    BuildContext context,
    BolsaProvider provider,
  ) async {
    final status = provider.status;
    if (status == null) return;
    final limitePctCtrl =
        TextEditingController(text: status.limitePct.toStringAsFixed(2));
    final limiteImporteCtrl = TextEditingController(
      text: status.limiteImporte > 0
          ? status.limiteImporte.toStringAsFixed(2)
          : '',
    );
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          backgroundColor: AppTheme.darkSurface,
          title: const Text(
            'Configurar bolsa',
            style: TextStyle(color: Colors.white),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: limitePctCtrl,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: 'Límite (%)',
                  suffixText: '%',
                  hintText: '3.00',
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: limiteImporteCtrl,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: 'Límite importe (opcional)',
                  suffixText: '€',
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancelar'),
            ),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Guardar'),
            ),
          ],
        );
      },
    );
    if (result == true) {
      final pct = double.tryParse(
            limitePctCtrl.text.replaceAll(',', '.').trim(),
          ) ??
          status.limitePct;
      final imp = double.tryParse(
        limiteImporteCtrl.text.replaceAll(',', '.').trim(),
      );
      final ok = await provider.updateConfig(
        limitePct: pct.clamp(0.0, 100.0).toDouble(),
        limiteImporte: imp,
      );
      if (!ok && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(provider.error ?? 'Error al guardar bolsa'),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    }
  }
}

class _BolsaSummaryCard extends StatelessWidget {
  const _BolsaSummaryCard({required this.status, required this.monthLabel});
  final BolsaStatus status;
  final String monthLabel;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppTheme.neonBlue.withValues(alpha: 0.18),
            AppTheme.neonPurple.withValues(alpha: 0.10),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.neonBlue.withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.account_balance_wallet,
                  color: AppTheme.neonBlue, size: 22,),
              const SizedBox(width: 8),
              Text(
                'Saldo disponible · $monthLabel ${status.ejercicio}',
                style: const TextStyle(
                  color: Colors.white70,
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            '${status.saldoDisponible.toStringAsFixed(2)} €',
            style: TextStyle(
              color: status.isDeficit
                  ? AppTheme.error
                  : status.isLow
                      ? Colors.amber
                      : AppTheme.neonGreen,
              fontSize: 32,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _MetricBox(
                  label: 'Acumulado',
                  value: '${status.acumulado.toStringAsFixed(2)} €',
                  color: AppTheme.neonGreen,
                  icon: Icons.trending_up,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _MetricBox(
                  label: 'Consumido',
                  value: '${status.consumido.toStringAsFixed(2)} €',
                  color: AppTheme.warning,
                  icon: Icons.trending_down,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _MetricBox(
                  label: 'Límite',
                  value: '${status.limitePct.toStringAsFixed(1)}%',
                  color: AppTheme.neonBlue,
                  icon: Icons.percent,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MetricBox extends StatelessWidget {
  const _MetricBox({
    required this.label,
    required this.value,
    required this.color,
    required this.icon,
  });

  final String label;
  final String value;
  final Color color;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
      decoration: BoxDecoration(
        color: AppTheme.darkSurface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Column(
        children: [
          Icon(icon, color: color, size: 16),
          const SizedBox(height: 4),
          Text(
            value,
            style: TextStyle(
              color: color,
              fontWeight: FontWeight.bold,
              fontSize: 13,
            ),
          ),
          Text(
            label,
            style: const TextStyle(color: Colors.white54, fontSize: 10),
          ),
        ],
      ),
    );
  }
}

class _ProgressBar extends StatelessWidget {
  const _ProgressBar({required this.status});
  final BolsaStatus status;

  @override
  Widget build(BuildContext context) {
    final pct = status.porcentajeConsumido / 100;
    final color = pct >= 0.9
        ? AppTheme.error
        : pct >= 0.7
            ? Colors.amber
            : AppTheme.neonGreen;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 6),
          child: Text(
            'Consumo del periodo: ${status.porcentajeConsumido.toStringAsFixed(1)}%',
            style: const TextStyle(color: Colors.white70, fontSize: 12),
          ),
        ),
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: LinearProgressIndicator(
            value: pct,
            minHeight: 10,
            backgroundColor: AppTheme.darkSurface,
            valueColor: AlwaysStoppedAnimation<Color>(color),
          ),
        ),
      ],
    );
  }
}

class _MovimientoTile extends StatelessWidget {
  const _MovimientoTile({required this.movimiento});
  final BolsaMovimiento movimiento;

  @override
  Widget build(BuildContext context) {
    final isCredit = movimiento.tipo.isCredit;
    final color = isCredit ? AppTheme.neonGreen : AppTheme.warning;
    final icon =
        isCredit ? Icons.add_circle_outline : Icons.remove_circle_outline;
    final dateStr = movimiento.fecha != null
        ? '${movimiento.fecha!.day.toString().padLeft(2, '0')}/'
            '${movimiento.fecha!.month.toString().padLeft(2, '0')}'
        : '--';
    return Card(
      color: AppTheme.darkSurface,
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: color.withValues(alpha: 0.2), width: 0.5),
      ),
      child: ListTile(
        leading: Icon(icon, color: color),
        title: Text(
          movimiento.tipo.label,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w600,
          ),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (movimiento.codigoArticulo.isNotEmpty)
              Text(
                'Art.: ${movimiento.codigoArticulo}',
                style: const TextStyle(color: Colors.white54, fontSize: 11),
              ),
            if (movimiento.descripcion.isNotEmpty)
              Text(
                movimiento.descripcion,
                style: const TextStyle(color: Colors.white54, fontSize: 11),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            Text(
              'Saldo: ${movimiento.saldoPosterior.toStringAsFixed(2)} €',
              style: const TextStyle(color: Colors.white38, fontSize: 11),
            ),
          ],
        ),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              '${isCredit ? '+' : '-'}${movimiento.importe.toStringAsFixed(2)} €',
              style: TextStyle(
                color: color,
                fontWeight: FontWeight.bold,
                fontSize: 14,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              dateStr,
              style: const TextStyle(color: Colors.white38, fontSize: 11),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, color: AppTheme.error, size: 48),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white70),
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Reintentar'),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyVendorView extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.account_balance_wallet_outlined,
                size: 64, color: Colors.white24,),
            SizedBox(height: 16),
            Text(
              'Selecciona un vendedor en el filtro superior para ver su bolsa',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white54, fontSize: 14),
            ),
          ],
        ),
      ),
    );
  }
}
