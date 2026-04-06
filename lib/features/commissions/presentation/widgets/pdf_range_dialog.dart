import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../data/commissions_pdf_service.dart';

class PdfRangeDialog extends StatefulWidget {
  final String vendorCode;
  const PdfRangeDialog({super.key, required this.vendorCode});

  @override
  State<PdfRangeDialog> createState() => _PdfRangeDialogState();
}

class _PdfRangeDialogState extends State<PdfRangeDialog> {
  String _selectedRange = 'current';
  bool _isLoading = false;

  final Map<String, String> _rangeLabels = {
    'current': 'Mes actual',
    '1': 'Último mes',
    '2': 'Últimos 2 meses',
    '3': 'Últimos 3 meses',
    'all': 'Todo el año',
  };

  Future<void> _generatePdf() async {
    setState(() => _isLoading = true);
    await CommissionsPdfService.generateAndDownloadPdf(
      context: context,
      vendorCode: widget.vendorCode,
      year: DateTime.now().year,
      range: _selectedRange == 'current' ? '1' : (_selectedRange == 'all' ? null : _selectedRange),
      onLoading: () => setState(() => _isLoading = true),
      onSuccess: () {
        setState(() => _isLoading = false);
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('PDF generado correctamente'), backgroundColor: Colors.green),
        );
      },
      onError: (e) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: AppTheme.surfaceColor,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: const Row(
        children: [
          Icon(Icons.picture_as_pdf_rounded, color: AppTheme.success, size: 24),
          SizedBox(width: 8),
          Expanded(child: Text('Generar Informe PDF', style: TextStyle(color: AppTheme.neonBlue, fontSize: 16))),
        ],
      ),
      content: SizedBox(
        width: 300,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Seleccione el periodo de datos:', style: TextStyle(color: Colors.white70, fontSize: 13)),
            const SizedBox(height: 12),
            ..._rangeLabels.entries.map((entry) => RadioListTile<String>(
              title: Text(entry.value, style: const TextStyle(color: Colors.white, fontSize: 13)),
              value: entry.key,
              groupValue: _selectedRange,
              activeColor: AppTheme.success,
              onChanged: (val) => setState(() => _selectedRange = val!),
            )).toList(),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: Colors.blue.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
              child: const Text(
                '⚠️ El PDF incluirá ventas LAC (reales) por comercial.\nSolo disponible para DIEGO.',
                style: TextStyle(color: Colors.lightBlue, fontSize: 11),
              ),
            ),
          ],
        ),
      ),
      actionsPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      actions: [
        TextButton(
          onPressed: _isLoading ? null : () => Navigator.pop(context),
          child: const Text('CANCELAR', style: TextStyle(color: Colors.red, fontSize: 13)),
        ),
        ElevatedButton(
          onPressed: _isLoading ? null : _generatePdf,
          style: ElevatedButton.styleFrom(backgroundColor: AppTheme.success, padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12)),
          child: _isLoading
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black))
              : const Text('GENERAR PDF', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold, fontSize: 13)),
        ),
      ],
    );
  }
}