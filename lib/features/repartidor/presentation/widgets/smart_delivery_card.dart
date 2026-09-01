import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_stop_status_badges.dart';
import 'package:intl/intl.dart';

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
  bool get _isUnconfirmed =>
      widget.albaran.estado == EstadoEntrega.pendiente ||
      widget.albaran.estado == EstadoEntrega.enRuta;
  bool get _isUrgent => widget.albaran.esCTR;

  Color get _terminalColor => switch (widget.albaran.estado) {
        EstadoEntrega.entregado => AppTheme.success,
        EstadoEntrega.parcial || EstadoEntrega.noEntregado => AppTheme.warning,
        EstadoEntrega.rechazado => AppTheme.error,
        _ => AppTheme.info,
      };

  Color get _borderColor {
    if (_isTerminal) return _terminalColor;
    if (_isUnconfirmed) return AppTheme.obligatorio;
    if (widget.albaran.colorEstado == 'purple' || _isFactura) {
      return AppTheme.accentIndigo;
    }
    if (widget.albaran.colorEstado == 'red' || _isUrgent) {
      return AppTheme.obligatorio;
    }
    return AppTheme.info;
  }

  BoxDecoration get _cardDecoration {
    Color baseColor;
    if (_isTerminal) {
      baseColor = _terminalColor;
    } else if (_isUnconfirmed) {
      baseColor = AppTheme.obligatorio;
    } else if (widget.albaran.colorEstado == 'purple' || _isFactura) {
      baseColor = AppTheme.accentIndigo;
    } else if (widget.albaran.colorEstado == 'red' || _isUrgent) {
      baseColor = AppTheme.obligatorio;
    } else {
      baseColor = AppTheme.info;
    }

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
                child: _buildCardContent(),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _buildCardContent() {
    return Container(
      decoration: _cardDecoration,
      child: Material(
        color: Colors.transparent,
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
        Container(
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
                color:
                    _isFactura ? AppTheme.accentIndigo : AppTheme.textSecondary,
              ),
              const SizedBox(width: 6),
              Text(
                _isFactura
                    ? '${widget.albaran.serieFactura.isNotEmpty ? widget.albaran.serieFactura : "F"}-${widget.albaran.numeroFactura}'
                    : '${widget.albaran.serie.isNotEmpty ? widget.albaran.serie : "A"}${widget.albaran.terminal > 0 ? "-${widget.albaran.terminal}" : ""}-${widget.albaran.numeroAlbaran}',
                style: TextStyle(
                  color: _isFactura
                      ? AppTheme.accentIndigo
                      : AppTheme.textSecondary,
                  fontWeight: FontWeight.bold,
                  fontSize: Responsive.isSmall(context) ? 10 : 12,
                ),
              ),
            ],
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

        const Spacer(),

        // Amount
        Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              widget.albaran.isPendingPrice
                  ? 'Pendiente'
                  : NumberFormat.currency(symbol: '€', locale: 'es_ES')
                      .format(widget.albaran.importeTotal),
              style: TextStyle(
                color: widget.albaran.isPendingPrice
                    ? AppTheme.warning
                    : _isUrgent
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
                        : _getPaymentColor())
                    .withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(
                  color: (widget.albaran.isPendingPrice
                          ? AppTheme.warning
                          : _getPaymentColor())
                      .withValues(alpha: 0.4),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (_isUrgent && !widget.albaran.isPendingPrice) ...[
                    Icon(
                      Icons.priority_high,
                      size: 10,
                      color: _getPaymentColor(),
                    ),
                    const SizedBox(width: 2),
                  ],
                  Text(
                    widget.albaran.isPendingPrice
                        ? 'PRECIO PENDIENTE'
                        : _getPaymentLabel(),
                    style: TextStyle(
                      color: widget.albaran.isPendingPrice
                          ? AppTheme.warning
                          : _getPaymentColor(),
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
                      style: const TextStyle(
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
            const Icon(
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
          label: 'DETALLE',
          onTap: widget.onTap,
        ),

        const SizedBox(width: 8),

        // Payment button (if urgent)
        if (_isUrgent && !_isTerminal)
          _buildActionButton(
            icon: Icons.payment,
            label: 'COBRAR',
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
      color: Colors.transparent,
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

  String _getPaymentLabel() {
    if (widget.albaran.hasAppCobro) {
      final method = (widget.albaran.formaPagoCobro ?? '').trim();
      final kind = widget.albaran.cobroParcial
          ? 'COBRO PARCIAL'
          : widget.albaran.importePendienteCobro == null
              ? 'COBRO REGISTRADO'
              : 'COBRADO';
      if (method.isEmpty) return kind;
      return '$kind · $method';
    }
    final code = widget.albaran.tipoPago.toUpperCase().trim();
    if (code == '01' || code == 'CNT' || code.contains('CONTADO')) {
      return 'CONTADO';
    }
    if (code.contains('REP')) return 'REPOSICIÓN';
    if (code.contains('MEN')) return 'MENSUAL';
    if (code.contains('CRE') || code == 'CR') return 'CRÉDITO';
    if (code.contains('TAR')) return 'TARJETA';
    if (code.contains('TRA')) return 'TRANSFER';
    return code.length > 8 ? code.substring(0, 8) : code;
  }

  Color _getPaymentColor() {
    if (widget.albaran.hasAppCobro)
      return widget.albaran.cobroParcial ||
              widget.albaran.importePendienteCobro == null
          ? AppTheme.warning
          : AppTheme.success;
    if (widget.albaran.esCTR) return AppTheme.obligatorio;
    if (widget.albaran.colorEstado == 'green') return AppTheme.success;
    if (widget.albaran.colorEstado == 'orange') return AppTheme.opcional;
    return AppTheme.credito;
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
