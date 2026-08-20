import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_executive_ui.dart';

class RuteroDetailCompleted extends StatelessWidget {
  const RuteroDetailCompleted({
    required this.albaran,
    required this.onPreviewReceiptPdf,
    required this.onDownloadReceiptPdf,
    required this.onSharePdfLocally,
    required this.onShareReceiptViaWhatsApp,
    required this.buildPrinterConfigSection,
    required this.tieneImpresora,
    required this.items,
    required this.onShowZebraPrintPreview,
    this.onEmailReceipt,
    super.key,
  });

  final AlbaranEntrega albaran;
  final VoidCallback onPreviewReceiptPdf;
  final VoidCallback onDownloadReceiptPdf;
  final VoidCallback onSharePdfLocally;
  final VoidCallback onShareReceiptViaWhatsApp;
  final Widget Function() buildPrinterConfigSection;
  final VoidCallback? onEmailReceipt;
  final bool tieneImpresora;
  final List<EntregaItem> items;
  final VoidCallback onShowZebraPrintPreview;

  bool get _isFactura => albaran.numeroFactura > 0;

  bool get _isNoDelivery =>
      albaran.estado == EstadoEntrega.noEntregado ||
      albaran.estado == EstadoEntrega.rechazado;

  Color get _outcomeColor => switch (albaran.estado) {
        EstadoEntrega.entregado => AppTheme.success,
        EstadoEntrega.parcial || EstadoEntrega.noEntregado => AppTheme.warning,
        EstadoEntrega.rechazado => AppTheme.error,
        _ => AppTheme.info,
      };

  IconData get _outcomeIcon => switch (albaran.estado) {
        EstadoEntrega.rechazado => Icons.cancel_outlined,
        EstadoEntrega.noEntregado => Icons.remove_circle_outline,
        EstadoEntrega.parcial => Icons.pie_chart_outline,
        _ => Icons.check_circle,
      };

