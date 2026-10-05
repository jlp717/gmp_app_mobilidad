import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:flutter/services.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_stop_visual.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_stop_status_badges.dart';
import 'package:intl/intl.dart';

final NumberFormat _deliveryCurrency =
    NumberFormat.currency(symbol: '€', locale: 'es_ES');

/// Smart Delivery Card with futuristic design
/// Features:
/// - Clear distinction between Albaran and Factura
/// - Payment status indicators with urgency levels
/// - AI suggestions integration
/// - Quick action buttons
/// - Swipe gestures for rapid completion
class SmartDeliveryCard extends StatefulWidget {
  const SmartDeliveryCard({
    required this.albaran,
    required this.onTap,
    super.key,
    this.onSwipeComplete,
    this.onSwipeNote,
    this.repartidorNames,
  });
  final AlbaranEntrega albaran;
  final VoidCallback onTap;
  final VoidCallback? onSwipeComplete;
  final VoidCallback? onSwipeNote;
  final Map<String, String>? repartidorNames;

  @override
  State<SmartDeliveryCard> createState() => _SmartDeliveryCardState();
}

class _SmartDeliveryCardState extends State<SmartDeliveryCard>
    with SingleTickerProviderStateMixin {
  late AnimationController _animController;
  late Animation<double> _scaleAnimation;
  double _dragOffset = 0;
  bool _isDragging = false;
  bool _swipeActionTriggered = false;

  static const double _swipeThreshold = 80;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      duration: AppTheme.animFast,
      vsync: this,
    );
    _scaleAnimation = Tween<double>(begin: 1, end: 0.98).animate(
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
  bool get _isNoEntregado =>
      widget.albaran.estado == EstadoEntrega.noEntregado ||
      widget.albaran.estado == EstadoEntrega.rechazado;
  bool get _isTerminal => switch (widget.albaran.estado) {
        EstadoEntrega.entregado ||
        EstadoEntrega.parcial ||
        EstadoEntrega.noEntregado ||
        EstadoEntrega.rechazado =>
          true,
        _ => false,
      };
  bool get _isUrgent => widget.albaran.esCTR;

  Color get _terminalColor => switch (widget.albaran.estado) {
        EstadoEntrega.entregado => AppTheme.success,
        EstadoEntrega.parcial || EstadoEntrega.noEntregado => AppTheme.warning,
        EstadoEntrega.rechazado => AppTheme.error,
        _ => AppTheme.info,
      };

  RuteroRowVisual get _rowVisual => ruteroRowVisual(widget.albaran);

  Color _toneColor(RuteroRowTone tone) {
    return switch (tone) {
      RuteroRowTone.cobroObligatorio => AppTheme.obligatorio,
      RuteroRowTone.entregaPendiente => AppTheme.info,
      RuteroRowTone.cobroOpcional => AppTheme.opcional,
      RuteroRowTone.entregado => AppTheme.success,
      RuteroRowTone.incidencia => AppTheme.warning,
    };
  }

  IconData get _rowIcon {
    return switch (_rowVisual.tone) {
      RuteroRowTone.cobroObligatorio => Icons.priority_high,
      RuteroRowTone.entregaPendiente => Icons.local_shipping_outlined,
      RuteroRowTone.cobroOpcional => Icons.payments_outlined,
      RuteroRowTone.entregado => Icons.check_circle_outline,
      RuteroRowTone.incidencia => Icons.report_outlined,
    };
  }

  Color get _borderColor =>
      _isTerminal ? _terminalColor : _toneColor(_rowVisual.tone);

  BoxDecoration get _cardDecoration {
    final baseColor = _borderColor;

    return BoxDecoration(
      gradient: LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [
          baseColor.withValues(alpha: 0.10),
          AppTheme.raisedSurface,
        ],
      ),
      borderRadius: BorderRadius.circular(AppTheme.radiusLg),
      border: Border.all(color: baseColor.withValues(alpha: 0.42), width: 1.2),
      boxShadow: [
        ...AppTheme.elevation1,
        BoxShadow(
          color: baseColor.withValues(alpha: 0.06),
          blurRadius: 16,
          offset: const Offset(0, 8),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: 8,
        vertical: 1,
      ), // Compact vertical padding
      child: GestureDetector(
        onTapDown: (_) => _animController.forward(),
        onTapUp: (_) => _animController.reverse(),
        onTapCancel: () => _animController.reverse(),
        onTap: () {
          HapticFeedback.selectionClick();
          widget.onTap();
        },
        onHorizontalDragStart: _isTerminal
            ? null
            : (_) {
                setState(() {
                  _isDragging = true;
                  _swipeActionTriggered = false;
                });
              },
        onHorizontalDragUpdate: _isTerminal
            ? null
            : (details) {
                setState(() {
                  _dragOffset =
                      (_dragOffset + details.delta.dx).clamp(-120.0, 120.0);
                });
              },
        onHorizontalDragEnd: _isTerminal ? null : _handleDragEnd,
        child: AnimatedBuilder(
          animation: _scaleAnimation,
          builder: (context, child) {
            return Transform.scale(
              scale: _scaleAnimation.value,
              child: Transform.translate(
                offset: Offset(_dragOffset, 0),
                child: child,
              ),
            );
          },
          child: _buildCardContent(),
        ),
      ),
    );
  }

  Widget _buildCardContent() {
    return Container(
      decoration: _cardDecoration,
      child: Material(
        color: AppColors.transparent,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildHeader(),
              const SizedBox(height: 10),
              _buildClientInfo(),
              const SizedBox(height: 6),
              RuteroStopStatusBadges(albaran: widget.albaran),
              const SizedBox(height: 6),
              _buildQuickActions(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Row(
      children: [
        // Document type badge
        Flexible(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: _isFactura
                  ? AppTheme.accentIndigo.withValues(alpha: 0.14)
                  : AppTheme.softPanel,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: _isFactura
                    ? AppTheme.accentIndigo.withValues(alpha: 0.32)
                    : AppTheme.borderColor,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  _isFactura ? Icons.receipt_long : Icons.description_outlined,
                  size: 14,
                  color: _isFactura
                      ? AppTheme.accentIndigo
                      : AppTheme.textSecondary,
                ),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(
                    widget.albaran.erpDocumentId,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: _isFactura
                          ? AppTheme.accentIndigo
                          : AppTheme.textSecondary,
                      fontWeight: FontWeight.bold,
                      fontSize: Responsive.isSmall(context) ? 10 : 12,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),

        const SizedBox(width: 8),

        // Status indicator
        if (_isTerminal)
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: _terminalColor.withValues(alpha: 0.2),
              shape: BoxShape.circle,
            ),
            child: Icon(
              widget.albaran.estado == EstadoEntrega.rechazado
                  ? Icons.cancel_outlined
                  : _isNoEntregado
                      ? Icons.remove_circle_outline
                      : Icons.check,
              color: _terminalColor,
              size: 14,
            ),
          ),

        const SizedBox(width: 8),

        // Amount
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                widget.albaran.isPendingPrice
                    ? 'Pendiente'
                    : _deliveryCurrency.format(widget.albaran.importeTotal),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: widget.albaran.isPendingPrice
                      ? AppTheme.warning
                      : _rowVisual.tone == RuteroRowTone.cobroObligatorio
                          ? AppTheme.obligatorio
                          : AppTheme.textPrimary,
                  fontSize: Responsive.isSmall(context) ? 17 : 20,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 0,
                ),
              ),
              // Payment badge
              Container(
                margin: const EdgeInsets.only(top: 4),
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: (widget.albaran.isPendingPrice
                          ? AppTheme.warning
                          : _borderColor)
                      .withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(
                    color: (widget.albaran.isPendingPrice
                            ? AppTheme.warning
                            : _borderColor)
                        .withValues(alpha: 0.4),
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      widget.albaran.isPendingPrice ? Icons.schedule : _rowIcon,
                      size: 12,
                      color: widget.albaran.isPendingPrice
                          ? AppTheme.warning
                          : _borderColor,
                    ),
                    const SizedBox(width: 2),
                    Flexible(
                      child: Text(
                        widget.albaran.isPendingPrice
                            ? 'Precio pendiente'
                            : _rowVisual.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: widget.albaran.isPendingPrice
                              ? AppTheme.warning
                              : _borderColor,
                          fontSize: 9,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
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
                color: AppTheme.info.withValues(alpha: 0.14),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                widget.albaran.codigoCliente.length > 6
                    ? widget.albaran.codigoCliente.substring(
                        widget.albaran.codigoCliente.length - 4,
                      )
                    : widget.albaran.codigoCliente,
                style: const TextStyle(
                  color: AppTheme.info,
                  fontWeight: FontWeight.bold,
                  fontSize: 10,
                ),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    widget.albaran.nombreCliente,
                    style: TextStyle(
                      color: AppTheme.textPrimary,
                      fontWeight: FontWeight.w600,
                      fontSize: Responsive.isSmall(context) ? 13 : 15,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (widget.albaran.nombreFiscal != null &&
                      widget.albaran.nombreFiscal!.isNotEmpty &&
                      widget.albaran.nombreFiscal!.toUpperCase() !=
                          widget.albaran.nombreCliente.toUpperCase())
                    Text(
                      widget.albaran.nombreFiscal!,
                      style: TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 10,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                ],
              ),
            ),
            // Repartidor badge for directors (shown when viewing multiple repartidores)
            if (widget.albaran.codigoRepartidor.isNotEmpty)
              Flexible(
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: AppTheme.warning.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(4),
                    border: Border.all(
                      color: AppTheme.warning.withValues(alpha: 0.32),
                    ),
                  ),
                  child: Text(
                    widget.repartidorNames != null &&
                            widget.repartidorNames!
                                .containsKey(widget.albaran.codigoRepartidor)
                        ? 'R ${widget.albaran.codigoRepartidor} – ${widget.repartidorNames![widget.albaran.codigoRepartidor]}'
                        : 'R ${widget.albaran.codigoRepartidor}',
                    style: const TextStyle(
                      color: AppTheme.warning,
                      fontWeight: FontWeight.bold,
                      fontSize: 10,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
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
                  fontSize: Responsive.isSmall(context) ? 10 : 12,
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
          label: 'Detalle',
          onTap: widget.onTap,
        ),

        const SizedBox(width: 8),

        // Payment button (if urgent)
        if (_isUrgent && !_isTerminal && widget.albaran.tieneSaldoCobrable)
          _buildActionButton(
            icon: Icons.payment,
            label: 'Cobrar',
            color: AppTheme.obligatorio,
            onTap: widget.onTap,
          ),
      ],
    );
  }

  Widget _buildActionButton({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
    Color? color,
  }) {
    final buttonColor = color ?? AppTheme.info;

    return Material(
      color: AppColors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: buttonColor.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: buttonColor.withValues(alpha: 0.3),
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

  void _handleDragEnd(DragEndDetails details) {
    if (!_isDragging || _swipeActionTriggered) {
      return;
    }

    final dragOffset = _dragOffset;
    setState(() {
      _isDragging = false;
      _dragOffset = 0;
    });

    if (dragOffset < -_swipeThreshold) {
      _swipeActionTriggered = true;
      HapticFeedback.mediumImpact();
      widget.onSwipeComplete?.call();
    } else if (dragOffset > _swipeThreshold) {
      _swipeActionTriggered = true;
      HapticFeedback.mediumImpact();
      widget.onSwipeNote?.call();
    }

    if (mounted) {
      setState(() => _swipeActionTriggered = false);
    }
  }
}
