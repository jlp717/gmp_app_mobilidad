/// Bolsa Comercial Page (Req #3)
/// ===============================
/// Pantalla principal de Bolsa Comercial: muestra saldo, acumulado,
/// consumido, % consumo, y lista de movimientos. JEFE_VENTAS puede
/// editar el límite mensual.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/providers/filter_provider.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/utils/vendor_scope.dart';
import 'package:gmp_app_mobilidad/core/widgets/global_vendor_selector.dart';
import 'package:gmp_app_mobilidad/core/widgets/modern_loading.dart';
import 'package:gmp_app_mobilidad/features/bolsa/data/bolsa_models.dart';
import 'package:gmp_app_mobilidad/features/bolsa/presentation/widgets/bolsa_monthly_chart.dart';
import 'package:gmp_app_mobilidad/features/bolsa/providers/bolsa_provider.dart';
import 'package:intl/intl.dart';

/// Formato de moneda con localización española (1.234,56 €).
final NumberFormat _bolsaMoneyFormat =
    NumberFormat.currency(locale: 'es_ES', symbol: '€');

String _bolsaMoney(double value) => _bolsaMoneyFormat.format(value);

class _MonthNames {
  static const full = [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ];
}

class BolsaPage extends ConsumerStatefulWidget {
  const BolsaPage({
    super.key,
    this.forceShowVendorSelector = false,
  });

  final bool forceShowVendorSelector;

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
    final authState = ref.read(authProvider).value;
    final user = authState?.user;
    final vendor = _resolveVendor();
    final normalized = vendor?.trim();
    final shouldLoadGrouped = _shouldLoadGrouped(
      vendor: normalized,
      authState: authState,
    );
    if (shouldLoadGrouped) {
      final codes = _groupedVendorCodes(
        vendor: normalized,
        authState: authState,
      );
      final key = 'GROUPED:${codes.join(',')}';
      if (_lastLoadedVendor != key) {
        _lastLoadedVendor = key;
        ref.read(bolsaProvider).loadGrouped(vendedorCodes: codes);
      }
      return;
    }
    if (normalized == null || normalized.isEmpty) {
      _lastLoadedVendor = null;
      ref.read(bolsaProvider).load('');
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
    final authVendorCodes = authState?.vendedorCodes ?? const <String>[];
    final fallbackCodes = authVendorCodes.isNotEmpty
        ? authVendorCodes.join(',')
        : (user.vendedorCode?.trim().isNotEmpty ?? false
            ? user.vendedorCode!.trim()
            : user.code.trim());
    if (hasCommercial80VendorScope(
      userCode: user.code,
      vendorCodes: authVendorCodes,
    )) {
      return resolveScopedVendorCodes(
        userCode: user.code,
        authVendorCodes: authVendorCodes,
        selectedVendor: ref.read(selectedVendorProvider),
        fallbackVendorCodes: fallbackCodes,
      );
    }
    if (user.isJefeVentas) {
      final selected = ref.read(selectedVendorProvider);
      return selected;
    }
    return authVendorCodes.isNotEmpty ? authVendorCodes.first : null;
  }

  bool _shouldLoadGrouped({
    required String? vendor,
    required AuthState? authState,
  }) {
    final user = authState?.user;
    if (user == null) return false;
    final normalized = vendor?.trim();
    if (user.isJefeVentas &&
        (normalized == null ||
            normalized.isEmpty ||
            normalized.toUpperCase() == 'ALL')) {
      return true;
    }
    final authVendorCodes = authState?.vendedorCodes ?? const <String>[];
    return hasCommercial80VendorScope(
          userCode: user.code,
          vendorCodes: authVendorCodes,
        ) &&
        normalized != null &&
        normalized.contains(',');
  }

