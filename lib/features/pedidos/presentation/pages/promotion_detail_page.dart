import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/utils/pedidos_formatters.dart';

class PromotionDetailPage extends StatefulWidget {
  const PromotionDetailPage({
    required this.promoType,
    required this.promoCode,
    required this.promoDesc,
    required this.dateFrom,
    required this.dateTo,
    required this.minQty,
    required this.giftQty,
    required this.cumulative,
    required this.items,
    required this.onProductTap,
    super.key,
    this.onAddGift,
    this.hasStockResolver,
    this.qtyInOrderResolver,
    this.giftSelectionLocked = false,
  });
  final String promoType;
  final String promoCode;
  final String promoDesc;
  final String dateFrom;
  final String dateTo;
  final double minQty;
  final double giftQty;
  final bool cumulative;
  final List<PromotionItem> items;
  final Future<void> Function(String code, String name) onProductTap;
  final Future<String?> Function(String code, String name, double qty)?
      onAddGift;
  final bool? Function(String code)? hasStockResolver;
  final double Function(String code)? qtyInOrderResolver;

  /// Cuando true, el regalo viene fijado por la promoción (no se puede elegir otro).
  final bool giftSelectionLocked;

  @override
  State<PromotionDetailPage> createState() => _PromotionDetailPageState();
}

class _PromotionDetailPageState extends State<PromotionDetailPage> {
  String _search = '';
  bool _onlyWithStock = false;
  final Map<String, double> _giftSelection = {};
  bool _submittingGifts = false;

  double get _purchasedQty {
    final resolver = widget.qtyInOrderResolver;
    if (resolver == null) return 0;
    double total = 0;
    for (final item in widget.items) {
      total += resolver(item.code);
    }
    return total;
  }

  double get _eligibleGiftQty {
    if (widget.promoType != 'GIFT') return 0;
    if (widget.minQty <= 0 || widget.giftQty <= 0) return 0;
    if (_purchasedQty <= 0) return 0;

    final cycles = widget.cumulative
        ? (_purchasedQty / widget.minQty).floorToDouble()
        : (_purchasedQty >= widget.minQty ? 1.0 : 0.0);
    return cycles * widget.giftQty;
  }

  double get _selectedGiftQty =>
      _giftSelection.values.fold(0, (sum, qty) => sum + qty);

  void _changeGiftQty(String code, double delta) {
    if (widget.promoType == 'GIFT' && _eligibleGiftQty <= 0) {
      return;
    }
    final current = _giftSelection[code] ?? 0;
    var next = (current + delta).clamp(0, 9999).toDouble();
    if (widget.promoType == 'GIFT' && _eligibleGiftQty > 0) {
      final maxForThis = _eligibleGiftQty - _selectedGiftQty + current;
      if (next > maxForThis) next = maxForThis;
    }
    if (next <= 0) {
      _giftSelection.remove(code);
    } else {
      _giftSelection[code] = next;
    }
    setState(() {});
  }

