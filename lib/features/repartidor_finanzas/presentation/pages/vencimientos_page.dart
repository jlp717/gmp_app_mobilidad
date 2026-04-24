// ignore_for_file: public_member_api_docs

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_providers.dart';
import 'package:intl/intl.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

enum VencimientoEstado {
  vencido,
  hoy,
  proximo,
  cobrado,
}

class VencimientoItem {
  const VencimientoItem({
    required this.cliente,
    required this.documento,
    required this.fecha,
    required this.importe,
    required this.estado,
    this.id,
    this.vendedor,
    this.notas,
  });

  final String? id;
  final String cliente;
  final String documento;
  final DateTime fecha;
  final double importe;
  final VencimientoEstado estado;
  final String? vendedor;
  final String? notas;
}

enum VencimientosFiltro {
  todos,
  vencidos,
  hoy,
  proximos,
  cobrados,
}

class VencimientosPage extends StatefulWidget {
  const VencimientosPage({
    super.key,
    this.vencimientos = const [],
    this.initialFiltro = VencimientosFiltro.todos,
    this.onFiltroChanged,
    this.onItemTap,
  });

  final List<VencimientoItem> vencimientos;
  final VencimientosFiltro initialFiltro;
  final ValueChanged<VencimientosFiltro>? onFiltroChanged;
  final ValueChanged<VencimientoItem>? onItemTap;

  @override
  State<VencimientosPage> createState() => _VencimientosPageState();
}

class _VencimientosPageState extends State<VencimientosPage> {
  late VencimientosFiltro _filtro = widget.initialFiltro;

  @override
  Widget build(BuildContext context) {
    final visible = _filteredItems();
    final groups = _groupItems(visible);

    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: Column(
        children: [
          _FinanceHeader(
            icon: Icons.event_available,
            title: 'Vencimientos',
            subtitle:
                '${visible.length} documentos - ${_money(_total(visible))}',
          ),
          _FilterStrip(
            selected: _filtro,
            onSelected: (filtro) {
              setState(() => _filtro = filtro);
              widget.onFiltroChanged?.call(filtro);
            },
          ),
          Expanded(
            child: visible.isEmpty
                ? const _EmptyState(
                    message: 'No hay vencimientos para el filtro',
                  )
                : ListView(
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 16),
                    children: [
                      for (final entry in groups.entries) ...[
                        _GroupHeader(
                          title: entry.key,
                          count: entry.value.length,
                          amount: _total(entry.value),
                        ),
                        const SizedBox(height: 8),
                        for (final item in entry.value) ...[
                          _VencimientoRow(
                            item: item,
                            onTap: widget.onItemTap == null
                                ? null
                                : () => widget.onItemTap?.call(item),
                          ),
                          const SizedBox(height: 8),
                        ],
                      ],
                    ],
                  ),
          ),
        ],
      ),
    );
  }

  List<VencimientoItem> _filteredItems() {
    return widget.vencimientos.where((item) {
      return switch (_filtro) {
        VencimientosFiltro.todos => true,
        VencimientosFiltro.vencidos => item.estado == VencimientoEstado.vencido,
        VencimientosFiltro.hoy => item.estado == VencimientoEstado.hoy,
        VencimientosFiltro.proximos => item.estado == VencimientoEstado.proximo,
        VencimientosFiltro.cobrados => item.estado == VencimientoEstado.cobrado,
      };
    }).toList()
      ..sort((a, b) => a.fecha.compareTo(b.fecha));
  }

  Map<String, List<VencimientoItem>> _groupItems(List<VencimientoItem> items) {
    final grouped = <String, List<VencimientoItem>>{};
    for (final item in items) {
      final key = switch (item.estado) {
        VencimientoEstado.vencido => 'Vencidos',
        VencimientoEstado.hoy => 'Vencen hoy',
        VencimientoEstado.proximo => 'Proximos',
        VencimientoEstado.cobrado => 'Cobrados',
      };
      grouped.putIfAbsent(key, () => []).add(item);
    }
    return grouped;
  }
}

