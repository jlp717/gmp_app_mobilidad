import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../data/pedidos_service.dart';
import '../utils/pedidos_formatters.dart';

class PromotionDetailPage extends StatefulWidget {
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
  final Future<String?> Function(String code, String name, double qty)? onAddGift;
  final bool? Function(String code)? hasStockResolver;
  final double Function(String code)? qtyInOrderResolver;

  const PromotionDetailPage({
    Key? key,
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
    this.onAddGift,
    this.hasStockResolver,
    this.qtyInOrderResolver,
  }) : super(key: key);

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
      _giftSelection.values.fold(0.0, (sum, qty) => sum + qty);

  void _changeGiftQty(String code, double delta) {
    if (widget.promoType == 'GIFT' && _eligibleGiftQty <= 0) {
      return;
    }
    final current = _giftSelection[code] ?? 0;
    double next = (current + delta).clamp(0, 9999).toDouble();
    if (widget.promoType == 'GIFT' && _eligibleGiftQty > 0) {
      final maxForThis = (_eligibleGiftQty - _selectedGiftQty + current);
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
        orElse: () => PromotionItem(code: entry.key, name: entry.key, promoDesc: ''),
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
          backgroundColor: AppTheme.neonGreen,
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
        final hasStock = widget.hasStockResolver?.call(item.code) ?? item.hasStock;
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
    final accent = widget.promoType == 'GIFT'
        ? AppTheme.neonPurple
        : AppTheme.neonGreen;

    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      appBar: AppBar(
        backgroundColor: AppTheme.darkSurface,
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
              borderRadius: BorderRadius.circular(14),
              gradient: LinearGradient(
                colors: [
                  accent.withOpacity(0.18),
                  AppTheme.darkCard,
                ],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              border: Border.all(color: accent.withOpacity(0.4)),
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
                    style: const TextStyle(color: Colors.white70, fontSize: 12),
                  ),
                if (widget.dateFrom.isNotEmpty || widget.dateTo.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      'Vigencia: ${widget.dateFrom.isEmpty ? '-' : widget.dateFrom}  ->  ${widget.dateTo.isEmpty ? '-' : widget.dateTo}',
                      style: const TextStyle(color: Colors.white54, fontSize: 11),
                    ),
                  ),
                if (widget.promoType == 'GIFT') ...[
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      _pill('Compra min.', '${widget.minQty.toStringAsFixed(2)}'),
                      const SizedBox(width: 8),
                      _pill('Regalo', '${widget.giftQty.toStringAsFixed(2)}'),
                      const SizedBox(width: 8),
                      _pill('Modo', widget.cumulative ? 'Acumulable' : 'Unico'),
                    ],
                  ),
                  if (_purchasedQty > 0) ...[
                    const SizedBox(height: 8),
                    Text(
                      'En pedido: ${PedidosFormatters.number(_purchasedQty, decimals: 2)}  ->  Max. regalo: ${PedidosFormatters.number(_eligibleGiftQty, decimals: 2)}',
                      style: TextStyle(
                        color: AppTheme.neonBlue.withOpacity(0.95),
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                  if (_eligibleGiftQty > 0) ...[
                    const SizedBox(height: 4),
                    Text(
                      'Seleccionado: ${PedidosFormatters.number(_selectedGiftQty, decimals: 2)} / ${PedidosFormatters.number(_eligibleGiftQty, decimals: 2)}',
                      style: const TextStyle(
                        color: Colors.white70,
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ] else ...[
                    const SizedBox(height: 4),
                    const Text(
                      'Aun no se cumple la cantidad minima para aplicar regalos.',
                      style: TextStyle(
                        color: Colors.white54,
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ],
              ],
            ),
          ),
          Container(
            margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
            child: TextField(
              onChanged: (v) => setState(() => _search = v.trim()),
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                hintText: 'Buscar articulo en promocion...',
                hintStyle: const TextStyle(color: Colors.white38),
                prefixIcon:
                    const Icon(Icons.search, color: AppTheme.neonBlue, size: 18),
                suffixIcon: IconButton(
                  onPressed: () => setState(() => _onlyWithStock = !_onlyWithStock),
                  icon: Icon(
                    _onlyWithStock ? Icons.inventory_2 : Icons.inventory_2_outlined,
                    color: _onlyWithStock ? AppTheme.neonGreen : Colors.white38,
                    size: 19,
                  ),
                  tooltip: 'Solo con stock',
                ),
                filled: true,
                fillColor: AppTheme.darkCard,
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
                      style: TextStyle(color: Colors.white54),
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                    itemCount: _filteredItems.length,
                    itemBuilder: (context, index) {
                      final item = _filteredItems[index];
                      final hasStock =
                          widget.hasStockResolver?.call(item.code) ?? item.hasStock;
                      final stockColor =
                          hasStock == true ? AppTheme.neonGreen : AppTheme.error;
                      return Card(
                        color: AppTheme.darkCard,
                        margin: const EdgeInsets.only(bottom: 8),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                          side: BorderSide(color: AppTheme.borderColor.withOpacity(0.5)),
                        ),
                        child: ListTile(
                          contentPadding: const EdgeInsets.symmetric(
                              horizontal: 12, vertical: 6),
                          title: Text(
                            item.name,
                            style: const TextStyle(
                              color: Colors.white,
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
                                  color: Colors.white54,
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
                                          color: AppTheme.neonGreen, fontSize: 11),
                                    ),
                                  if (item.promoType == 'GIFT' &&
                                      widget.minQty > 0 &&
                                      widget.giftQty > 0)
                                    Text(
                                      '${widget.minQty.toStringAsFixed(0)}+${widget.giftQty.toStringAsFixed(0)}',
                                      style: const TextStyle(
                                          color: AppTheme.neonPurple,
                                          fontSize: 11,
                                          fontWeight: FontWeight.w700),
                                    ),
                                ],
                              ),
                            ],
                          ),
                          trailing: ElevatedButton(
                            onPressed: () =>
                                widget.onProductTap(item.code, item.name),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppTheme.neonBlue.withOpacity(0.18),
                              foregroundColor: AppTheme.neonBlue,
                              elevation: 0,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(8),
                              ),
                            ),
                            child: const Text(
                              'Seleccionar',
                              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
                            ),
                          ),
                          isThreeLine: widget.promoType == 'GIFT',
                          leading: widget.promoType == 'GIFT'
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
                                          _giftSelection[item.code] ?? 0),
                                      style: const TextStyle(
                                        color: Colors.white,
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
                                        color: AppTheme.neonGreen,
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
          if (widget.promoType == 'GIFT' && widget.onAddGift != null)
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
                            color: AppTheme.darkBase,
                          ),
                        )
                      : const Icon(Icons.card_giftcard),
                  label: Text(
                    _submittingGifts
                        ? 'Aplicando regalos...'
                        : 'Añadir regalos seleccionados',
                    style: const TextStyle(
                        fontWeight: FontWeight.bold, fontSize: 14),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.warning,
                    foregroundColor: AppTheme.darkBase,
                    disabledBackgroundColor: AppTheme.darkCard,
                    disabledForegroundColor: Colors.white38,
                    minimumSize: const Size.fromHeight(46),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _pill(String label, String value) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.06),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppTheme.borderColor.withOpacity(0.5)),
      ),
      child: Text(
        '$label: $value',
        style: const TextStyle(
          color: Colors.white70,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
