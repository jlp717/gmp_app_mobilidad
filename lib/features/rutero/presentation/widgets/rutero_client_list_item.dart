import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/kpi_alerts/presentation/widgets/client_alerts_widget.dart';

class RuteroClientListItem extends StatelessWidget {
  const RuteroClientListItem({
    super.key,
    required this.client,
    required this.index,
    required this.formatCurrency,
    required this.formatVariation,
    required this.onTap,
    required this.onMapTap,
    required this.onCallTap,
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
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: hasObservaciones
              ? AppTheme.warning.withValues(alpha: 0.8)
              : accentColor.withValues(alpha: 0.5),
          width: hasObservaciones ? 2 : 1.5,
        ),
        boxShadow: [
          BoxShadow(
            color: (hasObservaciones ? AppTheme.warning : accentColor)
                .withValues(alpha: 0.1),
            blurRadius: 8,
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
                          observaciones!['text'] as String,
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
            Text(
              'Este período (acumulativo de semanas)',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 8,
                color: Colors.grey.shade600,
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
                color: AppTheme.neonPink,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: AppTheme.neonPink.withValues(alpha: 0.4),
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
              color: AppTheme.neonBlue.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(
              code,
              style: const TextStyle(
                fontSize: 11,
                color: AppTheme.neonBlue,
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
              Icon(
                Icons.place,
                size: 14,
                color: Colors.grey.shade500,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  [address, city].where((s) => s.isNotEmpty).join(', '),
                  style: TextStyle(
                    fontSize: 13,
                    color: Colors.grey.shade400,
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
          style: TextStyle(
            fontSize: 11,
            color: Colors.grey.shade500,
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
                color: AppTheme.neonBlue.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                '$selectedYear',
                style: TextStyle(
                  fontSize: Responsive.isSmall(context) ? 9 : 10,
                  color: AppTheme.neonBlue,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
            const SizedBox(width: 4),
            Text(
              formatCurrency(ytdSales),
              style: TextStyle(
                fontSize: Responsive.isSmall(context) ? 13 : 14,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(width: 12),
            if (ytdPrevYear > 0) ...[
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 6,
                  vertical: 2,
                ),
                decoration: BoxDecoration(
                  color: Colors.grey.shade700,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  '${selectedYear - 1}',
                  style: TextStyle(
                    fontSize: Responsive.isSmall(context) ? 9 : 10,
                    color: Colors.grey.shade300,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              const SizedBox(width: 4),
              Text(
                formatCurrency(ytdPrevYear),
                style: TextStyle(
                  fontSize: Responsive.isSmall(context) ? 11 : 12,
                  color: Colors.grey.shade400,
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
                  color: AppTheme.darkBase,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: Colors.grey.shade700,
                  ),
                ),
                textStyle: const TextStyle(
                  color: Colors.white,
                  fontSize: 13,
                ),
                message:
                    'El acumulado del año anterior aparecerá a partir de la 2Âª semana.',
                child: Icon(
                  Icons.info_outline,
                  size: 14,
                  color: Colors.grey.shade600,
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
            color: AppTheme.neonPink,
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
              color: Colors.grey.shade400,
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
                color: AppTheme.neonBlue,
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
