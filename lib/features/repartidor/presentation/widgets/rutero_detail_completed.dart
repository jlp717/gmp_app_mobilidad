import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';

class RuteroDetailCompleted extends StatelessWidget {
  const RuteroDetailCompleted({
    required this.albaran,
    required this.onPreviewReceiptPdf,
    required this.onDownloadReceiptPdf,
    required this.onShareViaWhatsApp,
    required this.onShareViaEmail,
    required this.buildPrinterConfigSection,
    required this.tieneImpresora,
    required this.items,
    required this.onShowZebraPrintPreview,
    super.key,
  });

  final AlbaranEntrega albaran;
  final VoidCallback onPreviewReceiptPdf;
  final VoidCallback onDownloadReceiptPdf;
  final VoidCallback onShareViaWhatsApp;
  final VoidCallback onShareViaEmail;
  final Widget Function() buildPrinterConfigSection;
  final bool tieneImpresora;
  final List<EntregaItem> items;
  final VoidCallback onShowZebraPrintPreview;

  bool get _isFactura => albaran.numeroFactura > 0;

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
              label: 'Imprimir Ticket (Zebra)',
              color: const Color(0xFF00BCD4),
              onTap: onShowZebraPrintPreview,
            ),
          ],
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _buildSuccessBanner() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppTheme.success.withOpacity(0.15),
            AppTheme.success.withOpacity(0.05),
          ],
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.success.withOpacity(0.3)),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppTheme.success.withOpacity(0.2),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.check_circle,
              color: AppTheme.success,
              size: 32,
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'ENTREGA COMPLETADA',
                  style: TextStyle(
                    color: AppTheme.success,
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                    letterSpacing: 0.5,
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
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.borderColor),
      ),
      child: Column(
        children: [
          _InfoRow(
            icon: Icons.store,
            label: 'Cliente',
            value: albaran.nombreCliente,
          ),
          const Divider(color: AppTheme.borderColor, height: 20),
          _InfoRow(
            icon: Icons.location_on,
            label: 'Dirección',
            value: '${albaran.direccion}, ${albaran.poblacion}',
          ),
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
            label: 'Forma pago',
            value: albaran.formaPagoDesc,
          ),
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
    return Column(
      children: [
        const Text(
          'REENVIAR NOTA DE ENTREGA',
          style: TextStyle(
            color: AppTheme.textSecondary,
            fontWeight: FontWeight.bold,
            fontSize: 12,
            letterSpacing: 1,
          ),
        ),
        const SizedBox(height: 12),
        _ShareButton(
          icon: Icons.visibility,
          label: 'Ver PDF',
          color: AppTheme.neonPurple,
          onTap: onPreviewReceiptPdf,
        ),
        const SizedBox(height: 10),
        _ShareButton(
          icon: Icons.download,
          label: 'Descargar PDF',
          color: AppTheme.neonBlue,
          onTap: onDownloadReceiptPdf,
        ),
        const SizedBox(height: 10),
        _ShareButton(
          icon: Icons.chat,
          label: 'Enviar por WhatsApp',
          color: const Color(0xFF25D366),
          onTap: onShareViaWhatsApp,
        ),
        const SizedBox(height: 10),
        _ShareButton(
          icon: Icons.email,
          label: 'Enviar por Email',
          color: AppTheme.neonCyan,
          onTap: onShareViaEmail,
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
  });

  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color.withOpacity(0.15),
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(
            children: [
              Icon(icon, color: color, size: 24),
              const SizedBox(width: 12),
              Text(
                label,
                style: TextStyle(color: color, fontWeight: FontWeight.w600),
              ),
              const Spacer(),
              Icon(Icons.chevron_right, color: color.withOpacity(0.6)),
            ],
          ),
        ),
      ),
    );
  }
}
