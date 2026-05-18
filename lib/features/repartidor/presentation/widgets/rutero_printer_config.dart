import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/zebra_print_service.dart';

class RuteroPrinterConfig extends StatelessWidget {
  const RuteroPrinterConfig({
    required this.tieneImpresora,
    required this.printerName,
    required this.printerAddress,
    required this.isTestingConnection,
    required this.lastConnectionResult,
    required this.onToggle,
    required this.onSelectPrinter,
    required this.onTestConnection,
    super.key,
  });

  final bool tieneImpresora;
  final String? printerName;
  final String? printerAddress;
  final bool isTestingConnection;
  final bool? lastConnectionResult;
  final void Function(bool) onToggle;
  final VoidCallback onSelectPrinter;
  final VoidCallback onTestConnection;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: tieneImpresora
              ? AppTheme.neonCyan.withValues(alpha: 0.4)
              : Colors.transparent,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.print,
                color:
                    tieneImpresora ? AppTheme.neonCyan : AppTheme.textTertiary,
                size: 20,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Imprimir ticket (Zebra)',
                  style: TextStyle(
                    color: tieneImpresora
                        ? AppTheme.textPrimary
                        : AppTheme.textSecondary,
                    fontSize: 14,
                  ),
                ),
              ),
              Switch(
                value: tieneImpresora,
                activeThumbColor: AppTheme.neonCyan,
                onChanged: onToggle,
              ),
            ],
          ),
          if (tieneImpresora) ...[
            const SizedBox(height: 8),
            if (printerAddress != null) ...[
              Row(
                children: [
                  Icon(
                    Icons.bluetooth_connected,
                    size: 14,
                    color: lastConnectionResult ?? false
                        ? AppTheme.success
                        : lastConnectionResult == false
                            ? AppTheme.error
                            : AppTheme.textTertiary,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      '${printerName ?? "Zebra"} · '
                      '${ZebraPrintService.maskAddress(printerAddress!)}',
                      style: const TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 12,
                      ),
                    ),
                  ),
                ],
              ),
              if (lastConnectionResult != null)
                Padding(
                  padding: const EdgeInsets.only(top: 4, left: 20),
                  child: Text(
                    lastConnectionResult!
                        ? 'Conectada · Cifrado BT activo'
                        : 'No detectada · Verifica que esté encendida',
                    style: TextStyle(
                      color: lastConnectionResult!
                          ? AppTheme.success
                          : AppTheme.error,
                      fontSize: 11,
                    ),
                  ),
                ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: SizedBox(
                      height: 30,
                      child: OutlinedButton.icon(
                        onPressed:
                            isTestingConnection ? null : onTestConnection,
                        icon: isTestingConnection
                            ? const SizedBox(
                                width: 12,
                                height: 12,
                                child: CircularProgressIndicator(
                                  strokeWidth: 1.5,
                                  color: AppTheme.neonCyan,
                                ),
                              )
                            : const Icon(Icons.wifi_find, size: 14),
                        label: Text(
                          isTestingConnection ? 'Verificando...' : 'Verificar',
                          style: const TextStyle(fontSize: 11),
                        ),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppTheme.neonCyan,
                          side: BorderSide(
                            color: AppTheme.neonCyan.withValues(alpha: 0.4),
                          ),
                          padding: const EdgeInsets.symmetric(horizontal: 8),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: SizedBox(
                      height: 30,
                      child: OutlinedButton.icon(
                        onPressed: onSelectPrinter,
                        icon: const Icon(Icons.swap_horiz, size: 14),
                        label: const Text(
                          'Cambiar',
                          style: TextStyle(fontSize: 11),
                        ),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppTheme.textSecondary,
                          side: const BorderSide(color: AppTheme.borderColor),
                          padding: const EdgeInsets.symmetric(horizontal: 8),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ] else ...[
              SizedBox(
                height: 32,
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: onSelectPrinter,
                  icon: const Icon(Icons.bluetooth_searching, size: 16),
                  label: const Text(
                    'Seleccionar impresora',
                    style: TextStyle(fontSize: 12),
                  ),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppTheme.neonCyan,
                    side: BorderSide(
                      color: AppTheme.neonCyan.withValues(alpha: 0.4),
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }
}
