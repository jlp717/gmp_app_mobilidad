import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
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
  final _obsController = TextEditingController();
  
  TipoVenta _tipoVenta = TipoVenta.contado;
  TipoModoCobro _tipoModo = TipoModoCobro.normal;
  
  final Set<String> _selectedDocs = {};
  final _currencyFormat = NumberFormat.currency(locale: 'es_ES', symbol: '€');

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<CobrosProvider>().cargarCobrosPendientes(widget.codigoCliente);
      context.read<CobrosProvider>().verificarEstadoCliente(widget.codigoCliente);
    });
  }

  @override
  void dispose() {
    _amountController.dispose();
    _obsController.dispose();
    super.dispose();
  }

  // P1-D FIX: Take provider as param instead of using context.read in a getter
  double _calcularTotalSeleccionado(CobrosProvider provider) {
    return provider.cobrosPendientes
        .where((doc) => _selectedDocs.contains(doc.id))
        .fold(0.0, (sum, doc) => sum + doc.importePendiente);
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
        actions: [
          _buildStatusBadge(),
          const SizedBox(width: 16),
        ],
      ),
      body: Consumer<CobrosProvider>(
        builder: (context, provider, _) {
          if (provider.isLoading && provider.cobrosPendientes.isEmpty) {
            return const Center(child: CircularProgressIndicator());
          }

          // P3-A: Responsive layout — two columns on tablet, stacked on phone
          return LayoutBuilder(
            builder: (context, constraints) {
              if (constraints.maxWidth >= 700) {
                return Row(
                  children: [
                    Expanded(
                      flex: 2,
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _buildSectionTitle('MODO DE PAGO', Icons.settings_suggest),
                            const SizedBox(height: 16),
                            _buildToggles(),
                            const SizedBox(height: 32),
                            _buildSectionTitle('IMPORTE A COBRAR', Icons.euro),
                            const SizedBox(height: 16),
                            _buildAmountInput(),
                            const SizedBox(height: 32),
                            _buildSectionTitle('OBSERVACIONES', Icons.edit_note),
                            const SizedBox(height: 16),
                            _buildObservationsInput(),
                          ],
                        ),
                      ),
                    ),
                    Expanded(
                      flex: 3,
                      child: Container(
                        decoration: BoxDecoration(
                          color: AppTheme.surfaceColor.withOpacity(0.5),
                          border: Border(left: BorderSide(color: Colors.white.withOpacity(0.05))),
                        ),
                        child: Column(
                          children: [
                            Expanded(child: _buildDocumentsList(provider)),
                            _buildSummaryFooter(provider),
                          ],
                        ),
                      ),
                    ),
                  ],
                );
              } else {
                // Phone: stacked layout
                return Column(
                  children: [
                    Expanded(
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _buildSectionTitle('MODO DE PAGO', Icons.settings_suggest),
                            const SizedBox(height: 12),
                            _buildToggles(),
                            const SizedBox(height: 24),
                            _buildSectionTitle('IMPORTE A COBRAR', Icons.euro),
                            const SizedBox(height: 12),
                            _buildAmountInput(),
                            const SizedBox(height: 24),
                            _buildSectionTitle('OBSERVACIONES', Icons.edit_note),
                            const SizedBox(height: 12),
                            _buildObservationsInput(),
                            const SizedBox(height: 24),
                            _buildSectionTitle('DOCUMENTOS PENDIENTES', Icons.description_outlined),
                            const SizedBox(height: 12),
                            SizedBox(
                              height: 200,
                              child: _buildDocumentsList(provider),
                            ),
                          ],
                        ),
                      ),
                    ),
                    _buildSummaryFooter(provider),
                  ],
                );
              }
            },
          );
        },
      ),
    );
  }

  Widget _buildStatusBadge() {
    return Consumer<CobrosProvider>(
      builder: (context, provider, _) {
        final estado = provider.estadoClienteActual;
        if (estado == null) return const SizedBox();
        
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: estado.statusColor.withOpacity(0.1),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: estado.statusColor.withOpacity(0.5)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 8, height: 8,
                decoration: BoxDecoration(color: estado.statusColor, shape: BoxShape.circle),
              ),
              const SizedBox(width: 8),
              Text(
                estado.estado,
                style: TextStyle(color: estado.statusColor, fontSize: 12, fontWeight: FontWeight.bold),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildSectionTitle(String title, IconData icon) {
    return Row(
      children: [
        Icon(icon, color: AppTheme.neonBlue, size: 18),
        const SizedBox(width: 8),
        Text(
          title,
          style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13, fontWeight: FontWeight.bold, letterSpacing: 1.2),
        ),
      ],
    );
  }

  Widget _buildToggles() {
    return Column(
      children: [
        // Contado/Crédito
        _buildSegmentedControl<TipoVenta>(
          label: 'Método',
          value: _tipoVenta,
          items: [
            {'value': TipoVenta.contado, 'label': 'Contado', 'icon': Icons.payments},
            {'value': TipoVenta.credito, 'label': 'Crédito', 'icon': Icons.account_balance_wallet},
          ],
          onChanged: (val) => setState(() => _tipoVenta = val),
        ),
        const SizedBox(height: 16),
        // Normal/Especial
        _buildSegmentedControl<TipoModoCobro>(
          label: 'Contexto',
          value: _tipoModo,
          items: [
            {'value': TipoModoCobro.normal, 'label': 'Normal', 'icon': Icons.assignment},
            {'value': TipoModoCobro.especial, 'label': 'Especial', 'icon': Icons.stars},
          ],
          onChanged: (val) => setState(() => _tipoModo = val),
        ),
      ],
    );
  }

  Widget _buildSegmentedControl<T>({
    required String label,
    required T value,
    required List<Map<String, dynamic>> items,
    required Function(T) onChanged,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11)),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.all(4),
          decoration: BoxDecoration(
            color: Colors.white.withOpacity(0.05),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            children: items.map((item) {
              final isSelected = item['value'] == value;
              return Expanded(
                child: GestureDetector(
                  onTap: () => onChanged(item['value'] as T),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    decoration: BoxDecoration(
                      color: isSelected ? AppTheme.neonBlue.withOpacity(0.2) : Colors.transparent,
                      borderRadius: BorderRadius.circular(10),
                      border: isSelected ? Border.all(color: AppTheme.neonBlue.withOpacity(0.5)) : null,
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(item['icon'] as IconData, size: 16, color: isSelected ? AppTheme.neonBlue : AppTheme.textSecondary),
                        const SizedBox(width: 8),
                        Text(
                          item['label'] as String,
                          style: TextStyle(
                            color: isSelected ? AppTheme.neonBlue : AppTheme.textSecondary,
                            fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                            fontSize: 13,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            }).toList(),
          ),
        ),
      ],
    );
  }

  Widget _buildAmountInput() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.05),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
      ),
      child: TextField(
        controller: _amountController,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: Colors.white),
        textAlign: TextAlign.center,
        decoration: InputDecoration(
          hintText: '0.00',
          hintStyle: TextStyle(color: Colors.white.withOpacity(0.2)),
          prefixIcon: const Icon(Icons.euro, color: AppTheme.neonBlue),
          suffixIcon: IconButton(
            icon: const Icon(Icons.calculate, color: AppTheme.neonBlue),
            onPressed: () {
               setState(() {
                 _amountController.text = _calcularTotalSeleccionado(context.read<CobrosProvider>()).toStringAsFixed(2);
               });
            },
          ),
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(vertical: 20),
        ),
      ),
    );
  }

  Widget _buildObservationsInput() {
    return TextField(
      controller: _obsController,
      maxLines: 3,
      style: const TextStyle(color: AppTheme.textPrimary, fontSize: 13),
      decoration: InputDecoration(
        hintText: 'Añadir notas internas...',
        hintStyle: TextStyle(color: AppTheme.textSecondary.withOpacity(0.3)),
        fillColor: Colors.white.withOpacity(0.05),
        filled: true,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
      ),
    );
  }

  Widget _buildDocumentsList(CobrosProvider provider) {
    if (provider.cobrosPendientes.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.check_circle_outline, size: 48, color: Colors.green.withOpacity(0.3)),
            const SizedBox(height: 16),
            const Text('No hay documentos pendientes', style: TextStyle(color: AppTheme.textSecondary)),
          ],
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('DOCUMENTOS (${provider.cobrosPendientes.length})', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.textSecondary)),
              TextButton(
                onPressed: () {
                  setState(() {
                    if (_selectedDocs.length == provider.cobrosPendientes.length) {
                      _selectedDocs.clear();
                    } else {
                      _selectedDocs.addAll(provider.cobrosPendientes.map((d) => d.id));
                    }
                  });
                },
                child: Text(_selectedDocs.length == provider.cobrosPendientes.length ? 'DESELECCIONAR' : 'SELECCIONAR TODO', style: const TextStyle(fontSize: 10)),
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView.builder(
            itemCount: provider.cobrosPendientes.length,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            itemBuilder: (context, index) {
              final doc = provider.cobrosPendientes[index];
              final isSelected = _selectedDocs.contains(doc.id);
              
              return GestureDetector(
                onTap: () {
                  setState(() {
                    if (isSelected) _selectedDocs.remove(doc.id);
                    else _selectedDocs.add(doc.id);
                  });
                },
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: isSelected ? AppTheme.neonPurple.withOpacity(0.1) : Colors.white.withOpacity(0.03),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: isSelected ? AppTheme.neonPurple.withOpacity(0.5) : Colors.white.withOpacity(0.05)),
                  ),
                  child: Row(
                    children: [
                      Icon(isSelected ? Icons.check_box : Icons.check_box_outline_blank, color: isSelected ? AppTheme.neonPurple : Colors.white24),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(color: doc.tipo.color.withOpacity(0.2), borderRadius: BorderRadius.circular(4)),
                                  child: Text(doc.tipo.label, style: TextStyle(color: doc.tipo.color, fontSize: 9, fontWeight: FontWeight.bold)),
                                ),
                                const SizedBox(width: 8),
                                Text(doc.referencia, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Text(DateFormat('dd/MM/yyyy').format(doc.fecha), style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                          ],
                        ),
                      ),
                      Text(_currencyFormat.format(doc.importePendiente), style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.white)),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _buildSummaryFooter(CobrosProvider provider) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        border: Border(top: BorderSide(color: Colors.white.withOpacity(0.05))),
      ),
      child: SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Total Seleccionado:', style: TextStyle(color: AppTheme.textSecondary)),
                Text(_currencyFormat.format(_calcularTotalSeleccionado(provider)), style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
              ],
            ),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              height: 56,
              child: ElevatedButton(
                onPressed: _showConfirmationModal,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.neonPurple,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  elevation: 8,
                ),
                child: const Text('REGISTRAR COBRO', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.1)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showConfirmationModal() {
    final amount = double.tryParse(_amountController.text) ?? 0;
    if (amount <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Por favor, indica un importe válido')));
      return;
    }
    // P3-B: Guard empty documents in normal mode
    if (_tipoModo == TipoModoCobro.normal && _selectedDocs.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Selecciona al menos un documento pendiente')),
      );
      return;
    }

    showDialog(
      context: context,
      builder: (context) => _ConfirmationDialog(
        cliente: widget.nombreCliente,
        importe: amount,
        metodo: _tipoVenta.label,
        modo: _tipoModo.label,
        onConfirm: _ejecutarCobro,
      ),
    );
  }

  Future<void> _ejecutarCobro() async {
    final provider = context.read<CobrosProvider>();
    final amount = double.tryParse(_amountController.text) ?? 0;
    
    final success = await provider.registrarCobro(
      codigoCliente: widget.codigoCliente,
      referencia: _tipoModo == TipoModoCobro.normal 
          ? _selectedDocs.join(', ') 
          : 'Cobro Especial',
      importe: amount,
      formaPago: _tipoVenta.code,
      tipoVenta: _tipoVenta,
      tipoModo: _tipoModo,
      observaciones: _obsController.text,
    );

    if (success && mounted) {
      Navigator.pop(context); // Close detail screen
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Cobro registrado correctamente'),
          backgroundColor: Colors.green,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      );
    }
  }
}

