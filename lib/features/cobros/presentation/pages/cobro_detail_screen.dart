import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/theme/app_theme.dart';
import '../../providers/cobros_provider.dart';
import '../../data/models/cobros_models.dart';

class CobroDetailScreen extends StatefulWidget {
  final String codigoCliente;
  final String nombreCliente;

  const CobroDetailScreen({
    super.key,
    required this.codigoCliente,
    required this.nombreCliente,
  });

  @override
  State<CobroDetailScreen> createState() => _CobroDetailScreenState();
}

class _CobroDetailScreenState extends State<CobroDetailScreen> {
  final _amountController = TextEditingController();
  
  TipoVenta _tipoVenta = TipoVenta.contado; // Contado / Crédito
  TipoModoCobro _tipoModo = TipoModoCobro.normal; // Normal / Especial
  
  bool _isSubmitting = false;

  @override
  void dispose() {
    _amountController.dispose();
    super.dispose();
  }

  Future<void> _submitCobro() async {
    final amountText = _amountController.text.replaceAll(',', '.');
    final importe = double.tryParse(amountText) ?? 0.0;

    if (importe <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Introduce un importe válido mayor a 0', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          backgroundColor: AppTheme.warning,
        ),
      );
      return;
    }

    setState(() {
      _isSubmitting = true;
    });

    final provider = context.read<CobrosProvider>();
    final success = await provider.registrarCobro(
      codigoCliente: widget.codigoCliente,
      referencia: 'COBRO-${DateTime.now().millisecondsSinceEpoch}',
      importe: importe,
      formaPago: 'EFECTIVO', // Assuming cash/default parameter for now
      tipoVenta: _tipoVenta,
      tipoModo: _tipoModo,
    );

    if (!mounted) return;

    setState(() {
      _isSubmitting = false;
    });

    if (success) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Cobro registrado correctamente', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          backgroundColor: AppTheme.neonGreen,
        ),
      );
      Navigator.pop(context); // Go back
    } else {
      final error = provider.error ?? 'Error desconocido al procesar el cobro';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          backgroundColor: AppTheme.error,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      appBar: AppBar(
        backgroundColor: AppTheme.surfaceColor,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.nombreCliente, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            Text('Código: ${widget.codigoCliente}', style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
          ],
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    const SizedBox(height: 20),
                    _buildSectionTitle('TIPO DE VENTA'),
                    const SizedBox(height: 16),
                    _buildTipoVentaToggle(),
                    const SizedBox(height: 40),
                    
                    _buildSectionTitle('MODO DE COBRO'),
                    const SizedBox(height: 16),
                    _buildModoCobroToggle(),
                    const SizedBox(height: 40),
                    
                    _buildSectionTitle('IMPORTE A COBRAR'),
                    const SizedBox(height: 16),
                    _buildAmountInput(),
                  ],
                ),
              ),
            ),
            
            // Footer with confirm button
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: AppTheme.surfaceColor,
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.2),
                    blurRadius: 10,
                    offset: const Offset(0, -5),
                  )
                ],
              ),
              child: SizedBox(
                width: double.infinity,
                height: 56,
                child: ElevatedButton(
                  onPressed: _isSubmitting ? null : _submitCobro,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.neonBlue,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    elevation: 4,
                  ),
                  child: _isSubmitting
                      ? const SizedBox(
                          height: 24,
                          width: 24,
                          child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                        )
                      : const Text(
                          'REGISTRAR COBRO',
                          style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1),
                        ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionTitle(String title) {
    return Text(
      title,
      style: const TextStyle(
        color: AppTheme.textSecondary,
        fontSize: 13,
        fontWeight: FontWeight.bold,
        letterSpacing: 1.5,
      ),
    );
  }

  Widget _buildTipoVentaToggle() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.2),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.05)),
      ),
      padding: const EdgeInsets.all(4),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _buildToggleOption(
            title: 'Contado',
            isSelected: _tipoVenta == TipoVenta.contado,
            onTap: () => setState(() => _tipoVenta = TipoVenta.contado),
          ),
          _buildToggleOption(
            title: 'Crédito',
            isSelected: _tipoVenta == TipoVenta.credito,
            onTap: () => setState(() => _tipoVenta = TipoVenta.credito),
          ),
        ],
      ),
    );
  }

  Widget _buildModoCobroToggle() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.2),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.05)),
      ),
      padding: const EdgeInsets.all(4),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _buildToggleOption(
            title: 'Normal',
            isSelected: _tipoModo == TipoModoCobro.normal,
            onTap: () => setState(() => _tipoModo = TipoModoCobro.normal),
          ),
          _buildToggleOption(
            title: 'Especial',
            isSelected: _tipoModo == TipoModoCobro.especial,
            onTap: () => setState(() => _tipoModo = TipoModoCobro.especial),
          ),
        ],
      ),
    );
  }

  Widget _buildToggleOption({
    required String title,
    required bool isSelected,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 14),
        decoration: BoxDecoration(
          color: isSelected ? AppTheme.neonBlue.withOpacity(0.15) : Colors.transparent,
          borderRadius: BorderRadius.circular(12),
          border: isSelected ? Border.all(color: AppTheme.neonBlue.withOpacity(0.5)) : Border.all(color: Colors.transparent),
        ),
        child: Text(
          title,
          style: TextStyle(
            color: isSelected ? AppTheme.neonBlue : Colors.white.withOpacity(0.5),
            fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
            fontSize: 16,
          ),
        ),
      ),
    );
  }

  Widget _buildAmountInput() {
    return Container(
      constraints: const BoxConstraints(maxWidth: 300),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
        boxShadow: [
          BoxShadow(
            color: AppTheme.neonBlue.withOpacity(0.05),
            blurRadius: 10,
            spreadRadius: 2,
          )
        ],
      ),
      child: TextField(
        controller: _amountController,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        textAlign: TextAlign.center,
        style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: AppTheme.neonBlue),
        decoration: InputDecoration(
          hintText: '0.00',
          hintStyle: TextStyle(color: Colors.white.withOpacity(0.1), fontSize: 32),
          prefixIcon: const Icon(Icons.euro, color: AppTheme.neonBlue, size: 28),
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(vertical: 24),
        ),
      ),
    );
  }
}