  List<String> _groupedVendorCodes({
    required String? vendor,
    required AuthState? authState,
  }) {
    final normalized = vendor?.trim() ?? '';
    if (normalized.isNotEmpty && normalized.toUpperCase() != 'ALL') {
      return normalized
          .split(',')
          .map((code) => code.trim())
          .where((code) => code.isNotEmpty)
          .toList(growable: false);
    }
    return authState?.vendedorCodes ?? const <String>[];
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
    final canEdit = user?.isJefeVentas ?? false;

    return Scaffold(
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        title: const Text('Bolsa Comercial'),
        backgroundColor: AppTheme.inkSurface,
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
      body: DecoratedBox(
        decoration: AppTheme.appBackground(),
        child: Column(
          children: [
            // Selector "Ver como" para JEFE_VENTAS y perfiles comerciales
            // con alcance de equipo, como Comercial 80.
            if (user?.isJefeVentas ?? false || widget.forceShowVendorSelector)
              GlobalVendorSelector(
                isJefeVentas: user?.isJefeVentas ?? false,
                forceShow: widget.forceShowVendorSelector,
              ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: provider.refresh,
                child: _buildBody(provider, canEdit: canEdit),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBody(BolsaProvider provider, {required bool canEdit}) {
    if (provider.isLoading && provider.status == null) {
      return const Center(child: ModernLoading(message: 'Cargando bolsa…'));
    }
    if (provider.error != null && provider.status == null) {
      return _ErrorView(message: provider.error!, onRetry: provider.refresh);
    }
    final status = provider.status;
    if (status == null) {
      final grouped = provider.groupedSummary;
      if (grouped != null) {
        return _GroupedBolsaView(
          summary: grouped,
          provider: provider,
          onSelectVendor: (code) {
            ref.read(filterProvider.notifier).setVendor(code);
            _loadIfNeeded();
          },
        );
      }
      return _EmptyVendorView();
    }
    const months = _MonthNames.full;
    final filtered = provider.filteredMovements;
    final monthLabel = months[(status.mes - 1).clamp(0, 11)];
    final hasChart = provider.history.isNotEmpty;
    // Header: summary, gap, progress, [chart block], gap, title, filters, gap
    const headerBase = 8;
    final headerCount = headerBase + (hasChart ? 2 : 0);
    final bodyCount = provider.movements.isEmpty
        ? 1
        : filtered.isEmpty
            ? 1
            : filtered.length;
    final itemCount = headerCount + bodyCount + 1; // + bottom spacer

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: itemCount,
      itemBuilder: (context, index) {
        if (index < headerCount) {
          var slot = 0;
          if (index == slot++) {
            return _BolsaSummaryCard(status: status, monthLabel: monthLabel);
          }
          if (index == slot++) return _BolsaPeriodSelector(provider: provider);
          if (index == slot++) return const SizedBox(height: 16);
          if (index == slot++) return _ProgressBar(status: status);
          if (hasChart) {
            if (index == slot++) return const SizedBox(height: 16);
            if (index == slot++) {
              return BolsaMonthlyChart(history: provider.history);
            }
          }
          if (index == slot++) return const SizedBox(height: 20);
          if (index == slot++) {
            return Padding(
              padding: const EdgeInsets.only(left: 4, bottom: 8),
              child: Row(
                children: [
                  Text(
                    'Movimientos',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize:
                          Responsive.fontSize(context, small: 14, large: 16),
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
                      provider.searchQuery.isNotEmpty ||
                      provider.hasAdvancedFilters)
                    TextButton.icon(
                      onPressed: () => provider.clearFilters(),
                      icon: const Icon(Icons.clear, size: 14),
                      label: const Text(
                        'Limpiar',
                        style: TextStyle(fontSize: 11),
                      ),
                      style: TextButton.styleFrom(
                        foregroundColor: AppTheme.warning,
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                      ),
                    ),
                ],
              ),
            );
          }
          if (index == slot++) {
            return _MovimientosFilters(provider: provider);
          }
          return const SizedBox(height: 8);
        }

        final bodyIndex = index - headerCount;
        if (bodyIndex < bodyCount) {
          if (provider.movements.isEmpty) {
            return Container(
              padding: const EdgeInsets.all(20),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppTheme.raisedSurface,
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Text(
                'No hay movimientos este mes',
                style: TextStyle(color: Colors.white54),
              ),
            );
          }
          if (filtered.isEmpty) {
            return Container(
              padding: const EdgeInsets.all(20),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppTheme.raisedSurface,
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Text(
                'Ningún movimiento coincide con los filtros',
                style: TextStyle(color: Colors.white54),
              ),
            );
          }
          return _MovimientoTile(
            movimiento: filtered[bodyIndex],
            canSeeMargin: canEdit,
          );
        }

        return const SizedBox(height: 32);
      },
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
          backgroundColor: AppTheme.raisedSurface,
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
    if (result ?? false) {
      final pct = double.tryParse(
            limitePctCtrl.text.replaceAll(',', '.').trim(),
          ) ??
          status.limitePct;
      final imp = double.tryParse(
        limiteImporteCtrl.text.replaceAll(',', '.').trim(),
      );
      final ok = await provider.updateConfig(
        limitePct: pct.clamp(0.0, 100.0),
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
    final accent = status.isDeficit
        ? AppTheme.error
        : status.isLow
            ? AppTheme.accentAmber
            : AppTheme.success;
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppTheme.raisedSurface,
            AppTheme.softPanel.withValues(alpha: 0.92),
            accent.withValues(alpha: 0.045),
          ],
        ),
        borderRadius: BorderRadius.circular(AppTheme.radiusXl),
        border: Border.all(color: accent.withValues(alpha: 0.24)),
        boxShadow: AppTheme.elevation2,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.account_balance_wallet,
                color: AppTheme.info,
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
                      ? AppTheme.warning
                      : AppTheme.success,
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
                  color: AppTheme.success,
                  icon: Icons.trending_up,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _MetricBox(
                  label: 'Consumido',
                  value: _bolsaMoney(status.consumido),
                  color: AppTheme.error,
                  icon: Icons.trending_down,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _MetricBox(
                  label: 'Límite',
                  value: _bolsaMoney(status.presupuestoPeriodo),
                  color: AppTheme.info,
                  icon: Icons.account_balance,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            'Neto del periodo: ${status.netoPeriodo >= 0 ? '+' : '-'}${_bolsaMoney(status.netoPeriodo.abs())}',
            style: TextStyle(
              color:
                  status.netoPeriodo >= 0 ? AppTheme.success : AppTheme.error,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _BolsaPeriodSelector extends StatelessWidget {
  const _BolsaPeriodSelector({required this.provider});

  final BolsaProvider provider;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final years = List<int>.generate(5, (index) => now.year - 3 + index);
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Row(
        children: [
          Expanded(
            flex: 2,
            child: _PeriodDropdown<int>(
              value: provider.selectedMonth,
              items: List<int>.generate(12, (index) => index + 1),
              itemLabel: (month) => _MonthNames.full[(month - 1).clamp(0, 11)],
              icon: Icons.calendar_month,
              onChanged: provider.isLoading
                  ? null
                  : (month) {
                      if (month == null) return;
                      unawaited(
                        provider.setPeriod(
                          year: provider.selectedYear,
                          month: month,
                        ),
                      );
                    },
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _PeriodDropdown<int>(
              value: provider.selectedYear,
              items: years,
              itemLabel: (year) => year.toString(),
              icon: Icons.event,
              onChanged: provider.isLoading
                  ? null
                  : (year) {
                      if (year == null) return;
                      unawaited(
                        provider.setPeriod(
                          year: year,
                          month: provider.selectedMonth,
                        ),
                      );
                    },
            ),
          ),
        ],
      ),
    );
  }
}

class _PeriodDropdown<T> extends StatelessWidget {
  const _PeriodDropdown({
    required this.value,
    required this.items,
    required this.itemLabel,
    required this.icon,
    required this.onChanged,
  });

  final T value;
  final List<T> items;
  final String Function(T value) itemLabel;
  final IconData icon;
  final ValueChanged<T?>? onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<T>(
      initialValue: value,
      isExpanded: true,
      dropdownColor: AppTheme.raisedSurface,
      iconEnabledColor: Colors.white70,
      decoration: InputDecoration(
        isDense: true,
        prefixIcon: Icon(icon, color: AppTheme.info, size: 17),
        filled: true,
        fillColor: AppTheme.inkSurface.withValues(alpha: 0.34),
        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.12)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.12)),
        ),
      ),
      style: const TextStyle(color: Colors.white, fontSize: 12),
      items: items
          .map(
            (item) => DropdownMenuItem<T>(
              value: item,
              child: Text(itemLabel(item), overflow: TextOverflow.ellipsis),
            ),
          )
          .toList(growable: false),
      onChanged: onChanged,
    );
  }
}

class _GroupedBolsaView extends StatelessWidget {
  const _GroupedBolsaView({
    required this.summary,
    required this.provider,
    required this.onSelectVendor,
  });

  final BolsaGroupedSummary summary;
  final BolsaProvider provider;
  final void Function(String vendedorCode) onSelectVendor;

  @override
  Widget build(BuildContext context) {
    final vendedores = summary.vendedores;
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: vendedores.isEmpty ? 6 : vendedores.length + 5,
      itemBuilder: (context, index) {
        if (index == 0) {
          return _BolsaPeriodSelector(provider: provider);
        }
        if (index == 1) return const SizedBox(height: 16);
        if (index == 2) {
          return _GroupedSummaryCard(summary: summary);
        }
        if (index == 3) return const SizedBox(height: 16);
        if (index == 4) {
          return Padding(
            padding: const EdgeInsets.only(left: 4, bottom: 8),
            child: Text(
              'Distribucion por comercial',
              style: TextStyle(
                color: Colors.white,
                fontSize: Responsive.fontSize(
                  context,
                  small: 14,
                  large: 16,
                ),
                fontWeight: FontWeight.bold,
              ),
            ),
          );
        }
        if (vendedores.isEmpty) {
          return Container(
            padding: const EdgeInsets.all(20),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppTheme.raisedSurface,
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Text(
              'No hay movimientos de bolsa este mes',
              style: TextStyle(color: Colors.white54),
            ),
          );
        }
        final status = vendedores[index - 5];
        return _GroupedVendorTile(
          status: status,
          onTap: () => onSelectVendor(status.vendedor),
        );
      },
    );
  }
}

class _GroupedSummaryCard extends StatelessWidget {
  const _GroupedSummaryCard({required this.summary});
  final BolsaGroupedSummary summary;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppTheme.raisedSurface,
            AppTheme.softPanel.withValues(alpha: 0.92),
            AppTheme.info.withValues(alpha: 0.045),
          ],
        ),
        borderRadius: BorderRadius.circular(AppTheme.radiusXl),
        border: Border.all(color: AppTheme.info.withValues(alpha: 0.25)),
        boxShadow: AppTheme.elevation1,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.groups, color: AppTheme.info, size: 20),
              SizedBox(width: 8),
              Text(
                'Bolsa del equipo',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _MetricBox(
                  label: 'Disponible',
                  value: _bolsaMoney(summary.saldoDisponible),
                  color: AppTheme.success,
                  icon: Icons.account_balance_wallet,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _MetricBox(
                  label: 'Acumulado',
                  value: _bolsaMoney(summary.acumulado),
                  color: AppTheme.info,
                  icon: Icons.trending_up,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _MetricBox(
                  label: 'Consumido',
                  value: _bolsaMoney(summary.consumido),
                  color: AppTheme.error,
                  icon: Icons.trending_down,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _GroupedVendorTile extends StatelessWidget {
  const _GroupedVendorTile({required this.status, required this.onTap});
  final BolsaStatus status;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = status.isDeficit
        ? AppTheme.error
        : status.isLow
            ? AppTheme.warning
            : AppTheme.success;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.centerLeft,
          end: Alignment.centerRight,
          colors: [
            AppTheme.raisedSurface,
            AppTheme.softPanel.withValues(alpha: 0.88),
            color.withValues(alpha: 0.04),
          ],
        ),
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        border: Border.all(color: color.withValues(alpha: 0.20)),
      ),
      child: ListTile(
        onTap: onTap,
        leading: CircleAvatar(
          radius: 17,
          backgroundColor: color.withValues(alpha: 0.12),
          child: Text(
            status.vendedor,
            style: TextStyle(
              color: color,
              fontSize: 11,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
        title: Text(
          'Comercial ${status.vendedor}',
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w600,
          ),
        ),
        subtitle: Text(
          'Acum. ${_bolsaMoney(status.acumulado)} · Cons. ${_bolsaMoney(status.consumido)} · Uso ${status.porcentajeConsumido.toStringAsFixed(1).replaceAll('.', ',')}%',
          style: const TextStyle(color: Colors.white54, fontSize: 11),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              _bolsaMoney(status.saldoDisponible),
              style: TextStyle(
                color: color,
                fontWeight: FontWeight.bold,
                fontSize: 13,
              ),
            ),
            const Icon(Icons.chevron_right, color: Colors.white38, size: 18),
          ],
        ),
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
        color: AppTheme.inkSurface.withValues(alpha: 0.62),
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
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
            ? AppTheme.warning
            : AppTheme.success;
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
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 6),
          child: Text(
            '${_bolsaMoney(status.consumido)} usados sobre ${_bolsaMoney(status.presupuestoPeriodo)}',
            style: const TextStyle(color: Colors.white38, fontSize: 11),
          ),
        ),
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: LinearProgressIndicator(
            value: pct,
            minHeight: 10,
            backgroundColor: AppTheme.raisedSurface,
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
  late final TextEditingController _documentCtrl;
  late final TextEditingController _clientCtrl;
  Timer? _documentDebounce;
  Timer? _clientDebounce;

  @override
  void initState() {
    super.initState();
    _searchCtrl = TextEditingController(text: widget.provider.searchQuery);
    _documentCtrl = TextEditingController(text: widget.provider.documentFilter);
    _clientCtrl = TextEditingController(text: widget.provider.clientFilter);
  }

  @override
  void dispose() {
    _documentDebounce?.cancel();
    _clientDebounce?.cancel();
    _searchCtrl.dispose();
    _documentCtrl.dispose();
    _clientCtrl.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant _MovimientosFilters oldWidget) {
    super.didUpdateWidget(oldWidget);
    _syncText(_searchCtrl, widget.provider.searchQuery);
    _syncText(_documentCtrl, widget.provider.documentFilter);
    _syncText(_clientCtrl, widget.provider.clientFilter);
  }

  void _syncText(TextEditingController controller, String value) {
    if (controller.text == value) return;
    controller.value = TextEditingValue(
      text: value,
      selection: TextSelection.collapsed(offset: value.length),
    );
  }

  void _debouncedDocumentFilter(String value) {
    _documentDebounce?.cancel();
    setState(() {});
    _documentDebounce = Timer(const Duration(milliseconds: 250), () {
      if (!mounted) return;
      unawaited(widget.provider.setDocumentFilter(value));
    });
  }

  void _debouncedClientFilter(String value) {
    _clientDebounce?.cancel();
    setState(() {});
    _clientDebounce = Timer(const Duration(milliseconds: 250), () {
      if (!mounted) return;
      unawaited(widget.provider.setClientFilter(value));
    });
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
          backgroundColor: AppTheme.inkSurface.withValues(alpha: 0.34),
          selectedColor: AppTheme.info.withValues(alpha: 0.20),
          side: BorderSide(
            color:
                selected ? AppTheme.info : Colors.white.withValues(alpha: 0.15),
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
          onChanged: (value) {
            setState(() {});
            p.setSearchQuery(value);
          },
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
            fillColor: AppTheme.inkSurface.withValues(alpha: 0.34),
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
                color: AppTheme.info.withValues(alpha: 0.5),
              ),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            _DateFilterButton(
              label: 'Desde',
              value: p.dateFromFilter,
              onPressed: () => _pickDate(from: true),
            ),
            _DateFilterButton(
              label: 'Hasta',
              value: p.dateToFilter,
              onPressed: () => _pickDate(from: false),
            ),
            SizedBox(
              width: 170,
              child: _FilterTextField(
                controller: _documentCtrl,
                icon: Icons.receipt_long,
                hint: 'Pedido o factura',
                onChanged: _debouncedDocumentFilter,
                onSubmitted: (value) {
                  _documentDebounce?.cancel();
                  return p.setDocumentFilter(value);
                },
              ),
            ),
            SizedBox(
              width: 190,
              child: _FilterTextField(
                controller: _clientCtrl,
                icon: Icons.storefront,
                hint: 'Cliente',
                onChanged: _debouncedClientFilter,
                onSubmitted: (value) {
                  _clientDebounce?.cancel();
                  return p.setClientFilter(value);
                },
              ),
            ),
          ],
        ),
      ],
    );
  }

