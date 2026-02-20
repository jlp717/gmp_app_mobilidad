/// ARTICLES PAGE — Gestión de dimensiones de artículos
/// Buscar artículos y establecer dimensiones reales para el planificador 3D

import 'dart:async';
import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
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
  String? _error;
  final _searchC = TextEditingController();
  Timer? _debounce;

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
        limit: 60,
      );
      if (mounted) setState(() { _articles = arts; _loading = false; });
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  void _onSearchChanged(String q) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () => _search(q));
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Column(children: [
        _buildHeader(),
        _buildSearchBar(),
        Expanded(child: _loading
            ? const Center(child: CircularProgressIndicator(color: AppTheme.neonBlue))
            : _error != null
                ? Center(child: Text(_error!, style: const TextStyle(color: Colors.white54)))
                : _articles.isEmpty
                    ? Center(child: Text(
                        _searchC.text.isEmpty ? 'Busca un articulo por codigo o nombre' : 'Sin resultados',
                        style: const TextStyle(color: Colors.white30, fontSize: 13)))
                    : ListView.builder(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        itemCount: _articles.length,
                        itemBuilder: (_, i) => _articleCard(_articles[i]),
                      )),
      ]),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Row(children: [
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: AppTheme.neonGreen.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(10)),
          child: const Icon(Icons.inventory_2_rounded, color: AppTheme.neonGreen, size: 22),
        ),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('DIMENSIONES ARTICULOS', style: TextStyle(
              color: Colors.white, fontSize: 16, fontWeight: FontWeight.w800, letterSpacing: 1)),
          Text('Configura tamaños reales para el planificador 3D',
              style: TextStyle(color: Colors.white.withValues(alpha: 0.4), fontSize: 10)),
        ])),
      ]),
    );
  }

  Widget _buildSearchBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 6),
      child: Row(children: [
        Expanded(child: TextField(
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
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          ),
        )),
        const SizedBox(width: 8),
        FilterChip(
          selected: _onlyWithDims,
          label: const Text('Con medidas', style: TextStyle(fontSize: 10)),
          onSelected: (v) { setState(() => _onlyWithDims = v); _search(_searchC.text); },
          selectedColor: AppTheme.neonGreen.withValues(alpha: 0.2),
          backgroundColor: AppTheme.darkCard,
          checkmarkColor: AppTheme.neonGreen,
          labelStyle: TextStyle(color: _onlyWithDims ? AppTheme.neonGreen : Colors.white38),
          side: BorderSide(color: _onlyWithDims ? AppTheme.neonGreen.withValues(alpha: 0.3) : Colors.transparent),
        ),
      ]),
    );
  }

  Widget _articleCard(ArticleDimension a) {
    final hasReal = a.hasRealDimensions;
    final dimColor = hasReal ? AppTheme.neonGreen : Colors.amber;
    final dimText = hasReal
        ? '${a.largoCm?.toStringAsFixed(0)}x${a.anchoCm?.toStringAsFixed(0)}x${a.altoCm?.toStringAsFixed(0)} cm'
        : 'Estimado';

    return Container(
      margin: const EdgeInsets.only(bottom: 4),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: dimColor.withValues(alpha: 0.06))),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: () => _showEditSheet(a),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(children: [
            // Status indicator
            Container(
              width: 6, height: 36,
              decoration: BoxDecoration(
                color: dimColor.withValues(alpha: 0.6),
                borderRadius: BorderRadius.circular(3)),
            ),
            const SizedBox(width: 10),
            // Article info
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(a.name.isNotEmpty ? a.name : a.code,
                  style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
                  maxLines: 1, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 2),
              Row(children: [
                Text(a.code, style: TextStyle(color: Colors.white.withValues(alpha: 0.3), fontSize: 10)),
                const SizedBox(width: 8),
                Text('${a.weight.toStringAsFixed(2)} kg/ud', style: TextStyle(color: Colors.white.withValues(alpha: 0.3), fontSize: 10)),
                const SizedBox(width: 8),
                Text('${a.unitsPerBox} ud/caja', style: TextStyle(color: Colors.white.withValues(alpha: 0.3), fontSize: 10)),
              ]),
            ])),
            // Dimensions badge
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: dimColor.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(6)),
              child: Text(dimText, style: TextStyle(color: dimColor, fontSize: 10, fontWeight: FontWeight.w700)),
            ),
          ]),
        ),
      ),
    );
  }

  void _showEditSheet(ArticleDimension a) {
    final largoC = TextEditingController(text: a.largoCm?.toStringAsFixed(0) ?? '');
    final anchoC = TextEditingController(text: a.anchoCm?.toStringAsFixed(0) ?? '');
    final altoC = TextEditingController(text: a.altoCm?.toStringAsFixed(0) ?? '');
    final pesoC = TextEditingController(text: a.pesoOverrideKg?.toStringAsFixed(1) ?? '');

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.darkCard,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(20, 16, 20, MediaQuery.of(ctx).viewInsets.bottom + 20),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(width: 40, height: 4, decoration: BoxDecoration(
              color: Colors.white24, borderRadius: BorderRadius.circular(2))),
          const SizedBox(height: 16),
          Text(a.name.isNotEmpty ? a.name : a.code,
              style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w700),
              maxLines: 2, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center),
          Text('Codigo: ${a.code}  ·  Peso: ${a.weight.toStringAsFixed(2)} kg/ud',
              style: TextStyle(color: Colors.white.withValues(alpha: 0.4), fontSize: 11)),
          const SizedBox(height: 20),
          Row(children: [
            Expanded(child: _field(largoC, 'Largo (cm)')),
            const SizedBox(width: 10),
            Expanded(child: _field(anchoC, 'Ancho (cm)')),
            const SizedBox(width: 10),
            Expanded(child: _field(altoC, 'Alto (cm)')),
          ]),
          const SizedBox(height: 12),
          _field(pesoC, 'Peso por caja (kg) — opcional'),
          const SizedBox(height: 20),
          SizedBox(width: double.infinity, height: 44, child: ElevatedButton.icon(
            onPressed: () async {
              final largo = double.tryParse(largoC.text);
              final ancho = double.tryParse(anchoC.text);
              final alto = double.tryParse(altoC.text);
              if (largo == null || ancho == null || alto == null) {
                ScaffoldMessenger.of(ctx).showSnackBar(const SnackBar(
                    content: Text('Introduce las 3 dimensiones'), backgroundColor: Colors.amber));
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
                  ScaffoldMessenger.of(ctx).showSnackBar(
                    SnackBar(content: Text('Error: $e'), backgroundColor: Colors.redAccent));
                }
              }
            },
            icon: const Icon(Icons.save_rounded, size: 18),
            label: const Text('GUARDAR DIMENSIONES', style: TextStyle(fontWeight: FontWeight.w700, letterSpacing: 0.5)),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.neonGreen.withValues(alpha: 0.2),
              foregroundColor: AppTheme.neonGreen,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
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
        labelStyle: TextStyle(color: Colors.white.withValues(alpha: 0.4), fontSize: 11),
        filled: true, fillColor: AppTheme.darkBase,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      ),
    );
  }
}