  String get _outcomeTitle => switch (albaran.estado) {
        EstadoEntrega.entregado => 'ENTREGA COMPLETADA',
        EstadoEntrega.parcial => 'ENTREGA PARCIAL CONFIRMADA',
        EstadoEntrega.noEntregado => 'NO ENTREGA CONFIRMADA',
        EstadoEntrega.rechazado => 'ENTREGA RECHAZADA',
        _ => 'RESULTADO DE ENTREGA',
      };

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        children: [
          _buildSuccessBanner(),
          const SizedBox(height: 20),
          _buildSummaryInfo(context),
          const SizedBox(height: 24),
          _buildShareSection(),
          const SizedBox(height: 16),
          buildPrinterConfigSection(),
          if (tieneImpresora && items.isNotEmpty) ...[
            const SizedBox(height: 10),
            _ShareButton(
              icon: Icons.print,
              label: 'Imprimir ticket',
              color: AppTheme.info,
              onTap: onShowZebraPrintPreview,
            ),
          ],
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _buildSuccessBanner() {
    return RepartidorExecutivePanel(
      padding: const EdgeInsets.all(20),
      accentColor: _outcomeColor,
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: _outcomeColor.withValues(alpha: 0.2),
              shape: BoxShape.circle,
            ),
            child: Icon(
              _outcomeIcon,
              color: _outcomeColor,
              size: 32,
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _outcomeTitle,
                  style: TextStyle(
                    color: _outcomeColor,
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  _isFactura
                      ? 'Factura ${albaran.numeroFactura}'
                      : 'Albarán ${albaran.numeroAlbaran}',
                  style: const TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSummaryInfo(BuildContext context) {
    return RepartidorExecutivePanel(
      padding: const EdgeInsets.all(16),
      accentColor: AppTheme.info,
      child: Column(
        children: [
          _InfoRow(
            icon: Icons.store,
            label: 'Cliente',
            value: albaran.nombreCliente,
          ),
          if (albaran.nombreFiscal != null &&
              albaran.nombreFiscal!.isNotEmpty &&
              albaran.nombreFiscal!.toUpperCase() !=
                  albaran.nombreCliente.toUpperCase())
            Padding(
              padding: const EdgeInsets.only(left: 32, bottom: 4),
              child: Text(
                'N. fiscal: ${albaran.nombreFiscal}',
                style: const TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 11,
                ),
              ),
            ),
          const Divider(color: AppTheme.borderColor, height: 20),
          _InfoRow(
            icon: Icons.location_on,
            label: 'Dirección',
            value: '${albaran.direccion}, ${albaran.poblacion}',
          ),
          if (albaran.ordenPreparacion != null) ...[
            const Divider(color: AppTheme.borderColor, height: 20),
            _InfoRow(
              icon: Icons.inventory_2_outlined,
              label: 'Orden prep.',
              value: albaran.ordenPreparacion.toString(),
            ),
          ],
          const Divider(color: AppTheme.borderColor, height: 20),
          if (albaran.importeNeto > 0) ...[
            _InfoRow(
              icon: Icons.euro,
              label: 'Importe Neto',
              value: '${albaran.importeNeto.toStringAsFixed(2)} €',
            ),
            for (final iva in albaran.ivaBreakdown)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: _InfoRow(
                  icon: Icons.percent,
                  label: 'IVA ${iva.pct.toStringAsFixed(0)}%',
                  value: '${iva.iva.toStringAsFixed(2)} €',
                ),
              ),
            const Divider(color: AppTheme.borderColor, height: 20),
            _InfoRow(
              icon: Icons.euro,
              label: 'Total',
              value: '${albaran.importeTotal.toStringAsFixed(2)} €',
            ),
          ] else ...[
            _InfoRow(
              icon: Icons.euro,
              label: 'Importe',
              value: '${albaran.importeTotal.toStringAsFixed(2)} €',
            ),
          ],
          const Divider(color: AppTheme.borderColor, height: 20),
          _InfoRow(
            icon: Icons.payment,
            label: 'Forma pago doc.',
            value: albaran.formaPagoDesc,
          ),
          if (albaran.hasAppCobro) ...[
            const Divider(color: AppTheme.borderColor, height: 20),
            _InfoRow(
              icon: Icons.payments_outlined,
              label: 'Cobrado en ruta',
              value: '${albaran.importeCobrado!.toStringAsFixed(2)} €'
                  '${albaran.cobroParcial ? ' (parcial)' : ' (total)'}',
            ),
            if ((albaran.formaPagoCobro ?? '').trim().isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: _InfoRow(
                  icon: Icons.credit_card,
                  label: 'Método cobro',
                  value: albaran.formaPagoCobro!,
                ),
              ),
            if (albaran.importePendienteCobro != null &&
                albaran.importePendienteCobro! > 0.004)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: _InfoRow(
                  icon: Icons.hourglass_bottom,
                  label: 'Pendiente tras cobro',
                  value:
                      '${albaran.importePendienteCobro!.toStringAsFixed(2)} €',
                ),
              ),
          ] else if (_isNoDelivery == false) ...[
            const Divider(color: AppTheme.borderColor, height: 20),
            const _InfoRow(
              icon: Icons.money_off_outlined,
              label: 'Cobrado en ruta',
              value: 'Sin cobro',
            ),
          ],
          if (albaran.observaciones != null &&
              albaran.observaciones!.isNotEmpty) ...[
            const Divider(color: AppTheme.borderColor, height: 20),
            _InfoRow(
              icon: Icons.notes,
              label: 'Observaciones',
              value: albaran.observaciones!,
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildShareSection() {
    final emailAction = onEmailReceipt;
    return Column(
      children: [
        const Text(
          'DOCUMENTOS Y ACCIONES',
          style: TextStyle(
            color: AppTheme.textSecondary,
            fontWeight: FontWeight.bold,
            fontSize: 12,
          ),
        ),
        const SizedBox(height: 12),
        _ShareButton(
          icon: Icons.visibility,
          label: 'Ver PDF',
          color: AppTheme.accentIndigo,
          onTap: onPreviewReceiptPdf,
        ),
        const SizedBox(height: 10),
        _ShareButton(
          icon: Icons.download,
          label: 'Descargar PDF',
          color: AppTheme.info,
          onTap: onDownloadReceiptPdf,
        ),
        const SizedBox(height: 10),
        _ShareButton(
          icon: Icons.share,
          label: 'Compartir archivo PDF',
          color: AppTheme.success,
          onTap: onSharePdfLocally,
        ),
        const SizedBox(height: 10),
        _ShareButton(
          icon: Icons.chat,
          label: 'Enviar por WhatsApp',
          color: const Color(0xFF25D366),
          onTap: onShareReceiptViaWhatsApp,
        ),
        const SizedBox(height: 10),
        if (emailAction != null)
          _ShareButton(
            icon: Icons.email_outlined,
            label: 'Enviar por email',
            color: AppTheme.accentIndigo,
            onTap: emailAction,
          ),
      ],
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 18, color: AppTheme.textTertiary),
        const SizedBox(width: 10),
        SizedBox(
          width: Responsive.value(context, phone: 60, desktop: 80),
          child: Text(
            label,
            style: const TextStyle(color: AppTheme.textTertiary, fontSize: 12),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(color: AppTheme.textPrimary, fontSize: 13),
          ),
        ),
      ],
    );
  }
}

class _ShareButton extends StatelessWidget {
  const _ShareButton({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
    this.enabled = true,
  });

  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback? onTap;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final effectiveColor = enabled ? color : AppTheme.textTertiary;
    return RepartidorExecutivePanel(
      accentColor: effectiveColor,
      padding: EdgeInsets.zero,
      onTap: enabled ? onTap : null,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          children: [
            Icon(icon, color: effectiveColor, size: 24),
            const SizedBox(width: 12),
            Text(
              label,
              style:
                  TextStyle(color: effectiveColor, fontWeight: FontWeight.w600),
            ),
            const Spacer(),
            Icon(Icons.chevron_right,
                color: effectiveColor.withValues(alpha: 0.6)),
          ],
        ),
      ),
    );
  }
}