  Future<void> _pickDate({required bool from}) async {
    final provider = widget.provider;
    final current = from ? provider.dateFromFilter : provider.dateToFilter;
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: current ?? now,
      firstDate: DateTime(now.year - 3),
      lastDate: DateTime(now.year + 1),
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: const ColorScheme.dark(
              primary: AppTheme.info,
              surface: AppTheme.raisedSurface,
            ),
          ),
          child: child!,
        );
      },
    );
    if (picked == null) return;
    if (from) {
      await provider.setDateRange(picked, provider.dateToFilter);
    } else {
      await provider.setDateRange(provider.dateFromFilter, picked);
    }
  }
}

class _DateFilterButton extends StatelessWidget {
  const _DateFilterButton({
    required this.label,
    required this.value,
    required this.onPressed,
  });

  final String label;
  final DateTime? value;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final text = value == null
        ? label
        : '${value!.day.toString().padLeft(2, '0')}/'
            '${value!.month.toString().padLeft(2, '0')}/'
            '${value!.year}';
    return OutlinedButton.icon(
      onPressed: onPressed,
      icon: const Icon(Icons.calendar_today, size: 14),
      label: Text(text, style: const TextStyle(fontSize: 11)),
      style: OutlinedButton.styleFrom(
        foregroundColor: Colors.white70,
        side: BorderSide(color: Colors.white.withValues(alpha: 0.18)),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        minimumSize: const Size(0, 34),
      ),
    );
  }
}

