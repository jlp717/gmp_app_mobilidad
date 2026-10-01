/// Product Card (Redesigned)
/// =========================
/// Catalog product card with purchase history badges, unit type indicators,
/// YoY change, IVA toggle, and dual price display
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/fullscreen_image_viewer.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_product_image.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/utils/pedidos_formatters.dart';

class ProductCard extends StatefulWidget {
  const ProductCard({
    required this.product,
    required this.onTap,
    super.key,
    this.isFavorite = false,
    this.promo,
    this.extraPromoCount = 0,
    this.onToggleFavorite,
    this.cartQty = 0,
    this.cartQtySuffix = 'c',
    this.onQuickAdd,
    this.isMarginVisible = false,
    this.compact = false,
  });
  final Product product;
  final VoidCallback onTap;
  final bool isFavorite;
  final PromotionItem? promo;
  final int extraPromoCount;
  final VoidCallback? onToggleFavorite;
  final double cartQty;
  final String cartQtySuffix;
  final VoidCallback? onQuickAdd;
  final bool isMarginVisible;

  /// Dense landscape/grid tile: shorter chrome so ~9–10 products fit on screen.
  final bool compact;

  @override
  State<ProductCard> createState() => _ProductCardState();
}

class _ProductCardState extends State<ProductCard> {
  bool _showIva = false;

  /// True when the seller is looking at the client special price.
  /// Falls back to the tariff when that special price is absent.
  bool _preferEspecial = true;

  double _ivaRateForProduct() => ivaRateFromCode(widget.product.codigoIva);

  double _priceWithIva(double price) => price * (1 + _ivaRateForProduct());

  String _formatPrice(double price, {int decimals = 3}) {
    final displayPrice = _showIva ? _priceWithIva(price) : price;
    return displayPrice.toStringAsFixed(decimals);
  }

  String _unitTypeLabel() {
    final ut = widget.product.unitType;
    if (ut == null) return '';
    switch (ut) {
      case 'caja':
        return 'Caja';
      case 'unidad':
        return 'Unidad';
      case 'ambos':
        return 'Caja+Unidad';
      default:
        return '';
    }
  }

  IconData _unitTypeIcon() {
    final ut = widget.product.unitType;
    if (ut == 'unidad') return Icons.emoji_food_beverage;
    if (ut == 'ambos') return Icons.inventory_2;
    return Icons.inventory_2; // caja default
  }

  /// Positive amount only. A missing price is null, never a fake 0.
  double? _positive(double value) => value > 0 ? value : null;

  /// Tariff shown by the old «Tarifa» side: catalog [Product.precioTarifa1].
  double? get _tarifaRaw => _positive(widget.product.precioTarifa1);

  /// Client price shown by the old «Cliente» side: [Product.precioCliente].
  /// «Último precio» is not on [Product]. A new JAVIER table, if any, belongs
  /// to the backend owner — this card does not invent one or paint 0.
  double? get _especialRaw => _positive(widget.product.precioCliente);

  bool get _especialSelected => _preferEspecial && _especialRaw != null;

  bool get _tarifaSelected => !_especialSelected && _tarifaRaw != null;

  double? get _selectedRaw =>
      _especialSelected ? _especialRaw : (_tarifaSelected ? _tarifaRaw : null);

  String _money(double raw) {
    final shown = _showIva ? _priceWithIva(raw) : raw;
    final fixed = shown.toStringAsFixed(3).replaceAll('.', ',');
    return '$fixed €';
  }

  String get _activePriceLabel {
    final raw = _selectedRaw;
    if (raw == null) return 'Sin precio';
    return _money(raw);
  }

  void _selectTarifa() {
    if (_tarifaRaw == null) return;
    setState(() => _preferEspecial = false);
  }

  void _selectEspecial() {
    if (_especialRaw == null) return;
    setState(() => _preferEspecial = true);
  }

