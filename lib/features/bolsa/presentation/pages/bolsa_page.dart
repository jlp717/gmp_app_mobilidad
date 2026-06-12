/// Bolsa Comercial Page (Req #3)
/// ===============================
/// Pantalla principal de Bolsa Comercial: muestra saldo, acumulado,
/// consumido, % consumo, y lista de movimientos. JEFE_VENTAS puede
/// editar el límite mensual.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:intl/intl.dart';
import 'package:gmp_app_mobilidad/core/providers/filter_provider.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/global_vendor_selector.dart';
import 'package:gmp_app_mobilidad/core/widgets/modern_loading.dart';
import 'package:gmp_app_mobilidad/features/bolsa/data/bolsa_models.dart';
import 'package:gmp_app_mobilidad/features/bolsa/presentation/widgets/bolsa_monthly_chart.dart';
import 'package:gmp_app_mobilidad/features/bolsa/providers/bolsa_provider.dart';

/// Formato de moneda con localización española (1.234,56 €).
final NumberFormat _bolsaMoneyFormat =
    NumberFormat.currency(locale: 'es_ES', symbol: '€');

String _bolsaMoney(double value) => _bolsaMoneyFormat.format(value);

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
    final normalized = vendor?.trim();
    if (normalized == null ||
        normalized.isEmpty ||
        normalized.toUpperCase() == 'ALL') {
      if (_lastLoadedVendor != null) {
        _lastLoadedVendor = null;
        ref.read(bolsaProvider).load(normalized ?? '');
      }
      return;
    }
    if (normalized != _lastLoadedVendor) {
      _lastLoadedVendor = normalized;
      ref.read(bolsaProvider).load(normalized);
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
      body: Column(
        children: [
          // Selector "Ver como" para que JEFE_VENTAS pueda inspeccionar la
          // bolsa de cada comercial. Para COMERCIAL no se renderiza (forceShow
          // es false y isJefeVentas es false).
          if (user?.isJefeVentas == true)
            const GlobalVendorSelector(isJefeVentas: true),
          Expanded(
            child: RefreshIndicator(
              onRefresh: provider.refresh,
              child: _buildBody(provider),
            ),
          ),
        ],
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
      'Ene',
      'Feb',
      'Mar',
      'Abr',
      'May',
      'Jun',
      'Jul',
      'Ago',
      'Sep',
      'Oct',
      'Nov',
      'Dic',
    ];
    final filtered = provider.filteredMovements;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _BolsaSummaryCard(
          status: status,
          monthLabel: months[(status.mes - 1).clamp(0, 11)],
        ),
        const SizedBox(height: 16),
        _ProgressBar(status: status),
        if (provider.history.isNotEmpty) ...[
          const SizedBox(height: 16),
          BolsaMonthlyChart(history: provider.history),
        ],
        const SizedBox(height: 20),
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 8),
          child: Row(
            children: [
              Text(
                'Movimientos',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: Responsive.fontSize(context, small: 14, large: 16),
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                provider.movements.isEmpty
                    ? ''
                    : '(${filtered.length}/${provider.movements.length})',
                style: const TextStyle(
                  color: Colors.white54,
                  fontSize: 12,
                ),
              ),
              const Spacer(),
              if (provider.tipoFilter != null ||
                  provider.searchQuery.isNotEmpty)
                TextButton.icon(
                  onPressed: provider.clearFilters,
                  icon: const Icon(Icons.clear, size: 14),
                  label: const Text('Limpiar', style: TextStyle(fontSize: 11)),
                  style: TextButton.styleFrom(
                    foregroundColor: AppTheme.warning,
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                  ),
                ),
            ],
          ),
        ),
        _MovimientosFilters(provider: provider),
        const SizedBox(height: 8),
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
        else if (filtered.isEmpty)
          Container(
            padding: const EdgeInsets.all(20),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppTheme.darkSurface,
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Text(
              'Ningún movimiento coincide con los filtros',
              style: TextStyle(color: Colors.white54),
            ),
          )
        else
          ...filtered.map((m) => _MovimientoTile(movimiento: m)),
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
              const Icon(
                Icons.account_balance_wallet,
                color: AppTheme.neonBlue,
                size: 22,
              ),
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
            _bolsaMoney(status.saldoDisponible),
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
                  value: _bolsaMoney(status.acumulado),
                  color: AppTheme.neonGreen,
                  icon: Icons.trending_up,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _MetricBox(
                  label: 'Consumido',
                  value: _bolsaMoney(status.consumido),
                  color: AppTheme.warning,
                  icon: Icons.trending_down,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _MetricBox(
                  label: 'Límite',
                  value:
                      '${status.limitePct.toStringAsFixed(1).replaceAll('.', ',')}%',
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
            'Consumo del periodo: ${status.porcentajeConsumido.toStringAsFixed(1).replaceAll('.', ',')}%',
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

class _MovimientosFilters extends StatefulWidget {
  const _MovimientosFilters({required this.provider});
  final BolsaProvider provider;

  @override
  State<_MovimientosFilters> createState() => _MovimientosFiltersState();
}

class _MovimientosFiltersState extends State<_MovimientosFilters> {
  late final TextEditingController _searchCtrl;

  @override
  void initState() {
    super.initState();
    _searchCtrl = TextEditingController(text: widget.provider.searchQuery);
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.provider;
    final counts = p.countsByTipo;

    Widget chip(String label, BolsaMovimientoTipo? tipo, IconData icon) {
      final selected = p.tipoFilter == tipo;
      final count = tipo == null ? p.movements.length : (counts[tipo] ?? 0);
      return Padding(
        padding: const EdgeInsets.only(right: 6),
        child: ChoiceChip(
          selected: selected,
          onSelected: (_) => p.setTipoFilter(tipo),
          backgroundColor: AppTheme.darkSurface,
          selectedColor: AppTheme.neonBlue.withValues(alpha: 0.25),
          side: BorderSide(
            color: selected
                ? AppTheme.neonBlue
                : Colors.white.withValues(alpha: 0.15),
          ),
          label: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 13, color: Colors.white.withValues(alpha: 0.7)),
              const SizedBox(width: 4),
              Text(label, style: const TextStyle(fontSize: 11)),
              const SizedBox(width: 4),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  '$count',
                  style: const TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          labelStyle: TextStyle(
            color:
                selected ? Colors.white : Colors.white.withValues(alpha: 0.75),
          ),
        ),
      );
    }

    return Column(
      children: [
        SizedBox(
          height: 32,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              chip('Todos', null, Icons.list_alt),
              chip(
                'Acumulación',
                BolsaMovimientoTipo.acumulacion,
                Icons.trending_up,
              ),
              chip(
                'Consumo',
                BolsaMovimientoTipo.consumo,
                Icons.trending_down,
              ),
              chip('Ajustes', BolsaMovimientoTipo.ajuste, Icons.tune),
            ],
          ),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _searchCtrl,
          onChanged: p.setSearchQuery,
          style: const TextStyle(color: Colors.white, fontSize: 13),
          decoration: InputDecoration(
            isDense: true,
            prefixIcon:
                const Icon(Icons.search, size: 18, color: Colors.white54),
            suffixIcon: _searchCtrl.text.isEmpty
                ? null
                : IconButton(
                    icon: const Icon(Icons.close, size: 16),
                    color: Colors.white54,
                    onPressed: () {
                      _searchCtrl.clear();
                      p.setSearchQuery('');
                    },
                  ),
            hintText: 'Buscar por artículo o descripción…',
            hintStyle: TextStyle(
              color: Colors.white.withValues(alpha: 0.35),
              fontSize: 12,
            ),
            filled: true,
            fillColor: AppTheme.darkSurface,
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: BorderSide(
                color: Colors.white.withValues(alpha: 0.10),
              ),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: BorderSide(
                color: Colors.white.withValues(alpha: 0.10),
              ),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: BorderSide(
                color: AppTheme.neonBlue.withValues(alpha: 0.5),
              ),
            ),
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
    final extraDetail = _extraDetailText();
    final signedAmount =
        "${isCredit ? '+' : '-'}${_formatMoney(movimiento.importe)}";

    return Card(
      color: AppTheme.darkSurface,
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: color.withValues(alpha: 0.2), width: 0.5),
      ),
      child: ListTile(
        isThreeLine: extraDetail != null || movimiento.descripcion.isNotEmpty,
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
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            if (extraDetail != null) ...[
              const SizedBox(height: 6),
              Text(
                extraDetail,
                style: TextStyle(
                  color: color.withValues(alpha: 0.78),
                  fontSize: 10.5,
                  fontWeight: FontWeight.w600,
                ),
                maxLines: 4,
                overflow: TextOverflow.visible,
              ),
            ],
            const SizedBox(height: 2),
            Text(
              'Saldo: ${_formatMoney(movimiento.saldoAnterior)} -> ${_formatMoney(movimiento.saldoPosterior)}',
              style: const TextStyle(color: Colors.white38, fontSize: 11),
            ),
          ],
        ),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              signedAmount,
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

  String? _extraDetailText() {
    final details = <String>[
      if (movimiento.pedidoId != null) 'Pedido ${movimiento.pedidoId}',
      if (movimiento.lineId != null) 'Línea ${movimiento.lineId}',
      if (movimiento.cantidad != null) 'Cant. ${_formatQuantityWithUnit()}',
      if (movimiento.precioMinimoCongelado != null)
        'Mín. ${_formatMoney(movimiento.precioMinimoCongelado!)}',
      if (movimiento.precioVenta != null)
        'Venta ${_formatMoney(movimiento.precioVenta!)}',
      if (movimiento.precioMinimoCongelado != null &&
          movimiento.precioVenta != null &&
          movimiento.cantidad != null)
        _formatCalculation(),
      if (movimiento.idempotencyKey != null)
        'Ref. ${_shortTrace(movimiento.idempotencyKey!)}',
    ];
    if (details.isEmpty) return null;
    return details.join(' · ');
  }

  String _formatCalculation() {
    final delta =
        (movimiento.precioVenta! - movimiento.precioMinimoCongelado!).abs();
    final direction =
        movimiento.tipo == BolsaMovimientoTipo.acumulacion ? 'margen' : 'uso';
    return '$direction ${_formatMoney(delta)} x ${_formatQuantityWithUnit()} = ${_formatMoney(movimiento.importe)}';
  }

  String _formatQuantityWithUnit() {
    final quantity = _formatQuantity(movimiento.cantidad!);
    final unit = movimiento.unidadMedida?.trim();
    if (unit == null || unit.isEmpty) return quantity;
    return '$quantity $unit';
  }

  String _formatQuantity(double value) {
    if (value == value.roundToDouble()) return value.toStringAsFixed(0);
    return value.toStringAsFixed(2);
  }

  String _formatMoney(double value) => _bolsaMoney(value);

  String _shortTrace(String value) {
    final trimmed = value.trim();
    if (trimmed.length <= 12) return trimmed;
    return '${trimmed.substring(0, 12)}…';
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
            Icon(
              Icons.account_balance_wallet_outlined,
              size: 64,
              color: Colors.white24,
            ),
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