class _FilterTextField extends StatelessWidget {
  const _FilterTextField({
    required this.controller,
    required this.icon,
    required this.hint,
    required this.onChanged,
    required this.onSubmitted,
  });

  final TextEditingController controller;
  final IconData icon;
  final String hint;
  final ValueChanged<String> onChanged;
  final Future<void> Function(String) onSubmitted;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      onChanged: onChanged,
      onSubmitted: onSubmitted,
      style: const TextStyle(color: Colors.white, fontSize: 12),
      decoration: InputDecoration(
        isDense: true,
        prefixIcon: Icon(icon, size: 16, color: Colors.white54),
        suffixIcon: controller.text.isEmpty
            ? null
            : IconButton(
                icon: const Icon(Icons.close, size: 15),
                color: Colors.white54,
                onPressed: () {
                  controller.clear();
                  onChanged('');
                },
              ),
        hintText: hint,
        hintStyle: TextStyle(
          color: Colors.white.withValues(alpha: 0.35),
          fontSize: 11,
        ),
        filled: true,
        fillColor: AppTheme.raisedSurface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.10)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.10)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: BorderSide(
            color: AppTheme.info.withValues(alpha: 0.5),
          ),
        ),
      ),
    );
  }
}

class _MovimientoTile extends StatelessWidget {
  const _MovimientoTile({
    required this.movimiento,
    required this.canSeeMargin,
  });
  final BolsaMovimiento movimiento;
  final bool canSeeMargin;

