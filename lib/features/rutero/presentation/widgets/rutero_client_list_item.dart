import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/kpi_alerts/presentation/widgets/client_alerts_widget.dart';

class _RuteroOrderVisualState {
  const _RuteroOrderVisualState({
    required this.label,
    required this.semanticLabel,
    required this.color,
    required this.icon,
    required this.backgroundAlpha,
    required this.bannerAlpha,
  });

  factory _RuteroOrderVisualState.fromClient(Map<String, dynamic> client) {
    final raw = client['orderStatus'];
    final data = raw is Map ? Map<String, dynamic>.from(raw) : const {};
    final state = (data['state'] ?? data['estado'] ?? data['status'] ?? '')
        .toString()
        .trim()
        .toUpperCase();

    switch (state) {
      case 'CONFIRMADO':
      case 'ENVIADO':
      case 'ENTREGADO':
      case 'FACTURADO':
        return const _RuteroOrderVisualState(
          label: 'VENTA CONFIRMADA',
          semanticLabel: 'Venta confirmada',
          color: AppTheme.success,
          icon: Icons.check_circle_rounded,
          backgroundAlpha: 0.16,
          bannerAlpha: 0.24,
        );
      case 'BORRADOR':
      case 'CONFIRMANDO':
      case 'PENDIENTE':
      case 'PEND_APROB':
      case 'PENDIENTE_APROBACION':
        return const _RuteroOrderVisualState(
          label: 'PEDIDO BORRADOR',
          semanticLabel: 'Pedido en borrador',
          color: Color(0xFFF97316),
          icon: Icons.edit_note_rounded,
          backgroundAlpha: 0.16,
          bannerAlpha: 0.25,
        );
      default:
        return const _RuteroOrderVisualState(
          label: 'SIN VENTA',
          semanticLabel: 'Sin venta. No se ha pasado pedido',
          color: AppTheme.error,
          icon: Icons.cancel_rounded,
          backgroundAlpha: 0.14,
          bannerAlpha: 0.22,
        );
    }
  }

  final String label;
  final String semanticLabel;
  final Color color;
  final IconData icon;
  final double backgroundAlpha;
  final double bannerAlpha;
}

class RuteroClientListItem extends StatelessWidget {
  const RuteroClientListItem({
    required this.client,
    required this.index,
    required this.formatCurrency,
    required this.formatVariation,
    required this.onTap,
    required this.onMapTap,
    required this.onCallTap,
    super.key,
    this.onWhatsAppTap,
    this.onNotesTap,
    this.showMargin = false,
    this.completedWeeks = 0,
    this.selectedYear = 0,
    this.periodLabel = '',
  });

  final Map<String, dynamic> client;
  final int index;
  final String Function(double) formatCurrency;
  final String Function(double) formatVariation;
  final VoidCallback onTap;
  final VoidCallback onMapTap;
  final VoidCallback onCallTap;
  final VoidCallback? onWhatsAppTap;
  final VoidCallback? onNotesTap;
  final bool showMargin;
  final int completedWeeks;
  final int selectedYear;
  final String periodLabel;

