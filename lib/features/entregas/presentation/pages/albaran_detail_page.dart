import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/features/entregas/presentation/widgets/signature_pad.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

/// Página de detalle de albarán con acciones de entrega
class AlbaranDetailPage extends ConsumerStatefulWidget {
  const AlbaranDetailPage({required this.albaran, super.key});
  final AlbaranEntrega albaran;

  @override
  ConsumerState<AlbaranDetailPage> createState() => _AlbaranDetailPageState();
}

class _AlbaranDetailPageState extends ConsumerState<AlbaranDetailPage> {
  final TextEditingController _observacionesController =
      TextEditingController();
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
      backgroundColor: AppColors.legacyFFF5F7FA,
      appBar: AppBar(
        title: Text('Albarán ${widget.albaran.numeroAlbaran}'),
        elevation: 0,
        actions: [
          if (widget.albaran.estado == EstadoEntrega.entregado)
            Container(
              margin: const EdgeInsets.only(right: 12),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: AppColors.systemGreen,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.check_circle,
                      size: 16, color: AppColors.themedWhite),
                  SizedBox(width: 4),
                  Text(
                    'ENTREGADO',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: AppColors.themedWhite,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            )
          else if (widget.albaran.esCTR)
            Container(
              margin: const EdgeInsets.only(right: 12),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: AppColors.systemAmber,
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.euro, size: 16, color: AppColors.systemBlack87),
                  SizedBox(width: 4),
                  Text(
                    'COBRAR',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: AppColors.systemBlack87,
                    ),
                  ),
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

            // Solo mostrar secciones editables si NO está entregado
            if (widget.albaran.estado != EstadoEntrega.entregado) ...[
              // Fotos
              _buildFotosSection(),
              const SizedBox(height: 16),

              // Firma
              _buildFirmaSection(),
              const SizedBox(height: 16),

              // Observaciones
              _buildObservacionesSection(),
              const SizedBox(height: 24),
            ],

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
                  backgroundColor:
                      Theme.of(context).primaryColor.withValues(alpha: 0.1),
                  child:
                      Icon(Icons.store, color: Theme.of(context).primaryColor),
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
                          color: AppColors.systemGrey600,
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
          Icon(icon, size: 18, color: AppColors.systemGrey),
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
                  style: TextStyle(color: AppColors.systemGrey600),
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
                    style: TextStyle(color: AppColors.systemGrey500),
                  ),
                ),
              )
            else
              ...widget.albaran.items.map(_buildItemRow),
          ],
        ),
      ),
    );
  }

  Widget _buildItemRow(EntregaItem item) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.systemGrey200)),
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
                  style:
                      TextStyle(fontSize: 12, color: AppColors.systemGrey600),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: AppColors.systemBlue50,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              '${item.cantidadPedida.toStringAsFixed(0)} uds',
              style: TextStyle(
                fontWeight: FontWeight.bold,
                color: AppColors.systemBlue700,
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
      color: widget.albaran.esCTR ? AppColors.systemAmber50 : null,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(
              widget.albaran.esCTR ? Icons.payments : Icons.receipt_long,
              size: 32,
              color: widget.albaran.esCTR
                  ? AppColors.systemAmber800
                  : AppColors.systemGrey,
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
                          ? AppColors.systemAmber900
                          : AppColors.systemGrey700,
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
                    ? AppColors.systemAmber900
                    : AppColors.systemBlack87,
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
                  style: TextStyle(color: AppColors.systemGrey500),
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
                      color: AppColors.systemGrey200,
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
                                color: AppColors.systemRed,
                                shape: BoxShape.circle,
                              ),
                              child: Icon(
                                Icons.close,
                                size: 14,
                                color: AppColors.themedWhite,
                              ),
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
                  color: AppColors.systemGrey100,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.systemGrey300),
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
                          Icon(
                            Icons.gesture,
                            size: 32,
                            color: AppColors.systemGrey400,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'Toca para firmar',
                            style: TextStyle(color: AppColors.systemGrey500),
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
                fillColor: AppColors.systemGrey100,
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
      return Column(
        children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: AppColors.systemGreen50,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  Icons.check_circle,
                  color: AppColors.systemGreen700,
                  size: 32,
                ),
                const SizedBox(width: 12),
                Text(
                  '¡Entrega completada!',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: AppColors.systemGreen800,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: OutlinedButton.icon(
              onPressed: () =>
                  _showPostDeliveryDialog(popOnClose: false, isResend: true),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.systemBlue700,
                side: BorderSide(color: AppColors.systemBlue300),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              icon: const Icon(Icons.receipt_long, size: 20),
              label: const Text(
                'Reenviar nota de entrega',
                style: TextStyle(fontWeight: FontWeight.w600),
              ),
            ),
          ),
        ],
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
              backgroundColor: AppColors.systemGreen,
              foregroundColor: AppColors.themedWhite,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
            ),
            icon: _isProcessing
                ? SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: AppColors.themedWhite,
                    ),
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
                  foregroundColor: AppColors.systemOrange,
                  side: const BorderSide(color: AppColors.systemOrange),
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
                  foregroundColor: AppColors.systemRed,
                  side: const BorderSide(color: AppColors.systemRed),
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
          backgroundColor: AppColors.systemOrange,
        ),
      );
      return;
    }

    setState(() => _isProcessing = true);

    try {
      final notifier = ref.read(entregasProvider.notifier);
      final success = await notifier.marcarEntregado(
        albaranId: widget.albaran.id,
        observaciones: _observacionesController.text,
        firma: _firmaBase64,
        fotos: _fotos.isNotEmpty ? _fotos : null,
        clientCode: widget.albaran.codigoCliente,
      );

      if (success && mounted) {
        // Sync updated firma path from provider (server returned the stored path)
        final updated = ref.read(entregasProvider).albaranes.firstWhere(
              (a) => a.id == widget.albaran.id,
              orElse: () => widget.albaran,
            );
        widget.albaran.firma = updated.firma;
        widget.albaran.estado = EstadoEntrega.entregado;

        setState(() => _isProcessing = false);
        await _showPostDeliveryDialog();
        return;
      } else if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content:
                Text(ref.read(entregasProvider).error ?? 'Error al registrar'),
            backgroundColor: AppColors.systemRed,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isProcessing = false);
    }
  }

  /// Diálogo post-entrega con opciones de ticket
  /// [popOnClose] controla si al cerrar el diálogo se vuelve a la lista
  Future<void> _showPostDeliveryDialog({
    bool popOnClose = true,
    bool isResend = false,
  }) async {
    await showDialog(
      context: context,
      barrierDismissible: isResend,
      builder: (ctx) =>
          _PostDeliveryDialog(albaran: widget.albaran, isResend: isResend),
    );
    if (popOnClose && mounted) Navigator.pop(context);
  }

  Future<void> _marcarParcial() async {
    final obs = await _pedirObservaciones('entrega parcial');
    if (obs == null) return;

    setState(() => _isProcessing = true);
    try {
      final notifier = ref.read(entregasProvider.notifier);
      final success = await notifier.marcarParcial(
        albaranId: widget.albaran.id,
        observaciones: obs,
        firma: _firmaBase64,
        fotos: _fotos.isNotEmpty ? _fotos : null,
      );

      if (success && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Entrega parcial registrada'),
            backgroundColor: AppColors.systemOrange,
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
      final notifier = ref.read(entregasProvider.notifier);
      final success = await notifier.marcarNoEntregado(
        albaranId: widget.albaran.id,
        observaciones: obs,
        fotos: _fotos.isNotEmpty ? _fotos : null,
      );

      if (success && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Marcado como no entregado'),
            backgroundColor: AppColors.systemRed,
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

/// Diálogo post-entrega con opciones de descarga/envío del ticket
class _PostDeliveryDialog extends ConsumerStatefulWidget {
  const _PostDeliveryDialog({required this.albaran, this.isResend = false});
  final AlbaranEntrega albaran;
  final bool isResend;

  @override
  ConsumerState<_PostDeliveryDialog> createState() =>
      _PostDeliveryDialogState();
}

class _PostDeliveryDialogState extends ConsumerState<_PostDeliveryDialog> {
  bool _isProcessing = false;
  String? _processingAction;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: Column(
        children: [
          Icon(
            widget.isResend ? Icons.receipt_long : Icons.check_circle,
            color:
                widget.isResend ? AppColors.systemBlue : AppColors.systemGreen,
            size: 56,
          ),
          const SizedBox(height: 12),
          Text(
            widget.isResend
                ? 'Reenviar nota de entrega'
                : 'Entrega realizada con éxito',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 4),
          Text(
            'Albarán ${widget.albaran.numeroAlbaran}',
            style: TextStyle(fontSize: 13, color: AppColors.systemGrey600),
          ),
        ],
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text(
            'Enviar nota de entrega al cliente:',
            style: TextStyle(fontSize: 14, color: AppColors.systemBlack87),
          ),
          const SizedBox(height: 16),

          // Descargar PDF
          _buildActionButton(
            icon: Icons.download,
            label: 'Descargar PDF',
            color: AppColors.systemBlue,
            actionKey: 'download',
            onTap: _downloadReceipt,
          ),
          const SizedBox(height: 10),

          // WhatsApp
          _buildActionButton(
            icon: Icons.share,
            label: 'Compartir (WhatsApp...)',
            color: AppColors.systemGreen,
            actionKey: 'whatsapp',
            onTap: _shareReceipt,
          ),
          const SizedBox(height: 10),

          // Email
          _buildActionButton(
            icon: Icons.email,
            label: 'Enviar por Email',
            color: AppColors.systemOrange,
            actionKey: 'email',
            onTap: _sendByEmail,
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: _isProcessing ? null : () => Navigator.pop(context),
          child: const Text('Cerrar'),
        ),
      ],
    );
  }

  Widget _buildActionButton({
    required IconData icon,
    required String label,
    required Color color,
    required String actionKey,
    required VoidCallback onTap,
  }) {
    final isThisProcessing = _isProcessing && _processingAction == actionKey;
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton.icon(
        onPressed: _isProcessing ? null : onTap,
        icon: isThisProcessing
            ? SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: AppColors.themedWhite,
                ),
              )
            : Icon(icon, size: 20),
        label: Text(label),
        style: ElevatedButton.styleFrom(
          backgroundColor: color,
          foregroundColor: AppColors.themedWhite,
          padding: const EdgeInsets.symmetric(vertical: 12),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      ),
    );
  }

  Future<void> _downloadReceipt() async {
    setState(() {
      _isProcessing = true;
      _processingAction = 'download';
    });
    try {
      final notifier = ref.read(entregasProvider.notifier);
      final result = await notifier.generateReceipt(albaran: widget.albaran);

      if (result == null || result['pdfBase64'] == null) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Error al generar el recibo'),
              backgroundColor: AppColors.systemRed,
            ),
          );
        }
        return;
      }

      final bytes = base64Decode(result['pdfBase64'] as String);
      final dir = await getTemporaryDirectory();
      final fileName = (result['fileName'] as String?) ??
          'Nota_Entrega_${widget.albaran.numeroAlbaran}.pdf';
      final file = File('${dir.path}/$fileName');
      await file.writeAsBytes(bytes);

      final renderBox = context.findRenderObject() as RenderBox?;
      final origin = renderBox != null
          ? Rect.fromCenter(
              center:
                  Offset(renderBox.size.width / 2, renderBox.size.height / 2),
              width: 1,
              height: 1,
            )
          : null;

      await Share.shareXFiles(
        [XFile(file.path, mimeType: 'application/pdf')],
        text: 'Nota de entrega - Albarán ${widget.albaran.numeroAlbaran}',
        sharePositionOrigin: origin,
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('PDF generado correctamente'),
            backgroundColor: AppColors.systemGreen,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text('Error: $e'), backgroundColor: AppColors.systemRed),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isProcessing = false;
          _processingAction = null;
        });
      }
    }
  }

  Future<void> _shareReceipt() async {
    setState(() {
      _isProcessing = true;
      _processingAction = 'whatsapp';
    });
    try {
      final notifier = ref.read(entregasProvider.notifier);
      final result = await notifier.generateReceipt(albaran: widget.albaran);

      if (result == null || result['pdfBase64'] == null) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Error al generar el recibo'),
              backgroundColor: AppColors.systemRed,
            ),
          );
        }
        return;
      }

      final bytes = base64Decode(result['pdfBase64'] as String);
      final dir = await getTemporaryDirectory();
      final fileName = (result['fileName'] as String?) ??
          'Nota_Entrega_${widget.albaran.numeroAlbaran}.pdf';
      final file = File('${dir.path}/$fileName');
      await file.writeAsBytes(bytes);

      final renderBox = context.findRenderObject() as RenderBox?;
      final origin = renderBox != null
          ? Rect.fromCenter(
              center:
                  Offset(renderBox.size.width / 2, renderBox.size.height / 2),
              width: 1,
              height: 1,
            )
          : null;

      // Usar share sheet que permite seleccionar WhatsApp
      await Share.shareXFiles(
        [XFile(file.path, mimeType: 'application/pdf')],
        text: 'Nota de entrega - Albarán ${widget.albaran.numeroAlbaran}\n'
            'Cliente: ${widget.albaran.nombreCliente}\n'
            'Total: ${widget.albaran.importeTotal.toStringAsFixed(2)} EUR',
        sharePositionOrigin: origin,
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text('Error: $e'), backgroundColor: AppColors.systemRed),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isProcessing = false;
          _processingAction = null;
        });
      }
    }
  }

  Future<void> _sendByEmail() async {
    // Pedir email al repartidor
    final emailController = TextEditingController();
    final email = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Enviar por Email'),
        content: TextField(
          controller: emailController,
          keyboardType: TextInputType.emailAddress,
          decoration: const InputDecoration(
            labelText: 'Email del cliente',
            hintText: 'ejemplo@email.com',
            border: OutlineInputBorder(),
            prefixIcon: Icon(Icons.email),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            onPressed: () {
              final value = emailController.text.trim();
              if (value.isNotEmpty &&
                  value.contains('@') &&
                  value.contains('.')) {
                Navigator.pop(ctx, value);
              } else {
                ScaffoldMessenger.of(ctx).showSnackBar(
                  const SnackBar(
                    content: Text('Email no válido'),
                    backgroundColor: AppColors.systemOrange,
                  ),
                );
              }
            },
            child: const Text('Enviar'),
          ),
        ],
      ),
    );

    if (email == null || email.isEmpty) return;

    setState(() {
      _isProcessing = true;
      _processingAction = 'email';
    });
    try {
      final notifier = ref.read(entregasProvider.notifier);
      final success = await notifier.sendReceiptByEmail(
        albaran: widget.albaran,
        email: email,
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              success ? 'Email enviado a $email' : 'Error al enviar email',
            ),
            backgroundColor:
                success ? AppColors.systemGreen : AppColors.systemRed,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text('Error: $e'), backgroundColor: AppColors.systemRed),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isProcessing = false;
          _processingAction = null;
        });
      }
    }
  }
}
