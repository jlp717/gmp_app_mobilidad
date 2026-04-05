import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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

  // Toggles state
  String _formaPago = 'CONTADO'; // CONTADO, CREDITO
  String _tipoVenta = 'NORMAL'; // NORMAL, ESPECIAL

  // Per-item state map to store whether an item is COMPLETO, PARCIAL, or NONE (L)
  final Map<String, String> _itemStates = {};
  // For partial payments, store the exact amount
  final Map<String, double> _partialAmounts = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context
          .read<CobrosProvider>()
          .cargarCobrosPendientes(widget.codigoCliente);
    });
  }

  double _calcularTotalACobrar() {
    double total = 0.0;
    _itemStates.forEach((id, state) {
      if (state == 'COMPLETO') {
        final prov = context.read<CobrosProvider>();
        final item = prov.cobrosPendientes.firstWhere((e) => e.id == id);
        total += item.importePendiente;
      } else if (state == 'PARCIAL') {
        total += (_partialAmounts[id] ?? 0.0);
      }
    });
    return total;
  }

  Future<void> _submitCobro(double totalACobrar) async {
    if (totalACobrar <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Selecciona algún documento para cobrar')),
      );
      return;
    }

    // Process all selected items
    final provider = context.read<CobrosProvider>();
    int exitos = 0;
    int fallos = 0;

    // Show loading
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => const Center(child: CircularProgressIndicator()),
    );

    for (var entry in _itemStates.entries) {
      if (entry.value == 'NONE') continue;

      final item =
          provider.cobrosPendientes.firstWhere((e) => e.id == entry.key);
      final importe = entry.value == 'COMPLETO'
          ? item.importePendiente
          : (_partialAmounts[entry.key] ?? 0.0);

      final success = await provider.registrarCobro(
        codigoCliente: widget.codigoCliente,
        referencia: item.referencia,
        importe: importe,
        formaPago: _formaPago,
        tipoVenta: TipoVenta.values.firstWhere(
          (e) => e.label.toUpperCase() == _formaPago,
          orElse: () => TipoVenta.contado,
        ),
        tipoModo: TipoModoCobro.values.firstWhere(
          (e) => e.label.toUpperCase() == _tipoVenta,
          orElse: () => TipoModoCobro.normal,
        ),
      );

      if (success) {
        exitos++;
      } else {
        fallos++;
      }
    }

    if (!mounted) return;
    Navigator.of(context).pop(); // close loading

    if (fallos == 0 && exitos > 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Cobro registrado correctamente'),
            backgroundColor: AppTheme.success),
      );
      Navigator.of(context).pop(); // Return to previous screen
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text('Terminado con $fallos errores. Revisa los datos.'),
            backgroundColor: AppTheme.error),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<CobrosProvider>();
    final pendientes = provider.cobrosPendientes;
    final totalAbonar = _calcularTotalACobrar();

    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios, color: AppTheme.neonBlue),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: const Text('Gestión de Cobro',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
      ),
      body: SafeArea(
        child: Column(
          children: [
            // 1. TOP TOGGLES
            Padding(
              padding:
                  const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
              child: Row(
                children: [
                  Expanded(
                    child: _buildNeonSegmentedControl(
                      option1: 'CONTADO',
                      option2: 'CREDITO',
                      selectedValue: _formaPago,
                      onChanged: (val) => setState(() => _formaPago = val),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: _buildNeonSegmentedControl(
                      option1: 'NORMAL',
                      option2: 'ESPECIAL',
                      selectedValue: _tipoVenta,
                      onChanged: (val) => setState(() => _tipoVenta = val),
                      color: AppTheme
                          .neonPurple, // Purple for the second set of toggles
                    ),
                  ),
                ],
              ),
            ),

            // 2. HEADER: CLIENT INFO & TOTAL DEBT
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              padding: const EdgeInsets.all(20),
              decoration: AppTheme.holoCard(glowColor: AppTheme.error),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: AppTheme.neonBlue.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child:
                            const Icon(Icons.person, color: AppTheme.neonBlue),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          '${widget.codigoCliente} - ${widget.nombreCliente}',
                          style: const TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                              color: Colors.white),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 16.0),
                    child: Divider(color: Colors.white24, height: 1),
                  ),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('DOCUMENTOS PENDIENTES',
                          style: TextStyle(
                              color: Colors.white70,
                              fontSize: 14,
                              letterSpacing: 1.2)),
                      Text(
                        '${pendientes.length}',
                        style: const TextStyle(
                          color: Colors.white70,
                          fontSize: 20,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),

            // 3. LIST OF DOCUMENTS
            Expanded(
              child: Container(
                margin: const EdgeInsets.symmetric(horizontal: 16),
                decoration: BoxDecoration(
                  color: AppTheme.darkSurface.withOpacity(0.5),
                  borderRadius:
                      const BorderRadius.vertical(top: Radius.circular(20)),
                  border: Border.all(color: Colors.white12),
                ),
                child: provider.isLoading
                    ? const Center(
                        child:
                            CircularProgressIndicator(color: AppTheme.neonBlue))
                    : provider.error != null
                        ? Center(
                            child: Text(provider.error!,
                                style: const TextStyle(color: AppTheme.error)))
                        : pendientes.isEmpty
                            ? Center(
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(Icons.check_circle_outline,
                                        size: 60,
                                        color:
                                            AppTheme.success.withOpacity(0.5)),
                                    const SizedBox(height: 16),
                                    const Text('Cliente sin deuda pendiente',
                                        style: TextStyle(
                                            color: Colors.white70,
                                            fontSize: 18)),
                                  ],
                                ),
                              )
                            : ListView.builder(
                                padding: const EdgeInsets.all(12),
                                itemCount: pendientes.length,
                                itemBuilder: (context, index) {
                                  return _buildPremiumItemCard(
                                      pendientes[index]);
                                },
                              ),
              ),
            ),

            // 4. BOTTOM ACTION BAR
            Container(
              padding: const EdgeInsets.fromLTRB(24, 20, 24, 32),
              decoration: BoxDecoration(
                color: AppTheme.darkBase,
                boxShadow: [
                  BoxShadow(
                      color: AppTheme.neonBlue.withOpacity(0.1),
                      blurRadius: 20,
                      offset: const Offset(0, -5))
                ],
                border: const Border(top: BorderSide(color: Colors.white12)),
              ),
              child: SafeArea(
                top: false,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Text('TOTAL A COBRAR',
                            style: TextStyle(
                                color: Colors.white54,
                                fontSize: 12,
                                letterSpacing: 1.2)),
                        const SizedBox(height: 4),
                        Text(
                          _currencyFormat.format(totalAbonar),
                          style: const TextStyle(
                              color: AppTheme.neonBlue,
                              fontSize: 28,
                              fontWeight: FontWeight.w900,
                              shadows: [
                                Shadow(color: AppTheme.neonBlue, blurRadius: 10)
                              ]),
                        ),
                      ],
                    ),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: totalAbonar > 0
                            ? AppTheme.success
                            : AppTheme.darkCard,
                        padding: const EdgeInsets.symmetric(
                            horizontal: 40, vertical: 16),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16)),
                        elevation: totalAbonar > 0 ? 10 : 0,
                        shadowColor: AppTheme.success.withOpacity(0.5),
                      ),
                      onPressed: totalAbonar > 0
                          ? () => _submitCobro(totalAbonar)
                          : null,
                      child: Row(
                        children: [
                          Icon(Icons.check_circle,
                              color: totalAbonar > 0
                                  ? AppTheme.darkBase
                                  : Colors.white54,
                              size: 24),
                          const SizedBox(width: 8),
                          Text('COBRAR',
                              style: TextStyle(
                                color: totalAbonar > 0
                                    ? AppTheme.darkBase
                                    : Colors.white54,
                                fontSize: 18,
                                fontWeight: FontWeight.w900,
                                letterSpacing: 1.5,
                              )),
                        ],
                      ),
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

  /// Builds a modern segmented control for toggles
  Widget _buildNeonSegmentedControl({
    required String option1,
    required String option2,
    required String selectedValue,
    required Function(String) onChanged,
    Color color = AppTheme.neonBlue,
  }) {
    return Container(
      height: 48,
      decoration: BoxDecoration(
        color: AppTheme.darkSurface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white12),
      ),
      child: Row(
        children: [
          Expanded(
            child: GestureDetector(
              onTap: () => onChanged(option1),
              child: Container(
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: selectedValue == option1
                      ? color.withOpacity(0.2)
                      : Colors.transparent,
                  borderRadius: BorderRadius.circular(11),
                  border: Border.all(
                      color:
                          selectedValue == option1 ? color : Colors.transparent,
                      width: 2),
                ),
                child: Text(
                  option1,
                  style: TextStyle(
                    color: selectedValue == option1 ? color : Colors.white54,
                    fontWeight: selectedValue == option1
                        ? FontWeight.bold
                        : FontWeight.normal,
                    letterSpacing: 1.2,
                  ),
                ),
              ),
            ),
          ),
          Expanded(
            child: GestureDetector(
              onTap: () => onChanged(option2),
              child: Container(
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: selectedValue == option2
                      ? color.withOpacity(0.2)
                      : Colors.transparent,
                  borderRadius: BorderRadius.circular(11),
                  border: Border.all(
                      color:
                          selectedValue == option2 ? color : Colors.transparent,
                      width: 2),
                ),
                child: Text(
                  option2,
                  style: TextStyle(
                    color: selectedValue == option2 ? color : Colors.white54,
                    fontWeight: selectedValue == option2
                        ? FontWeight.bold
                        : FontWeight.normal,
                    letterSpacing: 1.2,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Premium dark card with modern L / P / C side controls
  Widget _buildPremiumItemCard(CobroPendiente item) {
    final state = _itemStates[item.id] ?? 'NONE';
    final isParcial = state == 'PARCIAL';
    final isCompleto = state == 'COMPLETO';

    // Choose glow based on state
    Color cardBorder;
    if (isCompleto)
      cardBorder = AppTheme.success;
    else if (isParcial)
      cardBorder = AppTheme.warning;
    else
      cardBorder = Colors.white12;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: cardBorder, width: state != 'NONE' ? 2 : 1),
        boxShadow: state != 'NONE'
            ? [BoxShadow(color: cardBorder.withOpacity(0.2), blurRadius: 10)]
            : [],
      ),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Left control panel (L/P/C)
            Container(
              width: 50,
              decoration: const BoxDecoration(
                color: AppTheme.darkSurface,
                border: Border(right: BorderSide(color: Colors.white12)),
              ),
              child: Column(
                children: [
                  _buildControlTab(
                    text: 'L',
                    icon: Icons.close,
                    color: Colors.white54,
                    isActive: state == 'NONE',
                    onTap: () {
                      setState(() {
                        _itemStates[item.id] = 'NONE';
                        _partialAmounts.remove(item.id);
                      });
                    },
                  ),
                  _buildControlTab(
                    text: 'P',
                    icon: Icons.edit,
                    color: AppTheme.warning,
                    isActive: isParcial,
                    onTap: () => _openPartialDialog(item),
                  ),
                  _buildControlTab(
                    text: 'C',
                    icon: Icons.check,
                    color: AppTheme.success,
                    isActive: isCompleto,
                    isLast: true,
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

            // Item content
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(item.referencia,
                            style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.bold,
                                fontSize: 16)),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(
                              color: Colors.white10,
                              borderRadius: BorderRadius.circular(6)),
                          child: Text(
                              DateFormat('dd/MM/yyyy').format(item.fecha),
                              style: const TextStyle(
                                  color: Colors.white70, fontSize: 12)),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: item.tipo.color.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(
                                color: item.tipo.color.withOpacity(0.5)),
                          ),
                          child: Text(item.tipo.label.toUpperCase(),
                              style: TextStyle(
                                  color: item.tipo.color,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 11)),
                        ),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                                'Deuda: ${_currencyFormat.format(item.importePendiente)}',
                                style: TextStyle(
                                  color: state == 'NONE'
                                      ? Colors.white
                                      : Colors.white54,
                                  fontWeight: FontWeight.w600,
                                  decoration: state != 'NONE'
                                      ? TextDecoration.lineThrough
                                      : null,
                                )),
                            if (state != 'NONE') ...[
                              const SizedBox(height: 4),
                              Text(
                                'A pagar: ${_currencyFormat.format(isCompleto ? item.importePendiente : (_partialAmounts[item.id] ?? 0))}',
                                style: TextStyle(
                                    color: cardBorder,
                                    fontWeight: FontWeight.w900,
                                    fontSize: 16),
                              ),
                            ]
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

  Widget _buildControlTab({
    required String text,
    required IconData icon,
    required Color color,
    required bool isActive,
    bool isLast = false,
    required VoidCallback onTap,
  }) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Container(
          decoration: BoxDecoration(
            color: isActive ? color.withOpacity(0.2) : Colors.transparent,
            border: Border(
              bottom: isLast
                  ? BorderSide.none
                  : const BorderSide(color: Colors.white12),
              right: BorderSide(
                  color: isActive ? color : Colors.transparent, width: 3),
            ),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 16, color: isActive ? color : Colors.white30),
              const SizedBox(height: 4),
              Text(
                text,
                style: TextStyle(
                  color: isActive ? color : Colors.white30,
                  fontWeight: isActive ? FontWeight.w900 : FontWeight.normal,
                  fontSize: 12,
                ),
              ),
            ],
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
          backgroundColor: AppTheme.darkCard,
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(20),
              side: BorderSide(color: AppTheme.warning.withOpacity(0.5))),
          title: const Text('Cobro Parcial',
              style: TextStyle(color: Colors.white)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                  'Deuda actual: ${_currencyFormat.format(item.importePendiente)}',
                  style: const TextStyle(color: Colors.white70)),
              const SizedBox(height: 16),
              TextField(
                controller: controller,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                style: const TextStyle(
                    color: AppTheme.warning,
                    fontSize: 24,
                    fontWeight: FontWeight.bold),
                decoration: InputDecoration(
                  labelText: 'Importe a cobrar (€)',
                  labelStyle: const TextStyle(color: Colors.white54),
                  focusedBorder: OutlineInputBorder(
                      borderSide:
                          const BorderSide(color: AppTheme.warning, width: 2),
                      borderRadius: BorderRadius.circular(12)),
                  enabledBorder: OutlineInputBorder(
                      borderSide: const BorderSide(color: Colors.white24),
                      borderRadius: BorderRadius.circular(12)),
                  prefixIcon: const Icon(Icons.euro, color: AppTheme.warning),
                ),
                autofocus: true,
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancelar',
                  style: TextStyle(color: Colors.white54)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.warning,
                  foregroundColor: AppTheme.darkBase),
              onPressed: () {
                final val =
                    double.tryParse(controller.text.replaceAll(',', '.'));
                if (val != null && val > 0) {
                  Navigator.pop(context, val);
                }
              },
              child: const Text('Aplicar',
                  style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        );
      },
    );

    if (result != null) {
      setState(() {
        _itemStates[item.id] = 'PARCIAL';
        _partialAmounts[item.id] = result;
      });
    }
  }
}
