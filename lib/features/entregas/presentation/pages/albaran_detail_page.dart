import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:image_picker/image_picker.dart';
import '../../providers/entregas_provider.dart';
import '../widgets/signature_pad.dart';

/// Página de detalle de albarán con acciones de entrega
class AlbaranDetailPage extends StatefulWidget {
  final AlbaranEntrega albaran;

  const AlbaranDetailPage({super.key, required this.albaran});

  @override
  State<AlbaranDetailPage> createState() => _AlbaranDetailPageState();
}

class _AlbaranDetailPageState extends State<AlbaranDetailPage> {
  final TextEditingController _observacionesController = TextEditingController();
  final List<String> _fotos = [];
  String? _firmaBase64;
  bool _isProcessing = false;

  @override
  void dispose() {
    _observacionesController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        title: Text('Albarán ${widget.albaran.numeroAlbaran}'),
        elevation: 0,
        actions: [
          if (widget.albaran.esCTR)
            Container(
              margin: const EdgeInsets.only(right: 12),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: Colors.amber,
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.euro, size: 16, color: Colors.black87),
                  SizedBox(width: 4),
                  Text('COBRAR', style: TextStyle(
                    fontWeight: FontWeight.bold, 
                    color: Colors.black87,
                  )),
                ],
              ),
            ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Info cliente
            _buildClienteCard(),
            const SizedBox(height: 16),
            
            // Items del albarán
            _buildItemsCard(),
            const SizedBox(height: 16),
            
            // Importe y forma de pago
            _buildImporteCard(),
            const SizedBox(height: 16),
            
            // Fotos
            _buildFotosSection(),
            const SizedBox(height: 16),
            
            // Firma
            _buildFirmaSection(),
            const SizedBox(height: 16),
            
            // Observaciones
            _buildObservacionesSection(),
            const SizedBox(height: 24),
            
