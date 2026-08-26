import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/commissions/data/commissions_pdf_service.dart';

class PdfRangeDialog extends StatefulWidget {
  const PdfRangeDialog({required this.vendorCode, super.key});
  final String vendorCode;

  @override
  State<PdfRangeDialog> createState() => _PdfRangeDialogState();
}

class _PdfRangeDialogState extends State<PdfRangeDialog> {
  final Set<int> _selectedMonths = {};
  bool _isLoading = false;
  bool _dropdownExpanded = false;
  String _pdfType = 'commissions';

  final Map<int, String> _monthNames = {
    1: 'Enero',
    2: 'Febrero',
    3: 'Marzo',
    4: 'Abril',
    5: 'Mayo',
    6: 'Junio',
    7: 'Julio',
    8: 'Agosto',
    9: 'Septiembre',
    10: 'Octubre',
    11: 'Noviembre',
    12: 'Diciembre',
  };

  @override
  void initState() {
    super.initState();
    // Por defecto, seleccionar solo el mes ANTERIOR al actual (si estamos en mayo, seleccionar abril)
    final now = DateTime.now();
    final currentMonth = now.month;
    // Si estamos a 5 de mayo (mes 5), el mes anterior es abril (4)
    // Seleccionamos el mes anterior por defecto
    if (currentMonth > 1) {
      _selectedMonths.add(currentMonth - 1);
    }
  }

  void _setLoading(bool value) {
    if (!mounted) return;
    setState(() => _isLoading = value);
  }

  void _toggleMonth(int month) {
    setState(() {
      if (_selectedMonths.contains(month)) {
        _selectedMonths.remove(month);
      } else {
        _selectedMonths.add(month);
      }
    });
  }

  void _selectAll() {
    setState(() {
      final currentMonth = DateTime.now().month;
      _selectedMonths.clear();
      for (var i = 1; i <= currentMonth; i++) {
        _selectedMonths.add(i);
      }
    });
  }

  void _clearAll() {
    setState(_selectedMonths.clear);
  }

  String _getSelectedMonthsText() {
    if (_selectedMonths.isEmpty) return 'Ningún mes seleccionado';
    final sortedMonths = _selectedMonths.toList()..sort();
    if (sortedMonths.length == 1) {
      return _monthNames[sortedMonths.first]!;
    }
    return '${sortedMonths.length} meses seleccionados';
  }