class _ConfirmationDialog extends StatelessWidget {
  final String cliente;
  final double importe;
  final String metodo;
  final String modo;
  final VoidCallback onConfirm;

  const _ConfirmationDialog({
    required this.cliente,
    required this.importe,
    required this.metodo,
    required this.modo,
    required this.onConfirm,
  });

  @override
  Widget build(BuildContext context) {
    final currencyFormat = NumberFormat.currency(locale: 'es_ES', symbol: '€');
    
    return Dialog(
      backgroundColor: Colors.transparent,
      child: Container(
        width: 320,
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: AppTheme.surfaceColor,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: Colors.white10),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: AppTheme.neonPurple.withOpacity(0.1), shape: BoxShape.circle),
              child: const Icon(Icons.verified_user, color: AppTheme.neonPurple, size: 32),
            ),
            const SizedBox(height: 16),
            const Text('¿Confirmar Cobro?', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            const SizedBox(height: 24),
            _buildInfoRow('Cliente', cliente),
            _buildInfoRow('Importe', currencyFormat.format(importe), isBold: true),
            _buildInfoRow('Método', metodo),
            _buildInfoRow('Modo', modo),
            const SizedBox(height: 32),
            Row(
              children: [
                Expanded(
                  child: TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('CANCELAR', style: TextStyle(color: AppTheme.textSecondary)),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    onPressed: () {
                      Navigator.pop(context);
                      onConfirm();
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.neonPurple,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                    child: const Text('CONFIRMAR'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInfoRow(String label, String value, {bool isBold = false}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
          Text(value, style: TextStyle(fontWeight: isBold ? FontWeight.bold : FontWeight.normal, fontSize: 13)),
        ],
      ),
    );
  }
}