  @override
  Widget build(BuildContext context) {
    final isCredit = movimiento.tipo.isCredit;
    final color = isCredit ? AppTheme.success : AppTheme.error;
    final icon =
        isCredit ? Icons.add_circle_outline : Icons.remove_circle_outline;
    final dateStr = movimiento.fecha != null
        ? '${movimiento.fecha!.day.toString().padLeft(2, '0')}/'
            '${movimiento.fecha!.month.toString().padLeft(2, '0')}'
        : '--';
    final extraDetail = _extraDetailText();
    final signedAmount =
        "${isCredit ? '+' : '-'}${_formatMoney(movimiento.importe)}";
    final pedidoLabel = movimiento.displayPedido;
    final clienteLabel = movimiento.displayCliente;

    return Card(
      elevation: 0,
      surfaceTintColor: Colors.transparent,
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        side: BorderSide(color: color.withValues(alpha: 0.24), width: 0.8),
      ),
      color: Colors.transparent,
      child: ListTile(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        ),
        tileColor: AppTheme.softPanel.withValues(alpha: 0.88),
        isThreeLine: extraDetail != null || movimiento.descripcion.isNotEmpty,
        leading: Icon(icon, color: color),
        title: Text(
          pedidoLabel.isNotEmpty
              ? '${movimiento.tipo.label} - $pedidoLabel'
              : movimiento.tipo.label,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w600,
          ),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (clienteLabel.isNotEmpty)
              Text(
                clienteLabel,
                style: const TextStyle(color: Colors.white70, fontSize: 11),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
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
      if (movimiento.displayPedido.isNotEmpty) movimiento.displayPedido,
      if (movimiento.lineId != null) 'Línea ${movimiento.lineId}',
      if (movimiento.cantidad != null) 'Cant. ${_formatQuantityWithUnit()}',
      if (canSeeMargin && movimiento.precioMinimoCongelado != null)
        'Mín. ${_formatMoney(movimiento.precioMinimoCongelado!)}',
      if (canSeeMargin && movimiento.precioVenta != null)
        'Venta ${_formatMoney(movimiento.precioVenta!)}',
      if (canSeeMargin &&
          movimiento.precioMinimoCongelado != null &&
          movimiento.precioVenta != null &&
          movimiento.cantidad != null)
        _formatCalculation(),
      if (movimiento.idempotencyKey != null)
        'Ref. ${_shortTrace(movimiento.idempotencyKey!)}',
      if (movimiento.syncStatus != null) movimiento.syncStatus!,
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