  Future<void> _submitGiftSelection() async {
    if (widget.onAddGift == null) return;
    if (_giftSelection.isEmpty) return;
    setState(() => _submittingGifts = true);
    final errors = <String>[];
    for (final entry in _giftSelection.entries) {
      final item = widget.items.firstWhere(
        (it) => it.code == entry.key,
        orElse: () =>
            PromotionItem(code: entry.key, name: entry.key, promoDesc: ''),
      );
      final qty = entry.value;
      if (qty <= 0) continue;
      final err = await widget.onAddGift!(item.code, item.name, qty);
      if (err != null && err.isNotEmpty) errors.add('${item.code}: $err');
    }
    if (!mounted) return;
    setState(() => _submittingGifts = false);
    if (errors.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Regalos añadidos al pedido como lineas SC'),
          backgroundColor: AppTheme.success,
        ),
      );
      Navigator.pop(context);
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          errors.take(2).join(' | '),
        ),
        backgroundColor: AppTheme.warning,
      ),
    );
  }

  List<PromotionItem> get _filteredItems {
    return widget.items.where((item) {
      if (_onlyWithStock) {
        final hasStock =
            widget.hasStockResolver?.call(item.code) ?? item.hasStock;
        if (hasStock != true) return false;
      }
      if (_search.isEmpty) return true;
      final q = _search.toLowerCase();
      return item.code.toLowerCase().contains(q) ||
          item.name.toLowerCase().contains(q) ||
          item.promoDesc.toLowerCase().contains(q);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final accent =
        widget.promoType == 'GIFT' ? AppTheme.accentIndigo : AppTheme.success;

    return Scaffold(
      backgroundColor: AppTheme.inkSurface,
      appBar: AppBar(
        backgroundColor: AppTheme.raisedSurface,
        elevation: 0,
        title: Text(
          widget.promoType == 'GIFT' ? 'Promocion Regalo' : 'Promocion Precio',
        ),
      ),
      body: Column(
        children: [
          Container(
            margin: const EdgeInsets.fromLTRB(12, 12, 12, 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppTheme.raisedSurface,
              borderRadius: BorderRadius.circular(AppTheme.radiusLg),
              border: Border.all(color: accent.withValues(alpha: 0.34)),
              boxShadow: AppTheme.elevation1,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  widget.promoDesc.isNotEmpty ? widget.promoDesc : 'Promocion',
                  style: TextStyle(
                    color: accent,
                    fontSize: 17,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 4),
                if (widget.promoCode.isNotEmpty)
                  Text(
                    'Codigo: ${widget.promoCode}',
                    style: const TextStyle(
                        color: AppTheme.textSecondary, fontSize: 12),
                  ),
                if (widget.dateFrom.isNotEmpty || widget.dateTo.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      'Vigencia: ${widget.dateFrom.isEmpty ? '-' : widget.dateFrom}  ->  ${widget.dateTo.isEmpty ? '-' : widget.dateTo}',
                      style: const TextStyle(
                          color: AppTheme.textSecondary, fontSize: 11),
                    ),
                  ),
                if (widget.promoType == 'GIFT') ...[
                  const SizedBox(height: 8),
                  if (widget.giftSelectionLocked) ...[
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: AppTheme.warning.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: AppTheme.warning.withValues(alpha: 0.35),
                        ),
                      ),
                      child: const Row(
                        children: [
                          Icon(Icons.lock, color: AppTheme.warning, size: 18),
                          SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Esta promoción incluye un regalo fijo. Se aplica automáticamente al añadir el producto al pedido; no puedes elegir otro artículo.',
                              style: TextStyle(
                                color: AppTheme.textSecondary,
                                fontSize: 11,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ] else ...[
                    // How the promo works
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: AppTheme.accentIndigo.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: AppTheme.accentIndigo.withValues(alpha: 0.2),
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Como funciona:',
                            style: TextStyle(
                              color:
                                  AppTheme.accentIndigo.withValues(alpha: 0.8),
                              fontSize: 10,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Por cada ${widget.minQty.toStringAsFixed(0)} uds que compres de los productos de esta promocion, llévate ${widget.giftQty.toStringAsFixed(0)} gratis.${widget.cumulative ? ' (Se acumula: si compras ${(widget.minQty * 2).toStringAsFixed(0)} uds, llévate ${(widget.giftQty * 2).toStringAsFixed(0)} gratis)' : ''}',
                            style: const TextStyle(
                              color: AppTheme.textSecondary,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 8),
                    // Progress bar: how close to min purchase
                    if (_purchasedQty > 0) ...[
                      _buildProgressSection(),
                    ] else ...[
                      Text(
                        'Añade al menos ${widget.minQty.toStringAsFixed(0)} uds de los productos de esta promocion para poder elegir tus regalos.',
                        style: const TextStyle(
                          color: AppTheme.textSecondary,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ],
                ],
              ],
            ),
          ),
          Container(
            margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
            child: TextField(
              onChanged: (v) => setState(() => _search = v.trim()),
              style: const TextStyle(color: AppTheme.textPrimary),
              decoration: InputDecoration(
                hintText: 'Buscar articulo en promocion...',
                hintStyle: const TextStyle(color: AppTheme.textTertiary),
                prefixIcon: const Icon(
                  Icons.search,
                  color: AppTheme.info,
                  size: 18,
                ),
                suffixIcon: IconButton(
                  onPressed: () =>
                      setState(() => _onlyWithStock = !_onlyWithStock),
                  icon: Icon(
                    _onlyWithStock
                        ? Icons.inventory_2
                        : Icons.inventory_2_outlined,
                    color: _onlyWithStock
                        ? AppTheme.success
                        : AppTheme.textTertiary,
                    size: 19,
                  ),
                  tooltip: 'Solo con stock',
                ),
                filled: true,
                fillColor: AppTheme.softPanel,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: BorderSide.none,
                ),
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              ),
            ),
          ),
          Expanded(
            child: _filteredItems.isEmpty
                ? const Center(
                    child: Text(
                      'No hay articulos para los filtros actuales.',
                      style: TextStyle(color: AppTheme.textSecondary),
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                    itemCount: _filteredItems.length,
                    itemBuilder: (context, index) {
                      final item = _filteredItems[index];
                      final hasStock =
                          widget.hasStockResolver?.call(item.code) ??
                              item.hasStock;
                      final stockColor =
                          hasStock == true ? AppTheme.success : AppTheme.error;
                      return Card(
                        color: AppTheme.softPanel,
                        margin: const EdgeInsets.only(bottom: 8),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                          side: BorderSide(
                            color: AppTheme.borderColor.withValues(alpha: 0.5),
                          ),
                        ),
                        child: ListTile(
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 6,
                          ),
                          title: Text(
                            item.name,
                            style: const TextStyle(
                              color: AppTheme.textPrimary,
                              fontWeight: FontWeight.w600,
                              fontSize: 13,
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          subtitle: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const SizedBox(height: 4),
                              Text(
                                item.code,
                                style: const TextStyle(
                                  color: AppTheme.textSecondary,
                                  fontSize: 11,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Wrap(
                                spacing: 8,
                                runSpacing: 2,
                                children: [
                                  Text(
                                    'Stock: ${PedidosFormatters.number(item.stockEnvases)} cj',
                                    style: TextStyle(
                                      color: stockColor,
                                      fontSize: 11,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  if (item.promoType == 'PRICE')
                                    Text(
                                      'Oferta: ${PedidosFormatters.money(item.promoPrice, decimals: 3)}',
                                      style: const TextStyle(
                                        color: AppTheme.success,
                                        fontSize: 11,
                                      ),
                                    ),
                                  if (item.promoType == 'GIFT' &&
                                      widget.minQty > 0 &&
                                      widget.giftQty > 0)
                                    Text(
                                      '${widget.minQty.toStringAsFixed(0)}+${widget.giftQty.toStringAsFixed(0)}',
                                      style: const TextStyle(
                                        color: AppTheme.accentIndigo,
                                        fontSize: 11,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                ],
                              ),
                            ],
                          ),
                          trailing: ElevatedButton(
                            onPressed: () =>
                                widget.onProductTap(item.code, item.name),
                            style: ElevatedButton.styleFrom(
                              backgroundColor:
                                  AppTheme.info.withValues(alpha: 0.18),
                              foregroundColor: AppTheme.info,
                              elevation: 0,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(8),
                              ),
                            ),
                            child: const Text(
                              'Seleccionar',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          isThreeLine: widget.promoType == 'GIFT' &&
                              !widget.giftSelectionLocked &&
                              widget.onAddGift != null,
                          leading: widget.promoType == 'GIFT' &&
                                  !widget.giftSelectionLocked &&
                                  widget.onAddGift != null
                              ? Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    IconButton(
                                      onPressed: () =>
                                          _changeGiftQty(item.code, -1),
                                      icon: const Icon(
                                        Icons.remove_circle_outline,
                                        color: AppTheme.error,
                                        size: 20,
                                      ),
                                      padding: EdgeInsets.zero,
                                      constraints: const BoxConstraints(),
                                    ),
                                    const SizedBox(height: 6),
                                    Text(
                                      PedidosFormatters.number(
                                        _giftSelection[item.code] ?? 0,
                                      ),
                                      style: const TextStyle(
                                        color: AppTheme.textPrimary,
                                        fontWeight: FontWeight.bold,
                                        fontSize: 12,
                                      ),
                                    ),
                                    const SizedBox(height: 6),
                                    IconButton(
                                      onPressed: () =>
                                          _changeGiftQty(item.code, 1),
                                      icon: const Icon(
                                        Icons.add_circle_outline,
                                        color: AppTheme.success,
                                        size: 20,
                                      ),
                                      padding: EdgeInsets.zero,
                                      constraints: const BoxConstraints(),
                                    ),
                                  ],
                                )
                              : null,
                        ),
                      );
                    },
                  ),
          ),
          if (widget.promoType == 'GIFT' &&
              widget.onAddGift != null &&
              !widget.giftSelectionLocked)
            SafeArea(
              top: false,
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
                child: ElevatedButton.icon(
                  onPressed: _submittingGifts ||
                          _giftSelection.isEmpty ||
                          _eligibleGiftQty <= 0 ||
                          (_eligibleGiftQty > 0 &&
                              _selectedGiftQty > _eligibleGiftQty)
                      ? null
                      : _submitGiftSelection,
                  icon: _submittingGifts
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: AppTheme.inkSurface,
                          ),
                        )
                      : const Icon(Icons.card_giftcard),
                  label: Text(
                    _submittingGifts
                        ? 'Aplicando regalos...'
                        : 'Añadir regalos seleccionados',
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                    ),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.warning,
                    foregroundColor: AppTheme.inkSurface,
                    disabledBackgroundColor: AppTheme.softPanel,
                    disabledForegroundColor: AppTheme.textTertiary,
                    minimumSize: const Size.fromHeight(46),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildProgressSection() {
    final progress = widget.minQty > 0
        ? (_purchasedQty / widget.minQty).clamp(0.0, 1.0)
        : 0.0;
    final cycles = widget.cumulative
        ? (_purchasedQty / widget.minQty).floor()
        : (_purchasedQty >= widget.minQty ? 1 : 0);
    final maxGifts = cycles * widget.giftQty;
    final remaining = widget.minQty - (_purchasedQty % widget.minQty);
    final progressColor =
        _eligibleGiftQty > 0 ? AppTheme.success : AppTheme.info;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(
              'Comprado: ${PedidosFormatters.number(_purchasedQty, decimals: 2)}',
              style: const TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
            const Spacer(),
            Text(
              'Min: ${widget.minQty.toStringAsFixed(0)}',
              style: TextStyle(
                color: _purchasedQty >= widget.minQty
                    ? AppTheme.success
                    : AppTheme.textSecondary,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: progress,
            minHeight: 8,
            backgroundColor: AppTheme.raisedSurface,
            valueColor: AlwaysStoppedAnimation<Color>(progressColor),
          ),
        ),
        const SizedBox(height: 6),
        if (_eligibleGiftQty > 0) ...[
          Row(
            children: [
              const Icon(Icons.check_circle, color: AppTheme.success, size: 14),
              const SizedBox(width: 4),
              Text(
                'Tienes ${maxGifts.toStringAsFixed(0)} regalo(s) disponible(s)',
                style: const TextStyle(
                  color: AppTheme.success,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          if (widget.cumulative && remaining < widget.minQty)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(
                'Faltan ${remaining.toStringAsFixed(0)} uds para otro regalo mas',
                style: TextStyle(
                  color: AppTheme.info.withValues(alpha: 0.8),
                  fontSize: 10,
                ),
              ),
            ),
          const SizedBox(height: 4),
          Text(
            'Seleccionados: ${PedidosFormatters.number(_selectedGiftQty)} / ${PedidosFormatters.number(_eligibleGiftQty)}',
            style: TextStyle(
              color: _selectedGiftQty > _eligibleGiftQty
                  ? AppTheme.error
                  : AppTheme.textSecondary,
              fontSize: 10,
              fontWeight: FontWeight.w600,
            ),
          ),
        ] else ...[
          Row(
            children: [
              const Icon(Icons.info_outline, color: AppTheme.warning, size: 14),
              const SizedBox(width: 4),
              Text(
                'Faltan ${remaining.toStringAsFixed(0)} uds para desbloquear el regalo',
                style: const TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 11,
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }
}
