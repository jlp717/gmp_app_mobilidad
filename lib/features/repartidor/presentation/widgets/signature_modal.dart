/// SIGNATURE MODAL WIDGET
/// Pantalla completa para captura de firma digital del cliente
/// Utiliza el paquete 'signature' para canvas-based drawing

import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:signature/signature.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';

/// Modal de firma digital para captura de firma del cliente
/// Retorna la firma como base64 string o null si se cancela
class SignatureModal extends StatefulWidget {
  final String title;
  final String subtitle;
  final VoidCallback? onCancel;
  final Function(String base64Signature)? onConfirm;

  const SignatureModal({
    super.key,
    this.title = 'Firma del Cliente',
    this.subtitle = 'Por favor, firme dentro del recuadro',
    this.onCancel,
    this.onConfirm,
  });

  /// Muestra el modal y retorna la firma como base64 o null
  static Future<String?> show(BuildContext context, {
    String title = 'Firma del Cliente',
    String subtitle = 'Por favor, firme dentro del recuadro',
  }) async {
    return showModalBottomSheet<String?>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => SignatureModal(title: title, subtitle: subtitle),
    );
  }

  @override
  State<SignatureModal> createState() => _SignatureModalState();
}

class _SignatureModalState extends State<SignatureModal> {
  late SignatureController _controller;
  bool _isEmpty = true;

  @override
  void initState() {
    super.initState();
    _controller = SignatureController(
      penStrokeWidth: 3,
      penColor: Colors.black,
      exportBackgroundColor: Colors.white,
    );
    
    _controller.addListener(() {
      if (mounted) {
        setState(() {
          _isEmpty = _controller.isEmpty;
        });
      }
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _confirmSignature() async {
    if (_controller.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Por favor, firme antes de confirmar'),
          backgroundColor: AppTheme.error,
        ),
      );
      return;
    }

    try {
      // Exportar firma como PNG bytes
      final Uint8List? signatureBytes = await _controller.toPngBytes();
      if (signatureBytes != null) {
        // Convertir a base64
        final String base64Signature = base64Encode(signatureBytes);
        
        if (widget.onConfirm != null) {
          widget.onConfirm!(base64Signature);
        }
        
        if (mounted) {
          Navigator.of(context).pop(base64Signature);
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error al guardar firma: $e'),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    }
  }

  void _clearSignature() {
    _controller.clear();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      // Responsive: use more height in landscape where screen is shorter
      height: Responsive.modalHeight(context, portraitFraction: 0.85, landscapeFraction: 0.95),
      decoration: const BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        children: [
          // Handle bar
          Container(
            margin: const EdgeInsets.only(top: 12),
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.3),
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          
          // Header (responsive padding)
          Padding(
            padding: EdgeInsets.all(Responsive.padding(context, small: 12, large: 20)),
            child: Column(
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppTheme.neonBlue.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Icon(
                        Icons.edit_note,
                        color: AppTheme.neonBlue,
                        size: 24,
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            widget.title,
                            style: const TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.textPrimary,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            widget.subtitle,
                            style: TextStyle(
                              fontSize: 13,
                              color: AppTheme.textSecondary.withOpacity(0.8),
                            ),
                          ),
                        ],
                      ),
                    ),
                    // Clear button
                    IconButton(
                      onPressed: _clearSignature,
                      icon: const Icon(Icons.refresh),
                      color: AppTheme.textSecondary,
                      tooltip: 'Limpiar',
                    ),
                  ],
                ),
              ],
            ),
          ),
          
          // Signature Canvas
          Expanded(
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 20),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: _isEmpty 
                    ? Colors.grey.withOpacity(0.3) 
                    : AppTheme.neonGreen.withOpacity(0.5),
                  width: 2,
                ),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.1),
                    blurRadius: 10,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: Stack(
                  children: [
                    // Signature pad
                    Signature(
                      controller: _controller,
                      backgroundColor: Colors.white,
                    ),
                    
                    // Placeholder text when empty
                    if (_isEmpty)
                      Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.gesture,
                              size: 48,
                              color: Colors.grey.withOpacity(0.3),
                            ),
                            const SizedBox(height: 12),
                            Text(
                              'Firme aquí',
                              style: TextStyle(
                                fontSize: 16,
                                color: Colors.grey.withOpacity(0.5),
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
          
          // Action Buttons (responsive padding)
          Padding(
            padding: EdgeInsets.all(Responsive.padding(context, small: 12, large: 20)),
            child: Row(
              children: [
                // Cancel button
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () {
                      widget.onCancel?.call();
                      Navigator.of(context).pop(null);
                    },
                    icon: const Icon(Icons.close),
                    label: const Text('Cancelar'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppTheme.textSecondary,
                      side: BorderSide(color: Colors.white.withOpacity(0.2)),
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                ),
                
                const SizedBox(width: 16),
                
                // Confirm button
                Expanded(
                  flex: 2,
                  child: ElevatedButton.icon(
                    onPressed: _isEmpty ? null : _confirmSignature,
                    icon: const Icon(Icons.check),
                    label: const Text('Confirmar Firma'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _isEmpty 
                        ? Colors.grey 
                        : AppTheme.neonGreen,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          
          // Safe area bottom padding
          SizedBox(height: MediaQuery.of(context).padding.bottom),
        ],
      ),
    );
  }
}