            // Botones de acción
            _buildAcciones(),
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }

  Widget _buildClienteCard() {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  backgroundColor: Theme.of(context).primaryColor.withOpacity(0.1),
                  child: Icon(Icons.store, 
                              color: Theme.of(context).primaryColor),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.albaran.nombreCliente,
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                        ),
                      ),
                      Text(
                        'Código: ${widget.albaran.codigoCliente}',
                        style: TextStyle(
                          color: Colors.grey.shade600,
                          fontSize: 13,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const Divider(height: 24),
            _buildInfoRow(Icons.location_on, widget.albaran.direccion),
            if (widget.albaran.poblacion.isNotEmpty)
              _buildInfoRow(Icons.location_city, widget.albaran.poblacion),
            if (widget.albaran.telefono.isNotEmpty)
              _buildInfoRow(Icons.phone, widget.albaran.telefono),
            if (widget.albaran.codigoVendedor.isNotEmpty)
              _buildInfoRow(
                Icons.person, 
                'Comercial: ${widget.albaran.codigoVendedor}',
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildInfoRow(IconData icon, String text) {
    if (text.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Icon(icon, size: 18, color: Colors.grey),
          const SizedBox(width: 8),
          Expanded(child: Text(text)),
        ],
      ),
    );
  }

  Widget _buildItemsCard() {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.inventory_2, size: 20),
                const SizedBox(width: 8),
                const Text(
                  'Productos',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
                const Spacer(),
                Text(
                  '${widget.albaran.items.length} items',
                  style: TextStyle(color: Colors.grey.shade600),
                ),
              ],
            ),
            const Divider(height: 24),
            if (widget.albaran.items.isEmpty)
              Center(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    'Cargando items...',
                    style: TextStyle(color: Colors.grey.shade500),
                  ),
                ),
              )
            else
              ...widget.albaran.items.map((item) => _buildItemRow(item)),
          ],
        ),
      ),
    );
  }

  Widget _buildItemRow(EntregaItem item) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: Colors.grey.shade200)),
      ),
      child: Row(
        children: [
          Expanded(
            flex: 3,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.descripcion,
                  style: const TextStyle(fontWeight: FontWeight.w500),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  item.codigoArticulo,
                  style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: Colors.blue.shade50,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              '${item.cantidadPedida.toStringAsFixed(0)} uds',
              style: TextStyle(
                fontWeight: FontWeight.bold,
                color: Colors.blue.shade700,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildImporteCard() {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      color: widget.albaran.esCTR ? Colors.amber.shade50 : null,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(
              widget.albaran.esCTR ? Icons.payments : Icons.receipt_long,
              size: 32,
              color: widget.albaran.esCTR ? Colors.amber.shade800 : Colors.grey,
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    widget.albaran.esCTR 
                        ? 'COBRAR EN EFECTIVO' 
                        : 'Forma de pago: ${widget.albaran.formaPago}',
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: widget.albaran.esCTR 
                          ? Colors.amber.shade900 
                          : Colors.grey.shade700,
                    ),
                  ),
                  if (widget.albaran.esCTR)
                    const Text(
                      'El cliente debe pagar en el momento de la entrega',
                      style: TextStyle(fontSize: 12),
                    ),
                ],
              ),
            ),
            Text(
              '${widget.albaran.importeTotal.toStringAsFixed(2)}€',
              style: TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.bold,
                color: widget.albaran.esCTR 
                    ? Colors.amber.shade900 
                    : Colors.black87,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFotosSection() {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.camera_alt, size: 20),
                const SizedBox(width: 8),
                const Text(
                  'Fotos',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
                const Spacer(),
                TextButton.icon(
                  onPressed: _tomarFoto,
                  icon: const Icon(Icons.add_a_photo, size: 18),
                  label: const Text('Añadir'),
                ),
              ],
            ),
            if (_fotos.isEmpty)
              Container(
                height: 80,
                alignment: Alignment.center,
                child: Text(
                  'Sin fotos. Toma una foto como comprobante.',
                  style: TextStyle(color: Colors.grey.shade500),
                ),
              )
            else
              SizedBox(
                height: 80,
                child: ListView.builder(
                  scrollDirection: Axis.horizontal,
                  itemCount: _fotos.length,
                  itemBuilder: (_, i) => Container(
                    width: 80,
                    height: 80,
                    margin: const EdgeInsets.only(right: 8),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(8),
                      color: Colors.grey.shade200,
                    ),
                    child: Stack(
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: Image.memory(
                            base64Decode(_fotos[i]),
                            fit: BoxFit.cover,
                            width: 80,
                            height: 80,
                          ),
                        ),
                        Positioned(
                          top: 4,
                          right: 4,
                          child: GestureDetector(
                            onTap: () => setState(() => _fotos.removeAt(i)),
                            child: Container(
                              padding: const EdgeInsets.all(2),
                              decoration: const BoxDecoration(
                                color: Colors.red,
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(Icons.close, 
                                                 size: 14, color: Colors.white),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildFirmaSection() {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.draw, size: 20),
                const SizedBox(width: 8),
                const Text(
                  'Firma del Cliente',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
                const Spacer(),
                if (_firmaBase64 != null)
                  TextButton.icon(
                    onPressed: () => setState(() => _firmaBase64 = null),
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('Borrar'),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            GestureDetector(
              onTap: _abrirPadFirma,
              child: Container(
                height: 120,
                width: double.infinity,
                decoration: BoxDecoration(
                  color: Colors.grey.shade100,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.grey.shade300),
                ),
                child: _firmaBase64 != null
                    ? ClipRRect(
                        borderRadius: BorderRadius.circular(12),
                        child: Image.memory(
                          base64Decode(_firmaBase64!),
                          fit: BoxFit.contain,
                        ),
                      )
                    : Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.gesture, 
                               size: 32, color: Colors.grey.shade400),
                          const SizedBox(height: 8),
                          Text(
                            'Toca para firmar',
                            style: TextStyle(color: Colors.grey.shade500),
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

  Widget _buildObservacionesSection() {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.notes, size: 20),
                SizedBox(width: 8),
                Text(
                  'Observaciones',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _observacionesController,
              maxLines: 3,
              decoration: InputDecoration(
                hintText: 'Añade notas sobre la entrega...',
                filled: true,
                fillColor: Colors.grey.shade100,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAcciones() {
    if (widget.albaran.estado == EstadoEntrega.entregado) {
      return Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: Colors.green.shade50,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.check_circle, color: Colors.green.shade700, size: 32),
            const SizedBox(width: 12),
            Text(
              '¡Entrega completada!',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
                color: Colors.green.shade800,
              ),
            ),
          ],
        ),
      );
    }

    return Column(
      children: [
        // Botón principal: ENTREGAR
        SizedBox(
          width: double.infinity,
          height: 56,
          child: ElevatedButton.icon(
            onPressed: _isProcessing ? null : _confirmarEntrega,
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.green,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
            ),
            icon: _isProcessing 
                ? const SizedBox(
                    width: 20, height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white),
                  )
                : const Icon(Icons.check_circle, size: 28),
            label: Text(
              _isProcessing ? 'Procesando...' : 'MARCAR COMO ENTREGADO',
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
          ),
        ),
        const SizedBox(height: 12),
        
        // Botones secundarios
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _isProcessing ? null : _marcarParcial,
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.orange,
                  side: const BorderSide(color: Colors.orange),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                icon: const Icon(Icons.pie_chart, size: 20),
                label: const Text('Parcial'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _isProcessing ? null : _marcarNoEntregado,
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.red,
                  side: const BorderSide(color: Colors.red),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                icon: const Icon(Icons.cancel, size: 20),
                label: const Text('No Entregado'),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Future<void> _tomarFoto() async {
    final picker = ImagePicker();
    final image = await picker.pickImage(source: ImageSource.camera);
    if (image != null) {
      final bytes = await image.readAsBytes();
      setState(() => _fotos.add(base64Encode(bytes)));
    }
  }

  void _abrirPadFirma() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => SignaturePad(
        onSave: (base64) {
          setState(() => _firmaBase64 = base64);
          Navigator.pop(context);
        },
      ),
    );
  }

  Future<void> _confirmarEntrega() async {
    // Validar que tenga firma si es CTR
    if (widget.albaran.esCTR && _firmaBase64 == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Por favor, obtén la firma del cliente'),
          backgroundColor: Colors.orange,
        ),
      );
      return;
    }

    setState(() => _isProcessing = true);

    try {
      final provider = context.read<EntregasProvider>();
      final success = await provider.marcarEntregado(
        albaranId: widget.albaran.id,
        observaciones: _observacionesController.text,
        firma: _firmaBase64,
        fotos: _fotos.isNotEmpty ? _fotos : null,
      );

      if (success && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('✓ Entrega registrada correctamente'),
            backgroundColor: Colors.green,
          ),
        );
        Navigator.pop(context);
      } else if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(provider.error ?? 'Error al registrar'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isProcessing = false);
    }
  }

  Future<void> _marcarParcial() async {
    final obs = await _pedirObservaciones('entrega parcial');
    if (obs == null) return;

    setState(() => _isProcessing = true);
    try {
      final provider = context.read<EntregasProvider>();
      final success = await provider.marcarParcial(
        albaranId: widget.albaran.id,
        observaciones: obs,
        firma: _firmaBase64,
        fotos: _fotos.isNotEmpty ? _fotos : null,
      );

      if (success && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Entrega parcial registrada'),
            backgroundColor: Colors.orange,
          ),
        );
        Navigator.pop(context);
      }
    } finally {
      if (mounted) setState(() => _isProcessing = false);
    }
  }

  Future<void> _marcarNoEntregado() async {
    final obs = await _pedirObservaciones('no entrega');
    if (obs == null) return;

    setState(() => _isProcessing = true);
    try {
      final provider = context.read<EntregasProvider>();
      final success = await provider.marcarNoEntregado(
        albaranId: widget.albaran.id,
        observaciones: obs,
        fotos: _fotos.isNotEmpty ? _fotos : null,
      );

      if (success && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Marcado como no entregado'),
            backgroundColor: Colors.red,
          ),
        );
        Navigator.pop(context);
      }
    } finally {
      if (mounted) setState(() => _isProcessing = false);
    }
  }

  Future<String?> _pedirObservaciones(String tipo) async {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text('Motivo de $tipo'),
        content: TextField(
          controller: controller,
          maxLines: 3,
          decoration: const InputDecoration(
            hintText: 'Explica el motivo...',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, controller.text),
            child: const Text('Confirmar'),
          ),
        ],
      ),
    );
  }
}