  @override
  Widget build(BuildContext context) {
    final inCart = widget.cartQty > 0;
    final badgeQty = widget.cartQty == widget.cartQty.truncateToDouble()
        ? widget.cartQty.toStringAsFixed(0)
        : widget.cartQty.toStringAsFixed(2);
    final compact = widget.compact || Responsive.useCompactTiles(context);
    final hPad = compact ? 8.0 : 14.0;
    final vPad = compact ? 6.0 : 10.0;
    final promoColor = widget.promo?.isGift ?? false
        ? AppTheme.success
        : AppTheme.accentIndigo;
    final unitLabel = _unitTypeLabel();
    final primaryUnit = widget.product.displayUnit;
    final minPrimaryPrice = widget.product.minimumPriceForUnit(primaryUnit);
    final minUnit = Product.unitLabel(primaryUnit);
    final selected = _selectedRaw;
    final showMin = widget.isMarginVisible &&
        widget.product.precioMinimo > 0 &&
        selected != null &&
        minPrimaryPrice != selected;
    final boxBadge = _buildBoxContentBadge();
    final showRetractil =
        widget.product.unitsRetractil > 0 && widget.product.bestPrice > 0;

    return RepaintBoundary(
      child: Semantics(
        button: true,
        explicitChildNodes: true,
        label: '${widget.product.name}, ${widget.product.code}',
        child: Card(
          color: inCart
              ? AppTheme.raisedSurface.withValues(alpha: 0.98)
              : AppTheme.softPanel,
          elevation: inCart ? 2 : 0,
          shadowColor: AppTheme.success.withValues(alpha: 0.12),
          surfaceTintColor: AppColors.transparent,
          margin: EdgeInsets.only(bottom: compact ? 0 : 8),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusMd),
            side: BorderSide(
              color: inCart
                  ? AppTheme.success
                  : widget.promo != null
                      ? promoColor
                      : AppTheme.borderColor.withValues(alpha: 0.42),
              width: inCart ? 1.5 : (widget.promo != null ? 1.5 : 1.0),
            ),
          ),
          child: InkWell(
            borderRadius: BorderRadius.circular(AppTheme.radiusMd),
            onTap: widget.onTap,
            child: Padding(
              padding: EdgeInsets.symmetric(horizontal: hPad, vertical: vPad),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Stack(
                        children: [
                          GestureDetector(
                            behavior: HitTestBehavior.opaque,
                            onTap: () => _showFullscreenImage(
                              context,
                              widget.product.code,
                            ),
                            child: _buildThumbnail(
                              widget.product.code,
                              compact: compact,
                            ),
                          ),
                          if (inCart)
                            Positioned(
                              top: 0,
                              right: 0,
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 4,
                                  vertical: 1,
                                ),
                                decoration: BoxDecoration(
                                  color: AppTheme.success,
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  '$badgeQty${widget.cartQtySuffix}',
                                  style: TextStyle(
                                    color: AppTheme.inkSurface,
                                    fontSize: 12,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(width: 10),
                      Expanded(child: _buildIdentity(unitLabel, promoColor)),
                    ],
                  ),
                  const SizedBox(height: 6),
                  _buildSecondaryRow(
                    showMin: showMin,
                    minUnit: minUnit,
                    minPrimaryPrice: minPrimaryPrice,
                    boxBadge: boxBadge,
                    showRetractil: showRetractil,
                  ),
                  const SizedBox(height: 8),
                  _PriceModeButton(
                    buttonKey: const Key('price-mode-tarifa'),
                    label: 'Precio de tarifa',
                    amountLabel:
                        _tarifaRaw == null ? 'Sin tarifa' : _money(_tarifaRaw!),
                    selected: _tarifaSelected,
                    onTap: _selectTarifa,
                  ),
                  const SizedBox(height: 8),
                  _PriceModeButton(
                    buttonKey: const Key('price-mode-especial'),
                    label: 'Precio especial',
                    amountLabel: _especialRaw == null
                        ? 'Sin precio especial'
                        : _money(_especialRaw!),
                    selected: _especialSelected,
                    onTap: _selectEspecial,
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _activePriceLabel,
                    key: const Key('active-sale-price'),
                    style: TextStyle(
                      color: _showIva
                          ? AppTheme.accentIndigo
                          : AppTheme.textPrimary,
                      fontWeight: FontWeight.w800,
                      fontSize: 16,
                      height: 1.25,
                    ),
                  ),
                  const SizedBox(height: 8),
                  _buildActions(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildIdentity(String unitLabel, Color promoColor) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          widget.product.name,
          style: TextStyle(
            color: AppTheme.textPrimary,
            fontWeight: FontWeight.w700,
            fontSize: 16,
            height: 1.25,
          ),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        const SizedBox(height: 2),
        Text(
          widget.product.code,
          style: TextStyle(
            color: AppTheme.textSecondary,
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 4),
        Wrap(
          spacing: 6,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(
              widget.product.hasPurchased ? 'Comprado' : 'Nuevo',
              style: TextStyle(
                color: widget.product.hasPurchased
                    ? AppTheme.success
                    : AppTheme.error,
                fontSize: 14,
                fontWeight: FontWeight.w700,
              ),
            ),
            if (unitLabel.isNotEmpty)
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(_unitTypeIcon(), color: AppTheme.info, size: 16),
                  const SizedBox(width: 4),
                  Text(
                    unitLabel,
                    style: const TextStyle(
                      color: AppTheme.info,
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            if (widget.promo != null)
              Text(
                (widget.promo!.isGift
                        ? widget.promo!.giftLabel
                        : widget.promo!.promoDesc) +
                    (widget.extraPromoCount > 0
                        ? ' +${widget.extraPromoCount}'
                        : ''),
                style: TextStyle(
                  color: promoColor,
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          _buildStockText(widget.product),
          style: TextStyle(
            color: widget.product.hasStock ? AppTheme.success : AppTheme.error,
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }

  /// Quieter second row. Still on screen: nothing here needs a tap.
  Widget _buildSecondaryRow({
    required bool showMin,
    required String minUnit,
    required double minPrimaryPrice,
    required String boxBadge,
    required bool showRetractil,
  }) {
    final children = <Widget>[
      if (widget.product.hasPurchased && widget.product.yoyChange != 0)
        _buildYoyBadge(),
      if (boxBadge.isNotEmpty)
        Text(
          boxBadge,
          style: TextStyle(
            color: AppTheme.textSecondary,
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
      if (showRetractil)
        Text(
          'U/R: ${(widget.product.bestPrice / widget.product.unitsRetractil).toStringAsFixed(3)}€',
          style: TextStyle(
            color: AppTheme.textSecondary,
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
      if (showMin)
        Text(
          'Min $minUnit: ${_formatPrice(minPrimaryPrice, decimals: 2)}€',
          style: TextStyle(
            color: AppTheme.textSecondary,
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
      if (widget.product.precioEspecialCliente)
        const Text(
          'Precio exclusivo cliente',
          style: TextStyle(
            color: AppTheme.success,
            fontSize: 13,
            fontWeight: FontWeight.w700,
          ),
        ),
    ];
    if (children.isEmpty) return const SizedBox.shrink();
    return Wrap(
      spacing: 10,
      runSpacing: 4,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: children,
    );
  }

  Widget _buildActions() {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        _ivaToggle(),
        if (widget.onQuickAdd != null)
          Semantics(
            button: true,
            label: 'Añadir ${widget.product.name} al carrito',
            child: Tooltip(
              message: 'Añadir al carrito',
              child: Material(
                color: AppColors.transparent,
                child: InkWell(
                  onTap: widget.onQuickAdd,
                  borderRadius: BorderRadius.circular(AppTheme.radiusFull),
                  child: ConstrainedBox(
                    constraints:
                        const BoxConstraints(minWidth: 48, minHeight: 48),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.add_shopping_cart_rounded,
                            color: AppTheme.info,
                            size: 18,
                          ),
                          const SizedBox(width: 6),
                          const Text(
                            'Añadir',
                            style: TextStyle(
                              color: AppTheme.info,
                              fontSize: 16,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        if (widget.onToggleFavorite != null)
          Semantics(
            button: true,
            label: widget.isFavorite
                ? 'Quitar ${widget.product.name} de favoritos'
                : 'Marcar ${widget.product.name} como favorito',
            child: IconButton(
              onPressed: widget.onToggleFavorite,
              icon: Icon(
                widget.isFavorite
                    ? Icons.star_rounded
                    : Icons.star_outline_rounded,
                color: widget.isFavorite
                    ? AppTheme.warning
                    : AppTheme.textTertiary,
              ),
            ),
          ),
        Icon(
          Icons.chevron_right,
          color: AppTheme.textTertiary,
          size: 24,
        ),
      ],
    );
  }

  Widget _ivaToggle() {
    return Semantics(
      button: true,
      label: _showIva ? 'Ver precio sin IVA' : 'Ver precio con IVA',
      child: TextButton(
        onPressed: () => setState(() => _showIva = !_showIva),
        style: TextButton.styleFrom(
          minimumSize: const Size(48, 48),
          tapTargetSize: MaterialTapTargetSize.padded,
          foregroundColor:
              _showIva ? AppTheme.accentIndigo : AppTheme.textPrimary,
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
        ),
        child: Text(_showIva ? 'Con IVA' : 'Sin IVA'),
      ),
    );
  }

  Widget _buildYoyBadge() {
    final yoy = widget.product.yoyChange;
    final isPositive = yoy > 0;
    final isNegative = yoy < 0;

    Color bgColor;
    Color textColor;
    IconData icon;

    if (isPositive) {
      bgColor = AppTheme.success.withValues(alpha: 0.15);
      textColor = AppTheme.success;
      icon = Icons.trending_up;
    } else if (isNegative) {
      bgColor = AppTheme.error.withValues(alpha: 0.15);
      textColor = AppTheme.error;
      icon = Icons.trending_down;
    } else {
      bgColor = AppTheme.textPrimary.withValues(alpha: 0.08);
      textColor = AppTheme.textSecondary;
      icon = Icons.trending_flat;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 1),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(3),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: textColor, size: 16),
          const SizedBox(width: 4),
          Text(
            '${yoy.abs().toStringAsFixed(1)}%',
            style: TextStyle(
              color: textColor,
              fontSize: 13,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  String _buildStockText(Product p) {
    final parts = <String>[];
    final cjStr = '${PedidosFormatters.number(p.stockEnvases)} cj';
    final content = p.boxContentDesc;
    parts.add(content.isNotEmpty ? '$cjStr ($content/cj)' : cjStr);
    for (final unit in p.availableUnits) {
      if (unit == 'CAJAS') continue;
      final stock = p.stockForUnit(unit);
      final label = Product.unitLabel(unit);
      final dec = (unit == 'KILOGRAMOS') ? 1 : 0;
      parts.add('${PedidosFormatters.number(stock, decimals: dec)} $label');
    }
    return parts.join(' / ');
  }

  Widget _buildThumbnail(String code, {bool compact = false}) {
    final url = '${ApiConfig.baseUrl}/products/'
        '${Uri.encodeComponent(code.trim())}/image';
    // The missing-image fallback is a fixed box in SmartProductImage.
    // Grow that box with the text scale so the initials stay inside it.
    // Price labels keep the ambient text scale.
    final size = MediaQuery.textScalerOf(context).scale(compact ? 40.0 : 48.0);
    return SmartProductImage(
      imageUrl: url,
      productCode: code,
      productName: widget.product.name,
      width: size,
      height: size,
      headers: ApiClient.authHeaders,
      borderRadius: BorderRadius.circular(8),
    );
  }

  void _showFullscreenImage(BuildContext context, String code) {
    final imageUrl = '${ApiConfig.baseUrl}/products/'
        '${Uri.encodeComponent(code.trim())}/image';
    FullscreenImageViewer.show(
      context,
      imageUrl: imageUrl,
      productName: widget.product.name,
      productCode: code,
      headers: ApiClient.authHeaders,
      rootNavigator: true,
    );
  }

  String _buildBoxContentBadge() {
    final p = widget.product;
    final content = p.boxContentDesc;
    if (content.isNotEmpty) return content;
    if (p.unitsPerBox > 1) return '${_formatUc(p.unitsPerBox)} uds/cj';
    return '';
  }

  String _formatUc(double value) {
    if (value == value.roundToDouble()) {
      return value.toInt().toString();
    }
    return value.toStringAsFixed(1);
  }
}

/// Two explicit prices. Selected = fill color + pill shape + check.
/// Unselected = outlined rectangle, no check. Never color alone.
class _PriceModeButton extends StatelessWidget {
  const _PriceModeButton({
    required this.buttonKey,
    required this.label,
    required this.amountLabel,
    required this.selected,
    required this.onTap,
  });

  final Key buttonKey;
  final String label;
  final String amountLabel;
  final bool selected;
  final VoidCallback onTap;

  static const Color selectedFill = Color(0xFF007A52);
  static const Color selectedForeground = Color(0xFFFFFFFF);
  static const Color idleFill = Color(0xFFFFFFFF);
  static const Color idleForeground = Color(0xFF132027);

  @override
  Widget build(BuildContext context) {
    final foreground = selected ? selectedForeground : idleForeground;
    final background = selected ? selectedFill : idleFill;
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(selected ? 20 : 8),
      side: BorderSide(
        color: selected ? const Color(0xFF004E34) : idleForeground,
        width: selected ? 2 : 1.5,
      ),
    );
    final textStyle = TextStyle(
      color: foreground,
      fontSize: 16,
      height: 1.25,
      fontWeight: FontWeight.w700,
    );

    return Semantics(
      button: true,
      selected: selected,
      label: '$label, $amountLabel',
      child: Material(
        key: buttonKey,
        color: background,
        shape: shape,
        child: InkWell(
          customBorder: shape,
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  if (selected) ...[
                    Icon(Icons.check, color: foreground, size: 22),
                    const SizedBox(width: 8),
                  ],
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(label, style: textStyle),
                        Text(amountLabel, style: textStyle),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