class RepartidorVencimientosPage extends ConsumerWidget {
  const RepartidorVencimientosPage({
    required this.repartidorId,
    super.key,
  });

  final String repartidorId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (repartidorId.isEmpty || repartidorId.contains(',')) {
      return const Scaffold(
        backgroundColor: AppTheme.darkBase,
        body: Center(
          child: Text(
            'Selecciona un repartidor para consultar vencimientos',
            style: TextStyle(color: AppTheme.textSecondary),
          ),
        ),
      );
    }

    final now = DateTime.now();
    final from = DateTime(now.year, now.month, now.day).subtract(
      const Duration(days: 180),
    );
    final to = DateTime(now.year, now.month, now.day).add(
      const Duration(days: 180),
    );
    final args = (
      repartidorId: repartidorId,
      from: from,
      to: to,
      clientCode: null as String?,
      estado: null as String?,
      forceRefresh: false,
    );
    final asyncItems = ref.watch(repartidorVencimientosProvider(args));

    return asyncItems.when(
      data: (items) => VencimientosPage(
        vencimientos: items.map(_mapVencimiento).toList(),
        onItemTap: (item) => _showDetail(context, item),
      ),
      loading: () => const Scaffold(
        backgroundColor: AppTheme.darkBase,
        body: Center(child: CircularProgressIndicator()),
      ),
      error: (error, stackTrace) {
        Sentry.captureException(error, stackTrace: stackTrace);
        return Scaffold(
          backgroundColor: AppTheme.darkBase,
          body: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'No se pudieron cargar los vencimientos',
                  style: TextStyle(color: AppTheme.textSecondary),
                ),
                const SizedBox(height: 12),
                ElevatedButton(
                  onPressed: () => ref.invalidate(
                    repartidorVencimientosProvider(args),
                  ),
                  child: const Text('Reintentar'),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  static VencimientoItem _mapVencimiento(RepartidorVencimiento item) {
    final fecha = DateTime.tryParse(item.fechaVencimiento) ?? DateTime.now();
    final today = DateTime.now();
    final todayDate = DateTime(today.year, today.month, today.day);
    final dueDate = DateTime(fecha.year, fecha.month, fecha.day);
    final estado = dueDate.isBefore(todayDate)
        ? VencimientoEstado.vencido
        : dueDate.isAtSameMomentAs(todayDate)
            ? VencimientoEstado.hoy
            : VencimientoEstado.proximo;

    return VencimientoItem(
      id: item.documento,
      cliente: '${item.codigoCliente} ${item.nombreCliente}',
      documento: item.documento,
      fecha: fecha,
      importe: item.importePendiente,
      estado: estado,
      notas: [
        if (item.tipoDocumento.isNotEmpty) item.tipoDocumento,
        if (item.nombreAlternativo.isNotEmpty) item.nombreAlternativo,
        if (item.poblacion.isNotEmpty) item.poblacion,
      ].join(' - '),
    );
  }

  static void _showDetail(BuildContext context, VencimientoItem item) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppTheme.surfaceColor,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(14)),
      ),
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.cliente,
                  style: const TextStyle(
                    color: AppTheme.textPrimary,
                    fontWeight: FontWeight.w800,
                    fontSize: 16,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  item.documento,
                  style: const TextStyle(color: AppTheme.textSecondary),
                ),
                const SizedBox(height: 8),
                Text(
                  'Vence: ${DateFormat('dd/MM/yyyy').format(item.fecha)}',
                  style: const TextStyle(color: AppTheme.textSecondary),
                ),
                const SizedBox(height: 8),
                Text(
                  _money(item.importe),
                  style: const TextStyle(
                    color: AppTheme.neonGreen,
                    fontWeight: FontWeight.w900,
                    fontSize: 18,
                  ),
                ),
                if ((item.notas ?? '').isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    item.notas!,
                    style: const TextStyle(color: AppTheme.textTertiary),
                  ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}

class _FinanceHeader extends StatelessWidget {
  const _FinanceHeader({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.fromLTRB(
        16,
        MediaQuery.of(context).padding.top + 14,
        16,
        14,
      ),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        border: Border(
          bottom: BorderSide(
            color: AppTheme.neonBlue.withValues(alpha: 0.25),
          ),
        ),
      ),
      child: Row(
        children: [
          Icon(icon, color: AppTheme.neonBlue, size: 26),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: const TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _FilterStrip extends StatelessWidget {
  const _FilterStrip({
    required this.selected,
    required this.onSelected,
  });

  final VencimientosFiltro selected;
  final ValueChanged<VencimientosFiltro> onSelected;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: AppTheme.darkSurface,
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            _chip(VencimientosFiltro.todos, 'Todos'),
            _chip(VencimientosFiltro.vencidos, 'Vencidos'),
            _chip(VencimientosFiltro.hoy, 'Hoy'),
            _chip(VencimientosFiltro.proximos, 'Proximos'),
            _chip(VencimientosFiltro.cobrados, 'Cobrados'),
          ],
        ),
      ),
    );
  }

  Widget _chip(VencimientosFiltro filtro, String label) {
    final isSelected = selected == filtro;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ChoiceChip(
        label: Text(label),
        selected: isSelected,
        onSelected: (_) => onSelected(filtro),
        selectedColor: AppTheme.neonBlue,
        backgroundColor: AppTheme.surfaceColor,
        labelStyle: TextStyle(
          color: isSelected ? AppTheme.darkBase : AppTheme.textSecondary,
          fontWeight: FontWeight.w700,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
    );
  }
}

class _GroupHeader extends StatelessWidget {
  const _GroupHeader({
    required this.title,
    required this.count,
    required this.amount,
  });

  final String title;
  final int count;
  final double amount;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(
        children: [
          Expanded(
            child: Text(
              '$title ($count)',
              style: const TextStyle(
                color: AppTheme.textPrimary,
                fontSize: 13,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          Text(
            _money(amount),
            style: const TextStyle(
              color: AppTheme.neonGreen,
              fontSize: 13,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _VencimientoRow extends StatelessWidget {
  const _VencimientoRow({
    required this.item,
    this.onTap,
  });

  final VencimientoItem item;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final color = _statusColor(item.estado);

    return Material(
      color: AppTheme.surfaceColor,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: color.withValues(alpha: 0.28)),
          ),
          child: Row(
            children: [
              Container(
                width: 4,
                height: 52,
                decoration: BoxDecoration(
                  color: color,
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.cliente,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppTheme.textPrimary,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${item.documento} - '
                      '${DateFormat('dd/MM/yyyy').format(item.fecha)}',
                      style: const TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 12,
                      ),
                    ),
                    if ((item.vendedor ?? '').isNotEmpty) ...[
                      const SizedBox(height: 3),
                      Text(
                        item.vendedor!,
                        style: const TextStyle(
                          color: AppTheme.textTertiary,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    _money(item.importe),
                    style: const TextStyle(
                      color: AppTheme.textPrimary,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 5),
                  _StatusPill(label: _statusLabel(item.estado), color: color),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Text(
        message,
        style: const TextStyle(color: AppTheme.textSecondary),
      ),
    );
  }
}

double _total(List<VencimientoItem> items) {
  return items.fold<double>(0, (sum, item) => sum + item.importe);
}

Color _statusColor(VencimientoEstado estado) {
  return switch (estado) {
    VencimientoEstado.vencido => AppTheme.error,
    VencimientoEstado.hoy => AppTheme.warning,
    VencimientoEstado.proximo => AppTheme.neonBlue,
    VencimientoEstado.cobrado => AppTheme.success,
  };
}

String _statusLabel(VencimientoEstado estado) {
  return switch (estado) {
    VencimientoEstado.vencido => 'Vencido',
    VencimientoEstado.hoy => 'Hoy',
    VencimientoEstado.proximo => 'Proximo',
    VencimientoEstado.cobrado => 'Cobrado',
  };
}

String _money(double value) {
  final fixed = value.toStringAsFixed(2).replaceAll('.', ',');
  return '$fixed €';
}
