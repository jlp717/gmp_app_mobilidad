import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../entregas/providers/entregas_provider.dart';

/// Smart Delivery Card with futuristic design
/// Features:
/// - Clear distinction between Albaran and Factura
/// - Payment status indicators with urgency levels
/// - AI suggestions integration
/// - Quick action buttons
/// - Swipe gestures for rapid completion
class SmartDeliveryCard extends StatefulWidget {
  final AlbaranEntrega albaran;
  final VoidCallback onTap;
  final VoidCallback? onSwipeComplete;
  final VoidCallback? onSwipeNote;
  const SmartDeliveryCard({
    super.key,
    required this.albaran,
    required this.onTap,
    this.onSwipeComplete,
    this.onSwipeNote,
  });

  @override
  State<SmartDeliveryCard> createState() => _SmartDeliveryCardState();
}

class _SmartDeliveryCardState extends State<SmartDeliveryCard>
    with SingleTickerProviderStateMixin {
  late AnimationController _animController;
  late Animation<double> _scaleAnimation;
  double _dragOffset = 0;
  bool _isDragging = false;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      duration: AppTheme.animFast,
      vsync: this,
    );
    _scaleAnimation = Tween<double>(begin: 1.0, end: 0.98).animate(
      CurvedAnimation(parent: _animController, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _animController.dispose();
    super.dispose();
  }

  bool get _isFactura => widget.albaran.numeroFactura > 0;
  bool get _isEntregado => widget.albaran.estado == EstadoEntrega.entregado;
  bool get _isUrgent => widget.albaran.esCTR;

  Color get _borderColor {
    if (_isEntregado) return AppTheme.success;
    if (_isUrgent) return AppTheme.obligatorio;
    if (widget.albaran.colorEstado == 'orange') return AppTheme.opcional;
    return AppTheme.neonBlue;
  }

  BoxDecoration get _cardDecoration {
    if (_isEntregado) return AppTheme.successCard();
    if (_isFactura) return AppTheme.facturaCard();
    if (_isUrgent) return AppTheme.urgentCard();
    return AppTheme.holoCard(glowColor: _borderColor);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 1), // Compact vertical padding
      child: GestureDetector(
        onHorizontalDragStart: _isEntregado ? null : (_) {
          setState(() => _isDragging = true);
        },
        onHorizontalDragUpdate: _isEntregado ? null : (details) {
          setState(() => _dragOffset += details.delta.dx);
        },
        onHorizontalDragEnd: _isEntregado ? null : _handleDragEnd,
        onTapDown: (_) => _animController.forward(),
        onTapUp: (_) => _animController.reverse(),
        onTapCancel: () => _animController.reverse(),
        onTap: () {
          HapticFeedback.selectionClick();
          widget.onTap();
        },
        child: AnimatedBuilder(
          animation: _scaleAnimation,
          builder: (context, child) {
            return Transform.scale(
              scale: _scaleAnimation.value,
              child: _buildCardContent(),
            );
          },
        ),
      ),
    );
  }

  Widget _buildCardContent() {
    return AnimatedContainer(
      duration: AppTheme.animNormal,
      transform: Matrix4.translationValues(_dragOffset, 0, 0),
      child: Stack(
        children: [
          // Swipe indicators (behind card)
          if (_isDragging) ...[
            Positioned.fill(
              child: Row(
                children: [
                  // Left reveal (complete)
                  Expanded(
                    child: Container(
                      decoration: BoxDecoration(
                        color: AppTheme.success.withOpacity(0.2),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      alignment: Alignment.centerLeft,
                      padding: const EdgeInsets.only(left: 20),
                      child: Row(
                        children: const [
                          Icon(Icons.check_circle, color: AppTheme.success),
                          SizedBox(width: 8),
                          Text(
                            'COMPLETAR',
                            style: TextStyle(
                              color: AppTheme.success,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  // Right reveal (note)
                  Expanded(
                    child: Container(
                      decoration: BoxDecoration(
                        color: AppTheme.neonBlue.withOpacity(0.2),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      alignment: Alignment.centerRight,
                      padding: const EdgeInsets.only(right: 20),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: const [
                          Text(
                            'NOTA',
                            style: TextStyle(
                              color: AppTheme.neonBlue,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          SizedBox(width: 8),
                          Icon(Icons.edit_note, color: AppTheme.neonBlue),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
          
          // Main card
          Container(
            decoration: _cardDecoration.copyWith(
              border: Border.all(
                color: _borderColor.withOpacity(0.8), // Increased opacity for visibility
                width: _isUrgent ? 2.0 : 1.5,
              )
            ),
            child: Material(
              color: Colors.transparent,
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Header row
                    _buildHeader(),
                    
                    const SizedBox(height: 10),
                    
                    // Client info
                    _buildClientInfo(),
                    
                    const SizedBox(height: 6), // Reduced spacing
                    
                    // Quick actions
                    _buildQuickActions(),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHeader() {
    return Row(
      children: [
        // Document type badge
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: _isFactura
                  ? [
                      AppTheme.neonPurple.withOpacity(0.3),
                      AppTheme.neonPurple.withOpacity(0.1),
                    ]
                  : [
                      AppTheme.darkBase.withOpacity(0.8),
                      AppTheme.darkBase.withOpacity(0.5),
                    ],
            ),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: _isFactura
                  ? AppTheme.neonPurple.withOpacity(0.5)
                  : AppTheme.borderColor,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                _isFactura ? Icons.receipt_long : Icons.description_outlined,
                size: 14,
                color: _isFactura ? AppTheme.neonPurple : AppTheme.textSecondary,
              ),
              const SizedBox(width: 6),
              Text(
                _isFactura
                    ? 'F-${widget.albaran.numeroFactura}'
                    : 'A-${widget.albaran.numeroAlbaran}',
                style: TextStyle(
                  color: _isFactura ? AppTheme.neonPurple : AppTheme.textSecondary,
                  fontWeight: FontWeight.bold,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
        
        const SizedBox(width: 8),
        
        // Status indicator
        if (_isEntregado)
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: AppTheme.success.withOpacity(0.2),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.check,
              color: AppTheme.success,
              size: 14,
            ),
          ),
        
        const Spacer(),
        
        // Amount
        Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              NumberFormat.currency(symbol: '€', locale: 'es_ES')
                  .format(widget.albaran.importeTotal),
              style: TextStyle(
                color: _isUrgent ? AppTheme.obligatorio : AppTheme.textPrimary,
                fontSize: 20,
                fontWeight: FontWeight.bold,
                letterSpacing: -0.5,
              ),
            ),
            // Payment badge
            Container(
              margin: const EdgeInsets.only(top: 4),
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: _getPaymentColor().withOpacity(0.15),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(
                  color: _getPaymentColor().withOpacity(0.4),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (_isUrgent) ...[
                    Icon(
                      Icons.priority_high,
                      size: 10,
                      color: _getPaymentColor(),
                    ),
                    const SizedBox(width: 2),
                  ],
                  Text(
                    _getPaymentLabel(),
                    style: TextStyle(
                      color: _getPaymentColor(),
                      fontSize: 9,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildClientInfo() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Client name with code
        Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: AppTheme.neonBlue.withOpacity(0.15),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                widget.albaran.codigoCliente.length > 6
                    ? widget.albaran.codigoCliente.substring(
                        widget.albaran.codigoCliente.length - 4)
                    : widget.albaran.codigoCliente,
                style: const TextStyle(
                  color: AppTheme.neonBlue,
                  fontWeight: FontWeight.bold,
                  fontSize: 10,
                ),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                widget.albaran.nombreCliente,
                style: const TextStyle(
                  color: AppTheme.textPrimary,
                  fontWeight: FontWeight.w600,
                  fontSize: 15,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
        
        const SizedBox(height: 6),
        
        // Address
        Row(
          children: [
            Icon(
              Icons.location_on_outlined,
              size: 14,
              color: AppTheme.textTertiary,
            ),
            const SizedBox(width: 4),
            Expanded(
              child: Text(
                '${widget.albaran.direccion}, ${widget.albaran.poblacion}',
                style: TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 12,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ],
    );
  }





  Widget _buildQuickActions() {
    return Row(
      children: [
        // Detail button
        _buildActionButton(
          icon: Icons.assignment_outlined,
          label: 'DETALLE',
          onTap: widget.onTap,
        ),
        
        const SizedBox(width: 8),
        
        // Payment button (if urgent)
        if (_isUrgent && !_isEntregado)
          _buildActionButton(
            icon: Icons.payment,
            label: 'COBRAR',
            color: AppTheme.obligatorio,
            onTap: widget.onTap,
          ),
        
        const Spacer(),
        
        // Status text
        if (!_isEntregado)
          Text(
            '◀ Desliza para completar ▶',
            style: TextStyle(
              color: AppTheme.textTertiary,
              fontSize: 10,
              fontStyle: FontStyle.italic,
            ),
          ),
      ],
    );
  }

  Widget _buildActionButton({
    required IconData icon,
    required String label,
    Color? color,
    required VoidCallback onTap,
  }) {
    final buttonColor = color ?? AppTheme.neonBlue;
    
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: buttonColor.withOpacity(0.1),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: buttonColor.withOpacity(0.3),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 14, color: buttonColor),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(
                  color: buttonColor,
                  fontSize: 10,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Color _getPaymentColor() {
    if (widget.albaran.esCTR) return AppTheme.obligatorio;
    if (widget.albaran.colorEstado == 'green') return AppTheme.success;
    if (widget.albaran.colorEstado == 'orange') return AppTheme.opcional;
    return AppTheme.credito;
  }

  String _getPaymentLabel() {
    final code = widget.albaran.tipoPago.toUpperCase().trim();
    if (code == '01' || code == 'CNT' || code.contains('CONTADO')) return 'CONTADO';
    if (code.contains('REP')) return 'REPOSICIÓN';
    if (code.contains('MEN')) return 'MENSUAL';
    if (code.contains('CRE') || code == 'CR') return 'CRÉDITO';
    if (code.contains('TAR')) return 'TARJETA';
    if (code.contains('TRA')) return 'TRANSFER';
    return code.length > 8 ? code.substring(0, 8) : code;
  }

  void _handleDragEnd(DragEndDetails details) {
    setState(() => _isDragging = false);
    
    if (_dragOffset < -80) {
      // Swipe left - complete
      HapticFeedback.mediumImpact();
      widget.onSwipeComplete?.call();
    } else if (_dragOffset > 80) {
      // Swipe right - add note
      HapticFeedback.mediumImpact();
      widget.onSwipeNote?.call();
    }
    
    setState(() => _dragOffset = 0);
  }
}
