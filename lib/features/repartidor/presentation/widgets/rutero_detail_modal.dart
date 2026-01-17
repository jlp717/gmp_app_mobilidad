import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:signature/signature.dart';
import 'package:intl/intl.dart';
import 'dart:typed_data';
import 'dart:convert';
import '../../../../core/theme/app_theme.dart';
import '../../../entregas/providers/entregas_provider.dart';

/// Modern detail modal for Albaran delivery
class RuteroDetailModal extends StatefulWidget {
  final AlbaranEntrega albaran;
  
  const RuteroDetailModal({super.key, required this.albaran});

  @override
  State<RuteroDetailModal> createState() => _RuteroDetailModalState();
}

class _RuteroDetailModalState extends State<RuteroDetailModal> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final TextEditingController _observacionesController = TextEditingController();
  final TextEditingController _dniController = TextEditingController();
  final TextEditingController _nombreController = TextEditingController();
  final SignatureController _signatureController = SignatureController(
    penStrokeWidth: 3,
    penColor: Colors.white,
    exportBackgroundColor: Colors.transparent,
  );
  
  // Local state for line items (to allow modifications before saving)
  // Map of LineaID -> info
  final Map<String, dynamic> _lineChanges = {};
  
  // Payment state
  String _selectedPaymentMethod = 'EFECTIVO';
  bool _isPaid = false;
  double _amountCollected = 0.0;
  
  bool _isSubmitting = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _observacionesController.text = widget.albaran.observaciones ?? '';
    
    // Initialize payment state
    // Default logic from previous implementation
    if (widget.albaran.esCTR) {
      _selectedPaymentMethod = 'EFECTIVO'; // Default
      _amountCollected = widget.albaran.importeTotal;
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    _observacionesController.dispose();
    _dniController.dispose();
    _nombreController.dispose();
    _signatureController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    
    return Scaffold(
      backgroundColor: Colors.transparent, // Important for overlay
      body: Container(
        height: size.height * 0.9,
        decoration: BoxDecoration(
          color: AppTheme.darkBase,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          boxShadow: [
            BoxShadow(
              color: AppTheme.neonBlue.withOpacity(0.1),
              blurRadius: 20,
              spreadRadius: 5,
            ),
          ],
        ),
      child: Column(
        children: [
          // Drag handle
          Center(
            child: Container(
              margin: const EdgeInsets.only(top: 12, bottom: 8),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.grey.withOpacity(0.3),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          
          // Header
          _buildHeader(context),
          
          // Tabs
          TabBar(
            controller: _tabController,
            indicatorColor: AppTheme.neonBlue,
            labelColor: AppTheme.neonBlue,
            unselectedLabelColor: AppTheme.textSecondary,
            tabs: const [
              Tab(text: 'PRODUCTOS'),
              Tab(text: 'COBRO'),
              Tab(text: 'FINALIZAR'),
            ],
          ),
          
          // Content
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                _buildProductsTab(),
                _buildPaymentTab(),
                _buildFinalizeTab(),
              ],
            ),
          ),
        ],
      ),
      ),
    );
  }

  Widget _buildHeader(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: widget.albaran.numeroFactura > 0 
                      ? AppTheme.neonPurple.withOpacity(0.2) 
                      : AppTheme.neonBlue.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(
                    color: widget.albaran.numeroFactura > 0 
                        ? AppTheme.neonPurple 
                        : AppTheme.neonBlue,
                  ),
                ),
                child: Text(
                  widget.albaran.numeroFactura > 0 
                      ? 'FACTURA ${widget.albaran.numeroFactura}' 
                      : 'ALBARÁN ${widget.albaran.numeroAlbaran}',
                  style: TextStyle(
                    color: widget.albaran.numeroFactura > 0 
                        ? AppTheme.neonPurple 
                        : AppTheme.neonBlue,
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
                  ),
                ),
              ),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.close, color: AppTheme.textSecondary),
                onPressed: () => Navigator.pop(context),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            widget.albaran.nombreCliente,
            style: const TextStyle(
              color: AppTheme.textPrimary,
              fontSize: 20,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              const Icon(Icons.location_on, size: 14, color: AppTheme.textSecondary),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  widget.albaran.direccion,
                  style: const TextStyle(color: AppTheme.textSecondary, fontSize: 14),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildProductsTab() {
    // Need to fetch details if not already loaded
    // For now assuming we have access to lineas via provider or stored in generic object
    // In current implementation, lines are fetched separately. 
    // We'll use a FutureBuilder or Consumer if lines are in provider.
    
    // IMPORTANT: The original code fetched details on open.
    // We'll assume the provider has a method `getAlbaranDetalle`
    
    final provider = Provider.of<EntregasProvider>(context, listen: false);
    
    return FutureBuilder<List<EntregaItem>>(
      future: provider.getAlbaranDetalle(
        widget.albaran.numeroAlbaran, 
        widget.albaran.ejercicio,
        widget.albaran.serie,
        widget.albaran.terminal
      ),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator(color: AppTheme.neonBlue));
        }
        
        if (snapshot.hasError) {
          return Center(child: Text('Error: ${snapshot.error}', style: const TextStyle(color: AppTheme.error)));
        }
        
        final lineas = snapshot.data ?? [];
        
        if (lineas.isEmpty) {
          return const Center(child: Text('No hay líneas', style: TextStyle(color: AppTheme.textSecondary)));
        }

        return ListView.builder(
          padding: const EdgeInsets.all(16),
          itemCount: lineas.length,
          itemBuilder: (context, index) {
            final linea = lineas[index];
            return _buildProductItem(linea);
          },
        );
      },
    );
  }

  Widget _buildProductItem(EntregaItem linea) {
    // Check if modified
    // ... logic for quantity modification
    
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Checkbox custom
              GestureDetector(
                onTap: () {
                  // Toggle verification state
                  setState(() {
                    // Update verification logic
                  });
                },
                child: Container(
                  width: 24,
                  height: 24,
                  decoration: BoxDecoration(
                    color: AppTheme.neonBlue.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: AppTheme.neonBlue),
                  ),
                  child: const Icon(Icons.check, size: 16, color: AppTheme.neonBlue),
                ),
              ),
              const SizedBox(width: 12),
              // Description
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      linea.descripcion,
                      style: const TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Ref: ${linea.codigoArticulo}',
                      style: const TextStyle(color: AppTheme.textTertiary, fontSize: 12),
                    ),
                  ],
                ),
              ),
              // Quantity
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: AppTheme.darkBase,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  children: [
                    Text(
                      '${linea.cantidadPedida}',
                      style: const TextStyle(
                        color: AppTheme.textPrimary,
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                      ),
                    ),
                    const Text('Uds', style: TextStyle(color: AppTheme.textSecondary, fontSize: 10)),
                  ],
                ),
              ),
            ],
          ),
          
          // Action buttons (Add note / Edit Quantity)
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              TextButton.icon(
                icon: const Icon(Icons.edit, size: 14, color: AppTheme.textSecondary),
                label: const Text('Cantidad', style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                onPressed: () {
                   // Show quantity edit dialog
                },
              ),
              TextButton.icon(
                icon: const Icon(Icons.comment, size: 14, color: AppTheme.textSecondary),
                label: const Text('Observación', style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                onPressed: () {
                   // Show observation dialog
                },
              ),
            ],
          )
        ],
      ),
    );
  }

  Widget _buildPaymentTab() {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        children: [
          // Amount Card
          Container(
            padding: const EdgeInsets.all(24),
            decoration: AppTheme.glassMorphism(color: AppTheme.darkCard),
            child: Column(
              children: [
                const Text(
                  'Total a Cobrar',
                  style: TextStyle(color: AppTheme.textSecondary, fontSize: 14),
                ),
                const SizedBox(height: 8),
                Text(
                  NumberFormat.currency(symbol: '€', locale: 'es_ES').format(widget.albaran.importeTotal),
                  style: const TextStyle(
                    color: AppTheme.textPrimary,
                    fontSize: 36,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 4),
                 Container(
                   padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                   decoration: BoxDecoration(
                     color: (widget.albaran.esCTR ? AppTheme.error : AppTheme.success).withOpacity(0.2),
                     borderRadius: BorderRadius.circular(4),
                   ),
                   child: Text(
                     widget.albaran.esCTR ? 'COBRO OBLIGATORIO' : 'COBRO OPCIONAL',
                     style: TextStyle(
                       color: widget.albaran.esCTR ? AppTheme.error : AppTheme.success,
                       fontSize: 10, 
                       fontWeight: FontWeight.bold
                     ),
                   ),
                 ),
              ],
            ),
          ),
          
          const SizedBox(height: 32),
          
          // Payment Method Selector
          const Align(
            alignment: Alignment.centerLeft,
            child: Text('Método de Pago', style: TextStyle(color: AppTheme.textSecondary, fontSize: 14)),
          ),
          const SizedBox(height: 12),
          
          Row(
            children: [
              Expanded(child: _buildPaymentOption('EFECTIVO', Icons.money)),
              const SizedBox(width: 12),
              Expanded(child: _buildPaymentOption('TARJETA', Icons.credit_card)),
            ],
          ),
          const SizedBox(height: 12),
          // Checkbox for "Cobrado"
          InkWell(
            onTap: () {
              setState(() => _isPaid = !_isPaid);
            },
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: _isPaid ? AppTheme.success.withOpacity(0.1) : AppTheme.darkCard,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: _isPaid ? AppTheme.success : AppTheme.borderColor,
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    _isPaid ? Icons.check_box : Icons.check_box_outline_blank,
                    color: _isPaid ? AppTheme.success : AppTheme.textSecondary,
                  ),
                  const SizedBox(width: 12),
                  const Text(
                    'Marcar como Cobrado',
                    style: TextStyle(color: AppTheme.textPrimary, fontSize: 16),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
  
  Widget _buildPaymentOption(String method, IconData icon) {
    final isSelected = _selectedPaymentMethod == method;
    return GestureDetector(
      onTap: () => setState(() => _selectedPaymentMethod = method),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(vertical: 16),
        decoration: BoxDecoration(
          color: isSelected ? AppTheme.neonBlue.withOpacity(0.2) : AppTheme.darkCard,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected ? AppTheme.neonBlue : AppTheme.borderColor,
            width: isSelected ? 2 : 1,
          ),
        ),
        child: Column(
          children: [
            Icon(icon, color: isSelected ? AppTheme.neonBlue : AppTheme.textSecondary),
            const SizedBox(height: 8),
            Text(
              method,
              style: TextStyle(
                color: isSelected ? AppTheme.neonBlue : AppTheme.textSecondary,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFinalizeTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Client Info Input
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppTheme.darkCard,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppTheme.borderColor),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Datos del Receptor', style: TextStyle(color: AppTheme.neonBlue, fontWeight: FontWeight.bold, fontSize: 14)),
                const SizedBox(height: 16),
                TextField(
                  controller: _nombreController,
                  style: const TextStyle(color: AppTheme.textPrimary),
                  decoration: const InputDecoration(
                    labelText: 'Nombre y Apellidos *',
                    prefixIcon: Icon(Icons.person, color: AppTheme.textSecondary, size: 20),
                    isDense: true,
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _dniController,
                  style: const TextStyle(color: AppTheme.textPrimary),
                  decoration: const InputDecoration(
                    labelText: 'DNI / NIF *',
                    prefixIcon: Icon(Icons.badge, color: AppTheme.textSecondary, size: 20),
                    isDense: true,
                    border: OutlineInputBorder(),
                  ),
                ),
              ],
            ),
          ),
          
          const SizedBox(height: 16),
        
          // Observation Field
          TextField(
            controller: _observacionesController,
            maxLines: 3,
            style: const TextStyle(color: AppTheme.textPrimary),
            decoration: const InputDecoration(
              labelText: 'Observaciones Globales',
              hintText: 'Añadir nota sobre la entrega...',
              alignLabelWithHint: true,
              border: OutlineInputBorder(),
            ),
          ),
          
          const SizedBox(height: 20),
          
          // Signature Pad
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Firma del Cliente *', style: TextStyle(color: AppTheme.textSecondary)),
              TextButton(
                onPressed: () => _signatureController.clear(),
                child: const Text('Borrar Firma', style: TextStyle(color: AppTheme.error)),
              ),
            ],
          ),
          Container(
            height: 180,
            decoration: BoxDecoration(
              color: Colors.grey[900],
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppTheme.borderColor),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Signature(
                controller: _signatureController,
                backgroundColor: Colors.transparent,
              ),
            ),
          ),
          
          const SizedBox(height: 24),
          
          // Submit Button
          ElevatedButton(
            onPressed: _isSubmitting ? null : _submitDelivery,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.neonBlue,
              foregroundColor: AppTheme.darkBase,
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            child: _isSubmitting 
                ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.darkBase))
                : const Text('CONFIRMAR ENTREGA', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          ),
          const SizedBox(height: 20), // Bottom padding
        ],
      ),
    );
  }

  Future<void> _submitDelivery() async {
    // 1. Validation
    if (_nombreController.text.trim().isEmpty) {
      _showError('El nombre del receptor es obligatorio');
      return;
    }
    if (_dniController.text.trim().isEmpty) {
      _showError('El DNI/NIF es obligatorio');
      return;
    }
    if (_signatureController.isEmpty) {
      _showError('La firma es obligatoria');
      return;
    }
    
    // CTR Payment Validation
    if (widget.albaran.esCTR && !_isPaid) {
       // Allow proceed but warn? Or strict? 
       // Previous code had strict "Must explain difference".
       // Here we assume if they switch to "Paid", all is good. 
       // If not paid, we should probably require observation.
       if (_observacionesController.text.trim().isEmpty) {
         _showError('Cobro pendiente: Indique motivo en observaciones');
         return;
       }
    }

    setState(() => _isSubmitting = true);
    
    try {
      final provider = Provider.of<EntregasProvider>(context, listen: false);
      
      // 2. Get Signature
      final Uint8List? sigBytes = await _signatureController.toPngBytes();
      if (sigBytes == null) throw Exception('Error al procesar firma');
      final String base64Sig = base64Encode(sigBytes);
      
      // 3. Construct Observations
      // TODO: Concatenate line discrepancies if we had editing implemented.
      // For now, usage implies simple confirmation of full delivery or global observation.
      String finalObs = _observacionesController.text.trim();
      if (_nombreController.text.isNotEmpty) {
        finalObs += "\nReceptor: ${_nombreController.text} (${_dniController.text})";
      }
      if (_isPaid) {
        finalObs += "\nCobrado: ${_selectedPaymentMethod}";
      }

      // 4. Call Provider
      // Assuming full delivery for now as we don't have partial editing UI fully wired in this version yet.
      // To support partial, we'd need to check _lineChanges.
      bool success = await provider.marcarEntregado(
        albaranId: widget.albaran.id,
        firma: base64Sig,
        observaciones: finalObs,
      );
      
      if (!mounted) return;
      
      setState(() => _isSubmitting = false);
      
      if (success) {
         Navigator.pop(context);
         ScaffoldMessenger.of(context).showSnackBar(
           const SnackBar(
             content: Text('Entrega registrada correctamente'),
             backgroundColor: AppTheme.success,
           ),
         );
      } else {
         _showError(provider.error ?? 'Error al guardar entrega');
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isSubmitting = false);
        _showError('Error: $e');
      }
    }
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: AppTheme.error),
    );
  }
}
