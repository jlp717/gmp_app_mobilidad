/// ARTICLES PAGE — Catalogo de articulos con dimensiones
/// Buscar articulos y establecer dimensiones reales para el planificador 3D
library;

import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/warehouse/data/warehouse_data_service.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/widgets/warehouse_ui.dart';

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
  int _searchGeneration = 0;
  CancelToken? _searchCancelToken;
  bool _bulkEstimating = false;
  bool _bulkResetting = false;

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
    _searchCancelToken?.cancel('articles page disposed');
    _searchC.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _search(String q, {bool forceRefresh = false}) async {
    final generation = ++_searchGeneration;
    _searchCancelToken?.cancel('articles search superseded');
    final cancelToken = CancelToken();
    _searchCancelToken = cancelToken;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final arts = await WarehouseDataService.getArticles(
        search: q.isEmpty ? null : q,
        onlyWithDimensions: _onlyWithDims ? true : null,
        forceRefresh: forceRefresh,
        cancelToken: cancelToken,
      );
      if (mounted && generation == _searchGeneration) {
        final filtered =
            _onlyRecent ? arts.where((a) => a.inRecentOrders).toList() : arts;
        setState(() {
          _articles = filtered;
          _totalCount = arts.length;
          _withDimsCount = arts.where((a) => a.hasRealDimensions).length;
          _recentCount = arts.where((a) => a.inRecentOrders).length;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted && generation == _searchGeneration) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
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
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('$estimated articulos estimados automaticamente'),
            backgroundColor: AppTheme.success,
          ),
        );
        _search(_searchC.text, forceRefresh: true);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error: $e'),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _bulkEstimating = false);
    }
  }

  Future<void> _bulkReset() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (dCtx) => AlertDialog(
        backgroundColor: AppTheme.raisedSurface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusLg),
          side: const BorderSide(color: AppTheme.borderColor),
        ),
        title: const Text(
          'RESETEAR TODAS las dimensiones',
          style: TextStyle(
              color: AppTheme.textPrimary,
              fontSize: 15,
              fontWeight: FontWeight.w700),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Esto eliminara TODAS las dimensiones reales guardadas ($_withDimsCount articulos). '
              'Todos los articulos volveran a usar dimensiones estimadas automaticamente.',
              style: const TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Esta accion NO se puede deshacer.',
              style: TextStyle(
                  color: AppTheme.error,
                  fontSize: 12,
                  fontWeight: FontWeight.w700),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dCtx, false),
            child: const Text('CANCELAR',
                style: TextStyle(color: AppTheme.textTertiary)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(dCtx, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.error.withValues(alpha: 0.14),
              foregroundColor: AppTheme.error,
            ),
            child: const Text('RESETEAR TODO',
                style: TextStyle(fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
    if (confirm != true) return;
    setState(() => _bulkResetting = true);
    try {
      final result = await WarehouseDataService.resetAllDimensions();
      if (mounted) {
        final deleted = result['deleted'] ?? 0;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('$deleted dimensiones reales eliminadas'),
            backgroundColor: AppTheme.warning,
          ),
        );
        _search(_searchC.text, forceRefresh: true);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error: $e'),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _bulkResetting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Column(
        children: [
          _buildHeader(),
          _buildStatsRow(),
          _buildSearchBar(),
          Expanded(
            child: _loading && _articles.isEmpty
                ? const Center(
                    child: CircularProgressIndicator(color: AppTheme.info))
                : _error != null
                    ? Center(
                        child: Text(_error!,
                            style:
                                const TextStyle(color: AppTheme.textTertiary)))
                    : _articles.isEmpty
                        ? Center(
                            child: Text(
                              _searchC.text.isEmpty
                                  ? 'Cargando articulos...'
                                  : 'Sin resultados',
                              style: const TextStyle(
                                  color: AppTheme.textTertiary, fontSize: 13),
                            ),
                          )
                        : RefreshIndicator(
                            onRefresh: () =>
                                _search(_searchC.text, forceRefresh: true),
                            color: AppTheme.info,
                            child: ListView.builder(
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 12),
                              itemCount: _articles.length,
                              itemBuilder: (_, i) => _articleCard(_articles[i]),
                            ),
                          ),
          ),
        ],
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: EdgeInsets.fromLTRB(
        Responsive.padding(context, small: 12, large: 16),
        12,
        Responsive.padding(context, small: 12, large: 16),
        4,
      ),
      child: Row(
        children: [
          Container(
            padding:
                EdgeInsets.all(Responsive.padding(context, small: 6, large: 8)),
            decoration: WarehouseUi.surface(
              color: AppTheme.success.withValues(alpha: 0.1),
              borderColor: AppTheme.success,
              borderAlpha: 0.22,
            ),
            child: Icon(
              Icons.inventory_2_rounded,
              color: AppTheme.success,
              size: Responsive.iconSize(context, phone: 18, desktop: 22),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'CATALOGO DE ARTICULOS',
                  style: TextStyle(
                    color: AppTheme.textPrimary,
                    fontSize:
                        Responsive.fontSize(context, small: 13, large: 16),
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0,
                  ),
                ),
                Text(
                  'Dimensiones para el planificador 3D',
                  style: const TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 10,
                  ),
                ),
              ],
            ),
          ),
          if (_withDimsCount > 0)
            _bulkResetting
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: AppTheme.error),
                  )
                : IconButton(
                    icon: const Icon(Icons.delete_sweep_rounded,
                        color: AppTheme.error, size: 20),
                    tooltip: 'Resetear TODAS las dimensiones reales',
                    onPressed: _bulkReset,
                  ),
          if (_bulkEstimating)
            const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(
                  strokeWidth: 2, color: AppTheme.success),
            )
          else
            IconButton(
              icon: const Icon(Icons.auto_fix_high_rounded,
                  color: AppTheme.success, size: 20),
              tooltip: 'Auto-estimar dimensiones',
              onPressed: _bulkEstimate,
            ),
        ],
      ),
    );
  }

  Widget _buildStatsRow() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 2),
      child: Row(
        children: [
          _statBadge('$_totalCount total', AppTheme.mutedPanel),
          const SizedBox(width: 6),
          _statBadge(
            '$_withDimsCount con medidas',
            AppTheme.success.withValues(alpha: 0.3),
          ),
          const SizedBox(width: 6),
          _statBadge(
            '$_recentCount en pedidos',
            AppTheme.info.withValues(alpha: 0.3),
          ),
        ],
      ),
    );
  }

  Widget _statBadge(String text, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        text,
        style: const TextStyle(
          color: AppTheme.textSecondary,
          fontSize: 9,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Widget _buildSearchBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 6),
      child: Column(
        children: [
          TextField(
            controller: _searchC,
            onChanged: _onSearchChanged,
            style: const TextStyle(color: AppTheme.textPrimary, fontSize: 13),
            decoration: InputDecoration(
              hintText: 'Buscar por codigo o nombre...',
              hintStyle: const TextStyle(color: AppTheme.textTertiary),
              prefixIcon: const Icon(Icons.search_rounded,
                  color: AppTheme.textTertiary, size: 20),
              suffixIcon: _searchC.text.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear_rounded,
                          size: 18, color: AppTheme.textTertiary),
                      onPressed: () {
                        _debounce?.cancel();
                        _searchC.clear();
                        _search('');
                      },
                    )
                  : null,
              filled: true,
              fillColor: AppTheme.raisedSurface,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: BorderSide.none,
              ),
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            ),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              FilterChip(
                selected: _onlyWithDims,
                label:
                    const Text('Con medidas', style: TextStyle(fontSize: 10)),
                onSelected: (v) {
                  setState(() => _onlyWithDims = v);
                  _search(_searchC.text, forceRefresh: true);
                },
                selectedColor: AppTheme.success.withValues(alpha: 0.2),
                backgroundColor: AppTheme.raisedSurface,
                checkmarkColor: AppTheme.success,
                labelStyle: TextStyle(
                  color:
                      _onlyWithDims ? AppTheme.success : AppTheme.textTertiary,
                ),
                side: BorderSide(
                  color: _onlyWithDims
                      ? AppTheme.success.withValues(alpha: 0.3)
                      : AppTheme.borderColor,
                ),
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                visualDensity: VisualDensity.compact,
              ),
              const SizedBox(width: 6),
              FilterChip(
                selected: _onlyRecent,
                label: const Text('En pedidos recientes',
                    style: TextStyle(fontSize: 10)),
                onSelected: (v) {
                  setState(() => _onlyRecent = v);
                  _search(_searchC.text);
                },
                selectedColor: AppTheme.info.withValues(alpha: 0.2),
                backgroundColor: AppTheme.raisedSurface,
                checkmarkColor: AppTheme.info,
                labelStyle: TextStyle(
                  color: _onlyRecent ? AppTheme.info : AppTheme.textTertiary,
                ),
                side: BorderSide(
                  color: _onlyRecent
                      ? AppTheme.info.withValues(alpha: 0.3)
                      : AppTheme.borderColor,
                ),
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                visualDensity: VisualDensity.compact,
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _articleCard(ArticleDimension a) {
    final hasReal = a.hasRealDimensions;
    final hasDims = hasReal || (a.estLargoCm != null);
    final dimColor = hasReal
        ? AppTheme.success
        : (hasDims ? AppTheme.warning : AppTheme.textTertiary);

    String dimText;
    if (hasReal) {
      dimText =
          '${a.largoCm?.toStringAsFixed(0)}x${a.anchoCm?.toStringAsFixed(0)}x${a.altoCm?.toStringAsFixed(0)} cm';
    } else if (hasDims) {
      dimText =
          '~${a.estLargoCm?.toStringAsFixed(0)}x${a.estAnchoCm?.toStringAsFixed(0)}x${a.estAltoCm?.toStringAsFixed(0)} cm';
    } else {
      dimText = 'Sin medidas';
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 4),
      decoration: WarehouseUi.surface(
        color: AppTheme.raisedSurface,
        borderColor: dimColor,
        borderAlpha: 0.16,
        boxShadow: AppTheme.elevation1,
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: () => _showEditSheet(a),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            children: [
              Container(
                width: 6,
                height: 44,
                decoration: BoxDecoration(
                  color: dimColor.withValues(alpha: 0.6),
                  borderRadius: BorderRadius.circular(3),
                ),
              ),
              const SizedBox(width: 10),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: AppTheme.info.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(
                    color: AppTheme.info.withValues(alpha: 0.15),
                  ),
                ),
                child: Text(
                  a.code,
                  style: const TextStyle(
                    color: AppTheme.info,
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    fontFamily: 'monospace',
                    letterSpacing: 0,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      a.name.isNotEmpty ? a.name : a.code,
                      style: const TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        _infoChip(
                          '${a.weight.toStringAsFixed(1)} kg/ud',
                          Icons.scale_rounded,
                        ),
                        const SizedBox(width: 6),
                        _infoChip(
                          '${a.unitsPerBox} ud/caja',
                          Icons.all_inbox_rounded,
                        ),
                        if (a.inRecentOrders) ...[
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 4,
                              vertical: 1,
                            ),
                            decoration: BoxDecoration(
                              color: AppTheme.info.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(3),
                            ),
                            child: const Text(
                              'RECIENTE',
                              style: TextStyle(
                                color: AppTheme.info,
                                fontSize: 7,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: dimColor.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      dimText,
                      style: TextStyle(
                        color: dimColor,
                        fontSize: 9,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      hasReal ? 'REAL' : (hasDims ? 'ESTIMADO' : ''),
                      style: TextStyle(
                        color: dimColor.withValues(alpha: 0.6),
                        fontSize: 7,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _infoChip(String text, IconData icon) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 10, color: AppTheme.textTertiary),
        const SizedBox(width: 2),
        Text(
          text,
          style: const TextStyle(
            color: AppTheme.textSecondary,
            fontSize: 10,
          ),
        ),
      ],
    );
  }

  void _showEditSheet(ArticleDimension a) {
    final largoC = TextEditingController(
      text: a.hasRealDimensions ? a.largoCm?.toStringAsFixed(0) ?? '' : '',
    );
    final anchoC = TextEditingController(
      text: a.hasRealDimensions ? a.anchoCm?.toStringAsFixed(0) ?? '' : '',
    );
    final altoC = TextEditingController(
      text: a.hasRealDimensions ? a.altoCm?.toStringAsFixed(0) ?? '' : '',
    );
    final pesoC = TextEditingController(
      text: a.pesoOverrideKg?.toStringAsFixed(1) ?? '',
    );

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.raisedSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(
          Responsive.padding(ctx, small: 14, large: 20),
          16,
          Responsive.padding(ctx, small: 14, large: 20),
          MediaQuery.of(ctx).viewInsets.bottom + 20,
        ),
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(ctx).height * 0.86,
          ),
          child: SingleChildScrollView(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppTheme.textTertiary,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const SizedBox(height: 16),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: AppTheme.info.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: AppTheme.info.withValues(alpha: 0.2),
                    ),
                  ),
                  child: Text(
                    a.code,
                    style: const TextStyle(
                      color: AppTheme.info,
                      fontSize: 14,
                      fontWeight: FontWeight.w800,
                      fontFamily: 'monospace',
                      letterSpacing: 0,
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  a.name.isNotEmpty ? a.name : a.code,
                  style: const TextStyle(
                    color: AppTheme.textPrimary,
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 4),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      '${a.weight.toStringAsFixed(2)} kg/ud',
                      style: const TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 11,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Text(
                      '${a.unitsPerBox} ud/caja',
                      style: const TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
                // Status badge: REAL vs ESTIMADO
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: a.hasRealDimensions
                          ? AppTheme.success.withValues(alpha: 0.12)
                          : (a.estLargoCm != null
                              ? AppTheme.warning.withValues(alpha: 0.12)
                              : AppTheme.softPanel),
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(
                        color: a.hasRealDimensions
                            ? AppTheme.success.withValues(alpha: 0.3)
                            : (a.estLargoCm != null
                                ? AppTheme.warning.withValues(alpha: 0.3)
                                : AppTheme.borderColor),
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          a.hasRealDimensions
                              ? Icons.verified_rounded
                              : Icons.auto_fix_high_rounded,
                          size: 12,
                          color: a.hasRealDimensions
                              ? AppTheme.success
                              : AppTheme.warning,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          a.hasRealDimensions
                              ? 'DIMENSIONES REALES: ${a.largoCm?.toStringAsFixed(0)}x${a.anchoCm?.toStringAsFixed(0)}x${a.altoCm?.toStringAsFixed(0)} cm'
                              : (a.estLargoCm != null
                                  ? 'ESTIMADO: ~${a.estLargoCm?.toStringAsFixed(0)}x${a.estAnchoCm?.toStringAsFixed(0)}x${a.estAltoCm?.toStringAsFixed(0)} cm'
                                  : 'SIN MEDIDAS'),
                          style: TextStyle(
                            color: a.hasRealDimensions
                                ? AppTheme.success
                                : AppTheme.warning,
                            fontSize: 9,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                if (!a.hasRealDimensions && a.estLargoCm != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      'Introduce medidas reales verificadas con cinta metrica',
                      style: const TextStyle(
                        color: AppTheme.textTertiary,
                        fontSize: 10,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(child: _field(largoC, 'Largo (cm)')),
                    const SizedBox(width: 10),
                    Expanded(child: _field(anchoC, 'Ancho (cm)')),
                    const SizedBox(width: 10),
                    Expanded(child: _field(altoC, 'Alto (cm)')),
                  ],
                ),
                const SizedBox(height: 12),
                _field(pesoC, 'Peso por caja (kg) - opcional'),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  height: 44,
                  child: ElevatedButton.icon(
                    onPressed: () async {
                      final largo = double.tryParse(largoC.text);
                      final ancho = double.tryParse(anchoC.text);
                      final alto = double.tryParse(altoC.text);
                      if (largo == null || ancho == null || alto == null) {
                        ScaffoldMessenger.of(ctx).showSnackBar(
                          const SnackBar(
                            content: Text('Introduce las 3 dimensiones'),
                            backgroundColor: AppTheme.warning,
                          ),
                        );
                        return;
                      }
                      // Confirmation dialog
                      final confirm = await showDialog<bool>(
                        context: ctx,
                        builder: (dCtx) => AlertDialog(
                          backgroundColor: AppTheme.raisedSurface,
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(16)),
                          title: const Text(
                            'Confirmar dimensiones REALES',
                            style: TextStyle(
                                color: AppTheme.textPrimary,
                                fontSize: 15,
                                fontWeight: FontWeight.w700),
                          ),
                          content: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                'Estas guardando ${largo.toStringAsFixed(0)} x ${ancho.toStringAsFixed(0)} x ${alto.toStringAsFixed(0)} cm como dimensiones REALES verificadas.',
                                style: const TextStyle(
                                  color: AppTheme.textSecondary,
                                  fontSize: 13,
                                ),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                'Estas medidas se usaran en el planificador 3D. Asegurate de haberlas medido fisicamente.',
                                style: TextStyle(
                                    color:
                                        AppTheme.warning.withValues(alpha: 0.8),
                                    fontSize: 11),
                              ),
                            ],
                          ),
                          actions: [
                            TextButton(
                              onPressed: () => Navigator.pop(dCtx, false),
                              child: const Text('CANCELAR',
                                  style:
                                      TextStyle(color: AppTheme.textTertiary)),
                            ),
                            ElevatedButton(
                              onPressed: () => Navigator.pop(dCtx, true),
                              style: ElevatedButton.styleFrom(
                                backgroundColor:
                                    AppTheme.success.withValues(alpha: 0.2),
                                foregroundColor: AppTheme.success,
                              ),
                              child: const Text('CONFIRMAR',
                                  style:
                                      TextStyle(fontWeight: FontWeight.w700)),
                            ),
                          ],
                        ),
                      );
                      if (confirm != true) return;
                      try {
                        await WarehouseDataService.updateArticleDimensions(
                          code: a.code,
                          largoCm: largo,
                          anchoCm: ancho,
                          altoCm: alto,
                          pesoCajaKg: double.tryParse(pesoC.text),
                        );
                        if (ctx.mounted) Navigator.pop(ctx);
                        _search(_searchC.text, forceRefresh: true);
                      } catch (e) {
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(ctx).showSnackBar(
                            SnackBar(
                              content: Text('Error: $e'),
                              backgroundColor: AppTheme.error,
                            ),
                          );
                        }
                      }
                    },
                    icon: const Icon(Icons.save_rounded, size: 18),
                    label: const Text(
                      'GUARDAR COMO REAL',
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0,
                      ),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.success.withValues(alpha: 0.2),
                      foregroundColor: AppTheme.success,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
                ),
                // Undo button: delete real dimensions
                if (a.hasRealDimensions) ...[
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    height: 40,
                    child: OutlinedButton.icon(
                      onPressed: () async {
                        final confirm = await showDialog<bool>(
                          context: ctx,
                          builder: (dCtx) => AlertDialog(
                            backgroundColor: AppTheme.raisedSurface,
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(16)),
                            title: const Text(
                              'Eliminar dimensiones reales',
                              style: TextStyle(
                                  color: AppTheme.textPrimary,
                                  fontSize: 15,
                                  fontWeight: FontWeight.w700),
                            ),
                            content: Text(
                              'Se eliminaran las dimensiones reales guardadas y el articulo volvera a usar dimensiones estimadas automaticamente.',
                              style: const TextStyle(
                                color: AppTheme.textSecondary,
                                fontSize: 13,
                              ),
                            ),
                            actions: [
                              TextButton(
                                onPressed: () => Navigator.pop(dCtx, false),
                                child: const Text('CANCELAR',
                                    style: TextStyle(
                                        color: AppTheme.textTertiary)),
                              ),
                              ElevatedButton(
                                onPressed: () => Navigator.pop(dCtx, true),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor:
                                      AppTheme.error.withValues(alpha: 0.2),
                                  foregroundColor: AppTheme.error,
                                ),
                                child: const Text('ELIMINAR',
                                    style:
                                        TextStyle(fontWeight: FontWeight.w700)),
                              ),
                            ],
                          ),
                        );
                        if (confirm != true) return;
                        try {
                          await WarehouseDataService.deleteArticleDimensions(
                              a.code);
                          if (ctx.mounted) Navigator.pop(ctx);
                          _search(_searchC.text, forceRefresh: true);
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text(
                                    'Dimensiones reales eliminadas, vuelve a estimado'),
                                backgroundColor: AppTheme.warning,
                              ),
                            );
                          }
                        } catch (e) {
                          if (ctx.mounted) {
                            ScaffoldMessenger.of(ctx).showSnackBar(
                              SnackBar(
                                content: Text('Error: $e'),
                                backgroundColor: AppTheme.error,
                              ),
                            );
                          }
                        }
                      },
                      icon: const Icon(Icons.undo_rounded, size: 16),
                      label: const Text(
                        'VOLVER A ESTIMADO',
                        style: TextStyle(
                            fontWeight: FontWeight.w600, fontSize: 12),
                      ),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppTheme.error,
                        side: BorderSide(
                            color: AppTheme.error.withValues(alpha: 0.3)),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _field(TextEditingController c, String label) {
    return TextField(
      controller: c,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      style: const TextStyle(color: AppTheme.textPrimary, fontSize: 14),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: TextStyle(
          color: AppTheme.textSecondary,
          fontSize: 11,
        ),
        filled: true,
        fillColor: AppTheme.softPanel,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide.none,
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 12,
          vertical: 10,
        ),
      ),
    );
  }
}
