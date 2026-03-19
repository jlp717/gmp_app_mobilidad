/// ARTICLES PAGE — Catalogo de articulos con dimensiones
/// Buscar articulos y establecer dimensiones reales para el planificador 3D

import 'dart:async';
import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../data/warehouse_data_service.dart';

class ArticlesPage extends StatefulWidget {
  const ArticlesPage({super.key});

  @override
  State<ArticlesPage> createState() => _ArticlesPageState();
}

class _ArticlesPageState extends State<ArticlesPage> {
  List<ArticleDimension> _articles = [];
  bool _loading = false;
  bool _onlyWithDims = false;
  bool _onlyRecent = false;
  String? _error;
  final _searchC = TextEditingController();
  Timer? _debounce;
  bool _bulkEstimating = false;

  int _totalCount = 0;
  int _withDimsCount = 0;
  int _recentCount = 0;

  @override
  void initState() {
    super.initState();
    _search('');
  }

  @override
  void dispose() {
    _searchC.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _search(String q) async {
    setState(() { _loading = true; _error = null; });
    try {
      final arts = await WarehouseDataService.getArticles(
        search: q.isEmpty ? null : q,
        onlyWithDimensions: _onlyWithDims ? true : null,
        limit: 200,
      );
      if (mounted) {
        final filtered = _onlyRecent
            ? arts.where((a) => a.inRecentOrders).toList()
            : arts;
        setState(() {
          _articles = filtered;
          _totalCount = arts.length;
          _withDimsCount = arts.where((a) => a.hasRealDimensions).length;
          _recentCount = arts.where((a) => a.inRecentOrders).length;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  void _onSearchChanged(String q) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () => _search(q));
  }

  Future<void> _bulkEstimate() async {
    setState(() => _bulkEstimating = true);
    try {
      final result = await WarehouseDataService.bulkEstimateDimensions();
      if (mounted) {
        final estimated = result['estimated'] ?? 0;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('$estimated articulos estimados automaticamente'),
          backgroundColor: AppTheme.neonGreen,
        ));
        _search(_searchC.text);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('Error: $e'), backgroundColor: Colors.redAccent,
        ));
      }
    } finally {
      if (mounted) setState(() => _bulkEstimating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Column(children: [
        _buildHeader(),
        _buildStatsRow(),
        _buildSearchBar(),
        Expanded(child: _loading
            ? const Center(child: CircularProgressIndicator(color: AppTheme.neonBlue))
            : _error != null
                ? Center(child: Text(_error!, style: const TextStyle(color: Colors.white54)))
                : _articles.isEmpty
                    ? Center(child: Text(
                        _searchC.text.isEmpty ? 'Cargando articulos...' : 'Sin resultados',
                        style: const TextStyle(color: Colors.white30, fontSize: 13)))
                    : RefreshIndicator(
                        onRefresh: () => _search(_searchC.text),
                        color: AppTheme.neonBlue,
                        child: ListView.builder(
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          itemCount: _articles.length,
                          itemBuilder: (_, i) => _articleCard(_articles[i]),
                        ),
                      )),
      ]),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: EdgeInsets.fromLTRB(
          Responsive.padding(context, small: 12, large: 16), 12,
          Responsive.padding(context, small: 12, large: 16), 4),
      child: Row(children: [
        Container(
          padding: EdgeInsets.all(Responsive.padding(context, small: 6, large: 8)),
          decoration: BoxDecoration(
            color: AppTheme.neonGreen.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(10)),
          child: Icon(Icons.inventory_2_rounded, color: AppTheme.neonGreen,
              size: Responsive.iconSize(context, phone: 18, desktop: 22)),
        ),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('CATALOGO DE ARTICULOS', style: TextStyle(
              color: Colors.white,
              fontSize: Responsive.fontSize(context, small: 13, large: 16),
              fontWeight: FontWeight.w800, letterSpacing: 1)),
          Text('Dimensiones para el planificador 3D',
              style: TextStyle(color: Colors.white.withValues(alpha: 0.4), fontSize: 10)),
        ])),
        _bulkEstimating
          ? const SizedBox(width: 20, height: 20,
              child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.neonGreen))
          : IconButton(
              icon: const Icon(Icons.auto_fix_high_rounded, color: AppTheme.neonGreen, size: 20),
              tooltip: 'Auto-estimar dimensiones',
              onPressed: _bulkEstimate,
            ),
      ]),
    );
  }

  Widget _buildStatsRow() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 2),
      child: Row(children: [
        _statBadge('$_totalCount total', Colors.white24),
        const SizedBox(width: 6),
        _statBadge('$_withDimsCount con medidas',
            AppTheme.neonGreen.withValues(alpha: 0.3)),
        const SizedBox(width: 6),
        _statBadge('$_recentCount en pedidos',
            AppTheme.neonBlue.withValues(alpha: 0.3)),
      ]),
    );
  }

  Widget _statBadge(String text, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
          color: color, borderRadius: BorderRadius.circular(6)),
      child: Text(text,
          style: const TextStyle(
              color: Colors.white70, fontSize: 9, fontWeight: FontWeight.w600)),
    );
  }

  Widget _buildSearchBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 6),
      child: Column(children: [
        TextField(
          controller: _searchC,
          onChanged: _onSearchChanged,
          style: const TextStyle(color: Colors.white, fontSize: 13),
          decoration: InputDecoration(
            hintText: 'Buscar por codigo o nombre...',
            hintStyle: TextStyle(color: Colors.white.withValues(alpha: 0.25)),
            prefixIcon: const Icon(Icons.search_rounded, color: Colors.white30, size: 20),
            suffixIcon: _searchC.text.isNotEmpty
                ? IconButton(
                    icon: const Icon(Icons.clear_rounded, size: 18, color: Colors.white30),
                    onPressed: () { _searchC.clear(); _search(''); })
                : null,
            filled: true, fillColor: AppTheme.darkCard,
            border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: BorderSide.none),
            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          ),
        ),
        const SizedBox(height: 6),
        Row(children: [
          FilterChip(
            selected: _onlyWithDims,
            label: const Text('Con medidas', style: TextStyle(fontSize: 10)),
            onSelected: (v) {
              setState(() => _onlyWithDims = v);
              _search(_searchC.text);
            },
            selectedColor: AppTheme.neonGreen.withValues(alpha: 0.2),
            backgroundColor: AppTheme.darkCard,
            checkmarkColor: AppTheme.neonGreen,
            labelStyle: TextStyle(
                color: _onlyWithDims ? AppTheme.neonGreen : Colors.white38),
            side: BorderSide(
                color: _onlyWithDims
                    ? AppTheme.neonGreen.withValues(alpha: 0.3)
                    : Colors.transparent),
            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            visualDensity: VisualDensity.compact,
          ),
          const SizedBox(width: 6),
          FilterChip(
            selected: _onlyRecent,
            label: const Text('En pedidos recientes', style: TextStyle(fontSize: 10)),
            onSelected: (v) {
              setState(() => _onlyRecent = v);
              _search(_searchC.text);
            },
            selectedColor: AppTheme.neonBlue.withValues(alpha: 0.2),
            backgroundColor: AppTheme.darkCard,
            checkmarkColor: AppTheme.neonBlue,
            labelStyle: TextStyle(
                color: _onlyRecent ? AppTheme.neonBlue : Colors.white38),
            side: BorderSide(
                color: _onlyRecent
                    ? AppTheme.neonBlue.withValues(alpha: 0.3)
                    : Colors.transparent),
            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            visualDensity: VisualDensity.compact,
          ),
        ]),
      ]),
    );
  }

  Widget _articleCard(ArticleDimension a) {
    final hasReal = a.hasRealDimensions;
    final hasDims = hasReal || (a.estLargoCm != null);
    final dimColor = hasReal
        ? AppTheme.neonGreen
        : (hasDims ? Colors.amber : Colors.white24);

    String dimText;
    if (hasReal) {
      dimText = '${a.largoCm?.toStringAsFixed(0)}x${a.anchoCm?.toStringAsFixed(0)}x${a.altoCm?.toStringAsFixed(0)} cm';
    } else if (hasDims) {
      dimText = '~${a.estLargoCm?.toStringAsFixed(0)}x${a.estAnchoCm?.toStringAsFixed(0)}x${a.estAltoCm?.toStringAsFixed(0)} cm';
    } else {
      dimText = 'Sin medidas';
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 4),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: dimColor.withValues(alpha: 0.08))),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: () => _showEditSheet(a),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(children: [
            Container(
              width: 6, height: 44,
              decoration: BoxDecoration(
                color: dimColor.withValues(alpha: 0.6),
                borderRadius: BorderRadius.circular(3)),
            ),
            const SizedBox(width: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: AppTheme.neonBlue.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(
                    color: AppTheme.neonBlue.withValues(alpha: 0.15))),
              child: Text(a.code,
                  style: const TextStyle(
                    color: AppTheme.neonBlue, fontSize: 11,
                    fontWeight: FontWeight.w800, fontFamily: 'monospace',
                    letterSpacing: 0.5)),
            ),
            const SizedBox(width: 10),
            Expanded(child: Column(
                crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(a.name.isNotEmpty ? a.name : a.code,
                  style: const TextStyle(
                      color: Colors.white, fontSize: 12,
                      fontWeight: FontWeight.w600),
                  maxLines: 1, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 2),
              Row(children: [
                _infoChip('${a.weight.toStringAsFixed(1)} kg/ud',
                    Icons.scale_rounded),
                const SizedBox(width: 6),
                _infoChip('${a.unitsPerBox} ud/caja',
                    Icons.all_inbox_rounded),
                if (a.inRecentOrders) ...[
                  const SizedBox(width: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 4, vertical: 1),
                    decoration: BoxDecoration(
                      color: AppTheme.neonBlue.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(3)),
                    child: const Text('RECIENTE',
                        style: TextStyle(
                            color: AppTheme.neonBlue, fontSize: 7,
                            fontWeight: FontWeight.w800)),
                  ),
                ],
              ]),
            ])),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: dimColor.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(6)),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Text(dimText, style: TextStyle(
                    color: dimColor, fontSize: 9, fontWeight: FontWeight.w700)),
                Text(hasReal ? 'REAL' : (hasDims ? 'ESTIMADO' : ''),
                    style: TextStyle(
                        color: dimColor.withValues(alpha: 0.6),
                        fontSize: 7, fontWeight: FontWeight.w800)),
              ]),
            ),
          ]),
        ),
      ),
    );
  }

  Widget _infoChip(String text, IconData icon) {
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Icon(icon, size: 10, color: Colors.white24),
      const SizedBox(width: 2),
      Text(text, style: TextStyle(
          color: Colors.white.withValues(alpha: 0.4), fontSize: 10)),
    ]);
  }

  void _showEditSheet(ArticleDimension a) {
    final largoC = TextEditingController(
        text: a.largoCm?.toStringAsFixed(0) ??
            a.estLargoCm?.toStringAsFixed(0) ?? '');
    final anchoC = TextEditingController(
        text: a.anchoCm?.toStringAsFixed(0) ??
            a.estAnchoCm?.toStringAsFixed(0) ?? '');
    final altoC = TextEditingController(
        text: a.altoCm?.toStringAsFixed(0) ??
            a.estAltoCm?.toStringAsFixed(0) ?? '');
    final pesoC = TextEditingController(
        text: a.pesoOverrideKg?.toStringAsFixed(1) ?? '');

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.darkCard,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(
            Responsive.padding(ctx, small: 14, large: 20), 16,
            Responsive.padding(ctx, small: 14, large: 20),
            MediaQuery.of(ctx).viewInsets.bottom + 20),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(width: 40, height: 4, decoration: BoxDecoration(
              color: Colors.white24, borderRadius: BorderRadius.circular(2))),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: AppTheme.neonBlue.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                  color: AppTheme.neonBlue.withValues(alpha: 0.2))),
            child: Text(a.code,
                style: const TextStyle(
                    color: AppTheme.neonBlue, fontSize: 14,
                    fontWeight: FontWeight.w800, fontFamily: 'monospace',
                    letterSpacing: 1)),
          ),
          const SizedBox(height: 8),
          Text(a.name.isNotEmpty ? a.name : a.code,
              style: const TextStyle(
                  color: Colors.white, fontSize: 15,
                  fontWeight: FontWeight.w700),
              maxLines: 2, overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center),
          const SizedBox(height: 4),
          Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            Text('${a.weight.toStringAsFixed(2)} kg/ud',
                style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.4),
                    fontSize: 11)),
            const SizedBox(width: 12),
            Text('${a.unitsPerBox} ud/caja',
                style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.4),
                    fontSize: 11)),
          ]),
          if (!a.hasRealDimensions && a.estLargoCm != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                  'Dimensiones estimadas pre-rellenadas (verificar)',
                  style: TextStyle(
                      color: Colors.amber.withValues(alpha: 0.6),
                      fontSize: 10),
                  textAlign: TextAlign.center),
            ),
          const SizedBox(height: 20),
          Row(children: [
            Expanded(child: _field(largoC, 'Largo (cm)')),
            const SizedBox(width: 10),
            Expanded(child: _field(anchoC, 'Ancho (cm)')),
            const SizedBox(width: 10),
            Expanded(child: _field(altoC, 'Alto (cm)')),
          ]),
          const SizedBox(height: 12),
          _field(pesoC, 'Peso por caja (kg) - opcional'),
          const SizedBox(height: 20),
          SizedBox(width: double.infinity, height: 44,
              child: ElevatedButton.icon(
            onPressed: () async {
              final largo = double.tryParse(largoC.text);
              final ancho = double.tryParse(anchoC.text);
              final alto = double.tryParse(altoC.text);
              if (largo == null || ancho == null || alto == null) {
                ScaffoldMessenger.of(ctx).showSnackBar(const SnackBar(
                    content: Text('Introduce las 3 dimensiones'),
                    backgroundColor: Colors.amber));
                return;
              }
              try {
                await WarehouseDataService.updateArticleDimensions(
                  code: a.code, largoCm: largo, anchoCm: ancho, altoCm: alto,
                  pesoCajaKg: double.tryParse(pesoC.text),
                );
                if (ctx.mounted) Navigator.pop(ctx);
                _search(_searchC.text);
              } catch (e) {
                if (ctx.mounted) {
                  ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(
                      content: Text('Error: $e'),
                      backgroundColor: Colors.redAccent));
                }
              }
            },
            icon: const Icon(Icons.save_rounded, size: 18),
            label: const Text('GUARDAR DIMENSIONES',
                style: TextStyle(
                    fontWeight: FontWeight.w700, letterSpacing: 0.5)),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.neonGreen.withValues(alpha: 0.2),
              foregroundColor: AppTheme.neonGreen,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10))),
          )),
        ]),
      ),
    );
  }

  Widget _field(TextEditingController c, String label) {
    return TextField(
      controller: c,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      style: const TextStyle(color: Colors.white, fontSize: 14),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: TextStyle(
            color: Colors.white.withValues(alpha: 0.4), fontSize: 11),
        filled: true, fillColor: AppTheme.darkBase,
        border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: BorderSide.none),
        contentPadding: const EdgeInsets.symmetric(
            horizontal: 12, vertical: 10),
      ),
    );
  }
}