  @override
  Widget build(BuildContext context) {
    final name = client['name'] as String? ?? 'Sin nombre';
    final code = client['code'] as String? ?? '';
    final address = client['address'] as String? ?? '';
    final city = client['city'] as String? ?? '';
    final status = client['status'] as Map<String, dynamic>? ?? {};
    final observaciones = client['observaciones'] as Map<String, dynamic>?;
    final phones = (client['phones'] as List?)
            ?.map((p) => Map<String, dynamic>.from(p as Map))
            .toList() ??
        [];

    final isPositive = status['isPositive'] == true;
    final ytdSales = (status['ytdSales'] as num?)?.toDouble() ??
        (status['currentMonthSales'] as num?)?.toDouble() ??
        0;
    final margin = (status['margin'] as num?)?.toDouble() ?? 0;
    final yoyVariation = (status['yoyVariation'] as num?)?.toDouble() ??
        (status['variation'] as num?)?.toDouble() ??
        0;
    final ytdPrevYear = (status['ytdPrevYear'] as num?)?.toDouble() ??
        (status['prevMonthSales'] as num?)?.toDouble() ??
        0;
    final prevYearTotal = (status['prevYearTotal'] as num?)?.toDouble() ?? 0;

    final noSalesThisPeriod = ytdSales < 0.01;
    final noSalesLastPeriod = ytdPrevYear < 0.01;
    final noSalesEntireLastYear = prevYearTotal < 0.01;

    final isInactive = noSalesThisPeriod && noSalesLastPeriod;
    final isNewClient = !noSalesThisPeriod && noSalesEntireLastYear;
    final orderVisual = _RuteroOrderVisualState.fromClient(client);

    Color accentColor;
    if (isInactive) {
      accentColor = AppTheme.error;
    } else if (isNewClient) {
      accentColor = AppTheme.success;
    } else if (isPositive) {
      accentColor = AppTheme.success;
    } else {
      accentColor = AppTheme.error;
    }

    final hasObservaciones = observaciones != null &&
        observaciones['text'] != null &&
        (observaciones['text'] as String).isNotEmpty;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: Color.alphaBlend(
          orderVisual.color.withValues(alpha: orderVisual.backgroundAlpha),
          AppTheme.raisedSurface,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: orderVisual.color.withValues(alpha: 0.68),
          width: 1.6,
        ),
        boxShadow: [
          BoxShadow(
            color: orderVisual.color.withValues(alpha: 0.16),
            blurRadius: 14,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (hasObservaciones)
              InkWell(
                onTap: onNotesTap,
                child: Container(
                  width: double.infinity,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: const BoxDecoration(
                    color: AppTheme.warning,
                    borderRadius: BorderRadius.only(
                      topLeft: Radius.circular(12),
                      topRight: Radius.circular(12),
                    ),
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.warning_amber_rounded,
                        color: Colors.black87,
                        size: 16,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          observaciones['text'] as String,
                          style: const TextStyle(
                            color: Colors.black87,
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const Icon(
                        Icons.edit,
                        size: 14,
                        color: Colors.black54,
                      ),
                    ],
                  ),
                ),
              ),
            _buildOrderStatusBanner(orderVisual, hasObservaciones, context),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  _buildProgressIndicator(
                    accentColor: accentColor,
                    isInactive: isInactive,
                    isNewClient: isNewClient,
                    isPositive: isPositive,
                    yoyVariation: yoyVariation,
                    margin: margin,
                    showMargin: showMargin,
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: _buildClientInfo(
                      name: name,
                      code: code,
                      address: address,
                      city: city,
                      phones: phones,
                      context: context,
                    ),
                  ),
                  _buildActionButtons(phones),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildOrderStatusBanner(
    _RuteroOrderVisualState visual,
    bool hasObservaciones,
    BuildContext context,
  ) {
    final borderRadius = hasObservaciones
        ? BorderRadius.zero
        : const BorderRadius.only(
            topLeft: Radius.circular(14),
            topRight: Radius.circular(14),
          );

    return Semantics(
      label: visual.semanticLabel,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: visual.color.withValues(alpha: visual.bannerAlpha),
          borderRadius: borderRadius,
          border: Border(
            bottom: BorderSide(
              color: visual.color.withValues(alpha: 0.32),
            ),
          ),
        ),
        child: Row(
          children: [
            Icon(
              visual.icon,
              color: visual.color,
              size: 20,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                visual.label,
                style: TextStyle(
                  color: visual.color,
                  fontSize: Responsive.isSmall(context) ? 12 : 13,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 0,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildProgressIndicator({
    required Color accentColor,
    required bool isInactive,
    required bool isNewClient,
    required bool isPositive,
    required double yoyVariation,
    required double margin,
    required bool showMargin,
  }) {
    return Container(
      width: 85,
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(
        color: accentColor.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          Icon(
            isInactive
                ? Icons.remove_circle_outline
                : (isNewClient
                    ? Icons.star
                    : (isPositive ? Icons.trending_up : Icons.trending_down)),
            color: accentColor,
            size: 26,
          ),
          const SizedBox(height: 4),
          if (isInactive) ...[
            const Text(
              'SIN VENTAS',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.bold,
                color: AppTheme.error,
              ),
            ),
            const Text(
              'Este período (acumulativo de semanas)',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 8,
                color: AppTheme.textTertiary,
              ),
            ),
          ] else if (isNewClient) ...[
            const Text(
              'NUEVO',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.bold,
                color: AppTheme.success,
              ),
            ),
            Text(
              'No vendió en ${selectedYear - 1}',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 8,
                color: accentColor.withValues(alpha: 0.8),
              ),
            ),
          ] else ...[
            Text(
              '${yoyVariation >= 0 ? '+' : ''}${yoyVariation.toStringAsFixed(1)}%',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.bold,
                color: accentColor,
              ),
            ),
            Text(
              'vs ${selectedYear - 1}',
              style: TextStyle(
                fontSize: 9,
                color: accentColor.withValues(alpha: 0.8),
              ),
            ),
          ],
          if (margin > 0 && showMargin)
            Container(
              margin: const EdgeInsets.only(top: 4),
              padding: const EdgeInsets.symmetric(
                horizontal: 6,
                vertical: 2,
              ),
              decoration: BoxDecoration(
                color: margin >= 15
                    ? AppTheme.success.withValues(alpha: 0.2)
                    : AppTheme.warning.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                'M:${margin.toStringAsFixed(0)}%',
                style: TextStyle(
                  fontSize: 9,
                  fontWeight: FontWeight.bold,
                  color: margin >= 15 ? AppTheme.success : AppTheme.warning,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildClientInfo({
    required String name,
    required String code,
    required String address,
    required String city,
    required List<Map<String, dynamic>> phones,
    required BuildContext context,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              margin: const EdgeInsets.only(right: 8, top: 2),
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: AppTheme.accentRose,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: AppTheme.accentRose.withValues(alpha: 0.4),
                    blurRadius: 4,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: Text(
                '$index',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
            Expanded(
              child: Text(
                name,
                style: TextStyle(
                  fontSize: Responsive.isSmall(context) ? 15 : 17,
                  fontWeight: FontWeight.bold,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        if (code.isNotEmpty)
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: 8,
              vertical: 2,
            ),
            decoration: BoxDecoration(
              color: AppTheme.info.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(
              code,
              style: const TextStyle(
                fontSize: 11,
                color: AppTheme.info,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ClientAlertsWidget(
          clientId: code,
          compact: true,
        ),
        const SizedBox(height: 6),
        if (address.isNotEmpty || city.isNotEmpty)
          Row(
            children: [
              const Icon(
                Icons.place,
                size: 14,
                color: AppTheme.textTertiary,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  [address, city].where((s) => s.isNotEmpty).join(', '),
                  style: const TextStyle(
                    fontSize: 13,
                    color: AppTheme.textSecondary,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        const SizedBox(height: 6),
        _buildSalesRow(context),
      ],
    );
  }

  Widget _buildSalesRow(BuildContext context) {
    final status = client['status'] as Map<String, dynamic>? ?? {};
    final ytdSales = (status['ytdSales'] as num?)?.toDouble() ??
        (status['currentMonthSales'] as num?)?.toDouble() ??
        0;
    final ytdPrevYear = (status['ytdPrevYear'] as num?)?.toDouble() ??
        (status['prevMonthSales'] as num?)?.toDouble() ??
        0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          completedWeeks > 1
              ? 'Acumulado Sem. 1-$completedWeeks${periodLabel.isNotEmpty ? ' (hasta ${periodLabel.split(' - ').last})' : ''}:'
              : completedWeeks == 1
                  ? 'Acumulado Sem. 1${periodLabel.isNotEmpty ? ' (hasta ${periodLabel.split(' - ').last})' : ''}:'
                  : 'Sin semanas completadas:',
          style: const TextStyle(
            fontSize: 11,
            color: AppTheme.textTertiary,
          ),
        ),
        const SizedBox(height: 4),
        Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: 6,
                vertical: 2,
              ),
              decoration: BoxDecoration(
                color: AppTheme.info.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                '$selectedYear',
                style: TextStyle(
                  fontSize: Responsive.isSmall(context) ? 9 : 10,
                  color: AppTheme.info,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
            const SizedBox(width: 4),
            Flexible(
              flex: 2,
              child: Text(
                formatCurrency(ytdSales),
                style: TextStyle(
                  fontSize: Responsive.isSmall(context) ? 13 : 14,
                  fontWeight: FontWeight.bold,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (ytdPrevYear > 0) ...[
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 6,
                  vertical: 2,
                ),
                decoration: BoxDecoration(
                  color: AppTheme.borderColor,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  '${selectedYear - 1}',
                  style: TextStyle(
                    fontSize: Responsive.isSmall(context) ? 9 : 10,
                    color: AppTheme.textPrimary,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              const SizedBox(width: 4),
              Flexible(
                child: Text(
                  formatCurrency(ytdPrevYear),
                  style: TextStyle(
                    fontSize: Responsive.isSmall(context) ? 11 : 12,
                    color: AppTheme.textSecondary,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ] else if (selectedYear == DateTime.now().year &&
                DateTime.now().day <= 7 &&
                DateTime.now().month == 1) ...[
              const SizedBox(width: 4),
              Tooltip(
                triggerMode: TooltipTriggerMode.tap,
                showDuration: const Duration(seconds: 4),
                margin: const EdgeInsets.symmetric(horizontal: 20),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppTheme.inkSurface,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: AppTheme.borderColor,
                  ),
                ),
                textStyle: const TextStyle(
                  color: Colors.white,
                  fontSize: 13,
                ),
                message:
                    'El acumulado del año anterior aparecerá a partir de la 2ª semana.',
                child: const Icon(
                  Icons.info_outline,
                  size: 14,
                  color: AppTheme.textTertiary,
                ),
              ),
            ],
          ],
        ),
      ],
    );
  }

  Widget _buildActionButtons(List<Map<String, dynamic>> phones) {
    return Column(
      children: [
        IconButton(
          onPressed: onMapTap,
          icon: const Icon(
            Icons.directions,
            color: AppTheme.accentRose,
            size: 26,
          ),
          tooltip: 'Cómo llegar',
          splashRadius: 24,
          padding: const EdgeInsets.all(4),
          constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
        ),
        if (onNotesTap != null)
          IconButton(
            onPressed: onNotesTap,
            icon: Icon(
              phones.isNotEmpty ? Icons.edit_note : Icons.note_add,
              color: AppTheme.textSecondary,
              size: 26,
            ),
            tooltip: 'Observaciones',
            splashRadius: 24,
            padding: const EdgeInsets.all(4),
            constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
          ),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (phones.isNotEmpty && onWhatsAppTap != null)
              IconButton(
                onPressed: onWhatsAppTap,
                icon: const Icon(
                  Icons.chat,
                  color: Color(0xFF25D366),
                  size: 26,
                ),
                tooltip: 'WhatsApp',
                splashRadius: 24,
                padding: const EdgeInsets.all(4),
                constraints: const BoxConstraints(
                  minWidth: 44,
                  minHeight: 44,
                ),
              ),
            IconButton(
              onPressed: onCallTap,
              icon: const Icon(
                Icons.phone,
                color: AppTheme.info,
                size: 26,
              ),
              tooltip: 'Llamar',
              splashRadius: 24,
              padding: const EdgeInsets.all(4),
              constraints: const BoxConstraints(
                minWidth: 44,
                minHeight: 44,
              ),
            ),
          ],
        ),
      ],
    );
  }
}
