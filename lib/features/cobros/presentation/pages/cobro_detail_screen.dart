import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';

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
  final _currencyFormat = NumberFormat.currency(locale: 'es_ES', symbol: '€');
  
  TipoVenta _tipoVenta = TipoVenta.contado; // Contado / Crédito
  TipoModoCobro _tipoModo = TipoModoCobro.normal; // Normal / Especial
  
  // itemId -> 'NONE', 'PARCIAL', 'COMPLETO'
  final Map<String, String> _itemStates = {};
  // itemId -> partial amount entered
  final Map<String, double> _partialAmounts = {};

  bool _isSubmitting = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<CobrosProvider>().cargarCobrosPendientes(widget.codigoCliente);
    });
  }

  double _getDeudaTotal(List<CobroPendiente> pendientes) {
    return pendientes.fold(0.0, (sum, item) => sum + item.importePendiente);
  }

  double _calcularTotalACobrar(List<CobroPendiente> pendientes) {
    double total = 0;
    for (final item in pendientes) {
      final state = _itemStates[item.id] ?? 'NONE';
      if (state == 'COMPLETO') {
        total += item.importePendiente;
      } else if (state == 'PARCIAL') {
        total += _partialAmounts[item.id] ?? 0.0;
      }
    }
    return total;
  }

  Future<void> _submitCobro(double totalACobrar) async {
    if (totalACobrar <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('El importe total a cobrar debe ser mayor a 0', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          backgroundColor: AppTheme.warning,
        ),
      );
      return;
    }

    setState(() {
      _isSubmitting = true;
    });

    final provider = context.read<CobrosProvider>();
    
    // In a real scenario, the backend API should accept the list of specific documents paid.
    // However, the current registrarCobro just takes one reference and one total amount.
    // We will call registrarCobro with the aggregated total, as defined by the existing provider.
    final success = await provider.registrarCobro(
      codigoCliente: widget.codigoCliente,
      referencia: 'COBRO-${DateTime.now().millisecondsSinceEpoch}',
      importe: totalACobrar,
      formaPago: 'EFECTIVO',
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
      backgroundColor: Colors.white, // In emulator photo it looks gray/light
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E1E1E), // Dark top bar
        leadingWidth: 100,
        leading: Padding(
          padding: const EdgeInsets.all(8.0),
          child: ElevatedButton(
            onPressed: () => Navigator.pop(context),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF333333),
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
            ),
            child: const Text('Volver'),
          ),
        ),
        title: const Text('Cobros', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        centerTitle: true,
      ),
      body: Consumer<CobrosProvider>(
        builder: (context, provider, _) {
          final pendientes = provider.cobrosPendientes;
          final totalAbonar = _calcularTotalACobrar(pendientes);
          final deudaTotal = _getDeudaTotal(pendientes);

          return Column(
            children: [
              // 1. TIPO DE VENTA TOGGLES
              Row(
                children: [
                  _buildTopToggle(
                    title: 'Contado',
                    isSelected: _tipoVenta == TipoVenta.contado,
                    onTap: () => setState(() => _tipoVenta = TipoVenta.contado),
                  ),
                  _buildTopToggle(
                    title: 'Credito',
                    isSelected: _tipoVenta == TipoVenta.credito,
                    onTap: () => setState(() => _tipoVenta = TipoVenta.credito),
                  ),
                ],
              ),
              // 2. MODO COBRO TOGGLES
              Row(
                children: [
                  _buildTopToggle(
                    title: 'Normal',
                    isSelected: _tipoModo == TipoModoCobro.normal,
                    onTap: () => setState(() => _tipoModo = TipoModoCobro.normal),
                  ),
                  _buildTopToggle(
                    title: 'Especial',
                    isSelected: _tipoModo == TipoModoCobro.especial,
                    onTap: () => setState(() => _tipoModo = TipoModoCobro.especial),
                  ),
                ],
              ),
              
              // 3. GREEN LINE SEPARATOR
              Container(
                height: 6,
                width: double.infinity,
                color: const Color(0xFF8CC63F), // Lime green from photo
              ),
              
              // 4. CLIENT CODE & NAME
              Container(
                padding: const EdgeInsets.symmetric(vertical: 16),
                width: double.infinity,
                color: const Color(0xFFE5E5E5), // Light gray background
                alignment: Alignment.center,
                child: Text(
                  '${widget.codigoCliente}  ${widget.nombreCliente.toUpperCase()}',
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Color(0xFF1B5E20), // Dark green text
                  ),
                ),
              ),

              // 5. TOTAL HEADER (DEUDA TOTAL)
              Container(
                margin: const EdgeInsets.symmetric(horizontal: 16),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: BoxDecoration(
                  color: const Color(0xFF2B2B2B), // Dark gray
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Total', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
                    Text(
                      _currencyFormat.format(deudaTotal),
                      style: const TextStyle(color: Color(0xFFF44336), fontSize: 24, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 8),

              // 6. LIST OF DOCUMENTS
              Expanded(
                child: Container(
                  color: const Color(0xFFE5E5E5), // Gray background matching the photo
                  child: provider.isLoading 
                    ? const Center(child: CircularProgressIndicator())
                    : pendientes.isEmpty
                        ? const Center(child: Text('No hay documentos pendientes', style: TextStyle(color: Colors.black54)))
                        : ListView.builder(
                            padding: const EdgeInsets.all(8),
                            itemCount: pendientes.length,
                            itemBuilder: (context, index) {
                              return _buildCobroItemCard(pendientes[index]);
                            },
                          ),
                ),
              ),

              // 7. BOTTOM TOTAL "Total a cobrar: XX €"
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 16),
                color: const Color(0xFF1E1E1E), // Dark bar
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text('Total a cobrar: ', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
                    Text(
                      _currencyFormat.format(totalAbonar),
                      style: const TextStyle(color: Color(0xFF42A5F5), fontSize: 24, fontWeight: FontWeight.bold), // Light blue text
                    ),
                  ],
                ),
              ),

              // 8. COBRAR BUTTON (Green checkmark)
              InkWell(
                onTap: _isSubmitting ? null : () => _submitCobro(totalAbonar),
                child: Container(
                  width: double.infinity,
                  color: const Color(0xFF2B2B2B), // Darkest gray
                  padding: const EdgeInsets.symmetric(vertical: 20),
                  child: Column(
                    children: [
                      if (_isSubmitting)
                        const SizedBox(height: 32, width: 32, child: CircularProgressIndicator(color: Colors.green))
                      else
                        const Icon(Icons.check, color: Colors.green, size: 40),
                      const SizedBox(height: 8),
                      const Text('Cobrar', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildTopToggle({
    required String title,
    required bool isSelected,
    required VoidCallback onTap,
  }) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          decoration: BoxDecoration(
            color: isSelected ? const Color(0xFF29B6F6) : const Color(0xFF424242), // Light Blue if active, dark gray if not
            border: Border.all(color: Colors.black, width: 0.5),
          ),
          padding: const EdgeInsets.symmetric(vertical: 16),
          alignment: Alignment.center,
          child: Text(
            title,
            style: TextStyle(
              color: isSelected ? Colors.white : Colors.white70,
              fontWeight: FontWeight.bold,
              fontSize: 16,
            ),
          ),
        ),
      ),
    );
  }

  // A card representation combining the standard item and the "L / PARCIAL / COMPLETO" buttons from photo
  Widget _buildCobroItemCard(CobroPendiente item) {
    final state = _itemStates[item.id] ?? 'NONE';
    final isParcial = state == 'PARCIAL';
    final isCompleto = state == 'COMPLETO';
    
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      elevation: 2,
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Vertical tabs simulation
            SizedBox(
              width: 40,
              child: Column(
                children: [
                  _buildVerticalTab(
                  text: 'L',
                  color: state == 'NONE' ? Colors.grey.shade400 : Colors.grey.shade300,
                  isActive: state == 'NONE',
                  onTap: () {
                    setState(() {
                      _itemStates[item.id] = 'NONE';
                      _partialAmounts.remove(item.id);
                    });
                  },
                ),
                _buildVerticalTab(
                  text: 'P',
                  color: isParcial ? const Color(0xFFFFF59D) : Colors.yellow.shade100, // Yellow
                  isActive: isParcial,
                  onTap: () => _openPartialDialog(item),
                ),
                _buildVerticalTab(
                  text: 'C',
                  color: isCompleto ? const Color(0xFFA5D6A7) : Colors.green.shade100, // Light green
                  isActive: isCompleto,
                  onTap: () {
                    setState(() {
                      _itemStates[item.id] = 'COMPLETO';
                      _partialAmounts[item.id] = item.importePendiente;
                    });
                  },
                ),
              ],
            ),
          ),
          
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(item.referencia, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                      Text(DateFormat('dd/MM/yyyy').format(item.fecha), style: const TextStyle(color: Colors.black54)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(item.tipo.label.toUpperCase(), style: TextStyle(color: item.tipo.color, fontWeight: FontWeight.bold)),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text('Deuda: ${_currencyFormat.format(item.importePendiente)}', style: const TextStyle(fontWeight: FontWeight.bold)),
                          if (isParcial)
                            Text('A pagar: ${_currencyFormat.format(_partialAmounts[item.id] ?? 0)}', style: const TextStyle(color: Color(0xFFF44336), fontWeight: FontWeight.bold)),
                        ],
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
      ),
    );
  }

  Widget _buildVerticalTab({
    required String text,
    required Color color,
    required bool isActive,
    required VoidCallback onTap,
  }) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          decoration: BoxDecoration(
            color: color,
            border: Border(
              bottom: const BorderSide(color: Colors.black12),
              right: BorderSide(color: isActive ? color : Colors.black26, width: isActive ? 2 : 1),
            ),
          ),
          alignment: Alignment.center,
          child: Text(
            text,
            style: TextStyle(
              fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
              fontSize: 14,
              color: isActive ? Colors.black87 : Colors.black54,
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _openPartialDialog(CobroPendiente item) async {
    final controller = TextEditingController(
      text: _partialAmounts[item.id]?.toStringAsFixed(2) ?? '',
    );

    final result = await showDialog<double>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Pago parcial'),
          content: TextField(
            controller: controller,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(
              hintText: 'Importe a cobrar',
              suffixText: '€',
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
            ),
            autofocus: true,
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancelar'),
            ),
            ElevatedButton(
              onPressed: () {
                final text = controller.text.replaceAll(',', '.');
                final val = double.tryParse(text);
                Navigator.pop(context, val);
              },
              style: ElevatedButton.styleFrom(backgroundColor: AppTheme.neonBlue, foregroundColor: Colors.white),
              child: const Text('Aceptar'),
            ),
          ],
        );
      },
    );

    if (result != null && result > 0) {
      double parsed = result;
      if (parsed > item.importePendiente) {
        parsed = item.importePendiente;
      }
      setState(() {
        _itemStates[item.id] = 'PARCIAL';
        _partialAmounts[item.id] = parsed;
      });
    }
  }
}