  Future<void> _generatePdf() async {
    if (_selectedMonths.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Selecciona al menos un mes'),
          backgroundColor: AppTheme.warning,
        ),
      );
      return;
    }

    _setLoading(true);
    final monthsParam = _selectedMonths.toList()..sort();
    await CommissionsPdfService.generateAndDownloadPdf(
      vendorCode: widget.vendorCode,
      year: DateTime.now().year,
      months: monthsParam.join(','),
      pdfType: _pdfType,
      onLoading: () => _setLoading(true),
      onSuccess: () {
        if (!mounted) return;
        _setLoading(false);
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('PDF generado correctamente'),
            backgroundColor: Colors.green,
          ),
        );
      },
      onError: (e) {
        if (!mounted) return;
        _setLoading(false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final currentMonth = DateTime.now().month;
    final currentYear = DateTime.now().year;

    return AlertDialog(
      backgroundColor: AppTheme.raisedSurface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.radiusXl),
        side: BorderSide(color: AppTheme.borderColor.withValues(alpha: 0.84)),
      ),
      title: const Row(
        children: [
          Icon(Icons.picture_as_pdf_rounded, color: AppTheme.success, size: 24),
          SizedBox(width: 8),
          Expanded(
            child: Text(
              'Generar Informe PDF',
              style: TextStyle(
                color: AppTheme.textPrimary,
                fontSize: 16,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
      content: SizedBox(
        width: 350,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppTheme.softPanel,
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                border: Border.all(color: AppTheme.borderColor),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Tipo de informe',
                    style: TextStyle(
                      color: AppTheme.textSecondary,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 8),
                  RadioListTile<String>(
                    value: 'commissions',
                    groupValue: _pdfType,
                    onChanged: _isLoading
                        ? null
                        : (value) => setState(() => _pdfType = value!),
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: const Text(
                      'Comisiones',
                      style: TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    subtitle: const Text(
                      'Objetivo, ventas LAC/B, comisiones y totales',
                      style: TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 10,
                      ),
                    ),
                    activeColor: AppTheme.success,
                  ),
                  RadioListTile<String>(
                    value: 'payment_record',
                    groupValue: _pdfType,
                    onChanged: _isLoading
                        ? null
                        : (value) => setState(() => _pdfType = value!),
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: const Text(
                      'Registro de pagos',
                      style: TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    subtitle: const Text(
                      'Ventas LAC por cliente del comercial seleccionado',
                      style: TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 10,
                      ),
                    ),
                    activeColor: AppTheme.info,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            // DESPLEGABLE con checkboxes para múltiples meses
            Container(
              decoration: BoxDecoration(
                color: AppTheme.softPanel,
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                border: Border.all(
                  color: _dropdownExpanded
                      ? AppTheme.info.withValues(alpha: 0.72)
                      : AppTheme.borderColor,
                ),
              ),
              child: Column(
                children: [
                  // Header del dropdown ( siempre visible )
                  InkWell(
                    onTap: () =>
                        setState(() => _dropdownExpanded = !_dropdownExpanded),
                    borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.calendar_month,
                            color: AppTheme.info,
                            size: 20,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  'Seleccionar meses',
                                  style: TextStyle(
                                    color: AppTheme.textSecondary,
                                    fontSize: 11,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  _getSelectedMonthsText(),
                                  style: const TextStyle(
                                    color: AppTheme.textPrimary,
                                    fontSize: 14,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          AnimatedRotation(
                            turns: _dropdownExpanded ? 0.5 : 0,
                            duration: const Duration(milliseconds: 200),
                            child: Icon(
                              Icons.expand_more,
                              color: _dropdownExpanded
                                  ? AppTheme.info
                                  : AppTheme.textSecondary,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  // Dropdown expandido con checkboxes
                  if (_dropdownExpanded) ...[
                    const Divider(color: AppTheme.borderColor, height: 1),
                    Container(
                      constraints: const BoxConstraints(maxHeight: 250),
                      child: SingleChildScrollView(
                        child: Column(
                          children: [
                            // Botones de acción rápida
                            Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 8,
                              ),
                              child: Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceEvenly,
                                children: [
                                  _QuickActionButton(
                                    label: 'Este mes',
                                    onTap: () {
                                      setState(() {
                                        _selectedMonths.clear();
                                        _selectedMonths.add(currentMonth);
                                      });
                                    },
                                  ),
                                  _QuickActionButton(
                                    label: 'Mes anterior',
                                    onTap: () {
                                      setState(() {
                                        _selectedMonths.clear();
                                        if (currentMonth > 1) {
                                          _selectedMonths.add(currentMonth - 1);
                                        }
                                      });
                                    },
                                  ),
                                  _QuickActionButton(
                                    label: 'Todos',
                                    onTap: () {
                                      setState(() {
                                        _selectedMonths.clear();
                                        for (var i = 1;
                                            i <= currentMonth;
                                            i++) {
                                          _selectedMonths.add(i);
                                        }
                                      });
                                    },
                                  ),
                                ],
                              ),
                            ),
                            const Divider(
                              color: AppTheme.borderColor,
                              height: 1,
                            ),
                            // Lista de meses con checkboxes
                            ...List.generate(currentMonth, (index) {
                              final month = index + 1;
                              final isSelected =
                                  _selectedMonths.contains(month);
                              return CheckboxListTile(
                                value: isSelected,
                                onChanged: (_) => _toggleMonth(month),
                                title: Text(
                                  '${_monthNames[month]} $currentYear',
                                  style: TextStyle(
                                    color: isSelected
                                        ? AppTheme.info
                                        : AppTheme.textPrimary,
                                    fontWeight: isSelected
                                        ? FontWeight.w600
                                        : FontWeight.normal,
                                  ),
                                ),
                                subtitle: Text(
                                  _getMonthDescription(month),
                                  style: const TextStyle(
                                    color: AppTheme.textSecondary,
                                    fontSize: 10,
                                  ),
                                ),
                                activeColor: AppTheme.success,
                                checkColor: Colors.white,
                                dense: true,
                                controlAffinity:
                                    ListTileControlAffinity.leading,
                              );
                            }),
                          ],
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 16),
            // Resumen de selección
            if (_selectedMonths.isNotEmpty)
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppTheme.success.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                  border: Border.all(
                    color: AppTheme.success.withValues(alpha: 0.28),
                  ),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.check_circle,
                      color: AppTheme.success,
                      size: 18,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${_selectedMonths.length} mes(es) seleccionado(s)',
                            style: const TextStyle(
                              color: AppTheme.success,
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            () {
                              final sorted = _selectedMonths.toList()..sort();
                              return sorted
                                  .map((m) => _monthNames[m])
                                  .join(', ');
                            }(),
                            style: const TextStyle(
                              color: AppTheme.success,
                              fontSize: 10,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      icon: const Icon(
                        Icons.clear,
                        color: AppTheme.textSecondary,
                        size: 18,
                      ),
                      onPressed: _clearAll,
                      tooltip: 'Limpiar selección',
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 12),
            // Info adicional
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppTheme.info.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                border: Border.all(color: AppTheme.info.withValues(alpha: 0.2)),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.info_outline,
                    color: AppTheme.info,
                    size: 16,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _pdfType == 'payment_record'
                          ? 'El registro de pagos usa ventas LAC por cliente del comercial actual. Requiere un vendedor concreto (no ALL).'
                          : 'El PDF incluirá objetivo, ventas LAC, ventas B, comisiones y totales.\nSolo disponible para DIEGO.',
                      style: const TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 11,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      actionsPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      actions: [
        TextButton(
          onPressed: _isLoading ? null : () => Navigator.pop(context),
          child: const Text(
            'CANCELAR',
            style: TextStyle(color: AppTheme.error, fontSize: 13),
          ),
        ),
        ElevatedButton(
          onPressed: _isLoading ? null : _generatePdf,
          style: ElevatedButton.styleFrom(
            backgroundColor: AppTheme.success,
            foregroundColor: Colors.white,
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          ),
          child: _isLoading
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                )
              : const Text(
                  'GENERAR PDF',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 13,
                  ),
                ),
        ),
      ],
    );
  }

  String _getMonthDescription(int month) {
    final now = DateTime.now();
    if (month == now.month) {
      return 'Mes actual';
    } else if (month == now.month - 1) {
      return 'Mes anterior';
    } else if (month < now.month) {
      return 'Mes completado';
    }
    return '';
  }
}

class _QuickActionButton extends StatelessWidget {
  const _QuickActionButton({required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppTheme.radiusSm),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: AppTheme.info.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(AppTheme.radiusSm),
          border: Border.all(color: AppTheme.info.withValues(alpha: 0.22)),
        ),
        child: Text(
          label,
          style: const TextStyle(
            color: AppTheme.info,
            fontSize: 11,
            fontWeight: FontWeight.w500,
          ),
        ),
      ),
    );
  }
}
