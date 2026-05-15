import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/providers/filter_provider.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';

class GlobalVendorSelector extends ConsumerStatefulWidget {
  const GlobalVendorSelector({
    required this.isJefeVentas,
    super.key,
    this.onChanged,
    this.allowedVendorCodes,
    this.includeAllOption = true,
    this.defaultVendorCode,
    this.forceShow = false,
  });
  final bool isJefeVentas;
  final VoidCallback? onChanged;
  final List<String>? allowedVendorCodes;
  final bool includeAllOption;
  final String? defaultVendorCode;
  final bool forceShow;

  @override
  ConsumerState<GlobalVendorSelector> createState() =>
      _GlobalVendorSelectorState();
}

class _GlobalVendorSelectorState extends ConsumerState<GlobalVendorSelector> {
  List<Map<String, dynamic>> _vendedores = [];
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    if (widget.isJefeVentas || widget.forceShow) {
      _loadVendedores();
    }
  }

  Future<void> _loadVendedores() async {
    if (!mounted) return;
    setState(() => _isLoading = true);
    try {
      final response = await ApiClient.get(
        '/rutero/vendedores',
        cacheKey: 'vendedores_list',
        cacheTTL: const Duration(minutes: 30),
      );

      if (mounted) {
        setState(() {
          final rawList = response['vendedores'] ?? [];
          _vendedores = (rawList as List)
              .map((item) => Map<String, dynamic>.from(item as Map))
              .where((v) {
            final code = v['code']?.toString() ?? '';
            final name = v['name']?.toString() ?? '';
            if (code.isEmpty) return false;
            if (name.toUpperCase().startsWith('ZZ')) return false;
            final allowedCodes = widget.allowedVendorCodes;
            if (allowedCodes != null &&
                allowedCodes.isNotEmpty &&
                !allowedCodes.contains(code)) {
              return false;
            }
            return true;
          }).toList();
          _vendedores.sort((a, b) {
            final codeA = a['code']?.toString() ?? '';
            final codeB = b['code']?.toString() ?? '';
            return codeA.compareTo(codeB);
          });
          _isLoading = false;
        });
        _ensureValidSelection();
      }
    } catch (e) {
      debugPrint('Error loading vendedores: $e');
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _ensureValidSelection() {
    if (widget.includeAllOption) return;
    if (_vendedores.isEmpty) return;

    final selectedVendor = ref.read(filterProvider).selectedVendor;
    final hasValidSelection = selectedVendor != null &&
        _vendedores.any((v) => v['code']?.toString() == selectedVendor);
    if (hasValidSelection) return;

    final defaultCode = widget.defaultVendorCode;
    final fallback = defaultCode != null &&
            _vendedores.any((v) => v['code']?.toString() == defaultCode)
        ? defaultCode
        : _vendedores.first['code']?.toString();

    if (fallback != null && fallback.isNotEmpty) {
      ref.read(filterProvider.notifier).setVendor(fallback);
      if (widget.onChanged != null) widget.onChanged!();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.isJefeVentas && !widget.forceShow) return const SizedBox.shrink();

    final shouldLoadVendors = widget.isJefeVentas || widget.forceShow;
    if (shouldLoadVendors && _vendedores.isEmpty && !_isLoading) {
      _loadVendedores();
    }

    final filterState = ref.watch(filterProvider);
    final selectedVendor = filterState.selectedVendor;

    final isValidSelection = selectedVendor == null ||
        _vendedores.any((v) => v['code'].toString() == selectedVendor);

    final currentValue = isValidSelection ? selectedVendor : null;
    final isCompact = Responsive.isLandscapeCompact(context);

    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: 12,
        vertical: isCompact ? 2 : 8,
      ),
      color: AppTheme.surfaceColor,
      child: Row(
        children: [
          const Icon(Icons.visibility, color: AppTheme.neonBlue, size: 18),
          const SizedBox(width: 8),
          const Text(
            'Ver como:',
            style: TextStyle(fontSize: 12, color: Colors.white70),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Container(
              height: 36 * Responsive.landscapeScale(context),
              padding: const EdgeInsets.symmetric(horizontal: 10),
              decoration: BoxDecoration(
                color: AppTheme.darkSurface,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: AppTheme.neonBlue.withValues(alpha: 0.3),
                ),
              ),
              child: _isLoading
                  ? const Center(
                      child: SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: AppTheme.neonBlue,
                        ),
                      ),
                    )
                  : DropdownButtonHideUnderline(
                      child: DropdownButton<String>(
                        value: currentValue,
                        isExpanded: true,
                        isDense: true,
                        dropdownColor: AppTheme.darkCard,
                        icon: const Icon(
                          Icons.arrow_drop_down,
                          color: AppTheme.neonBlue,
                          size: 20,
                        ),
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 13,
                        ),
                        hint: Text(
                          widget.includeAllOption
                              ? 'Todos los comerciales'
                              : 'Selecciona comercial',
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 13,
                          ),
                        ),
                        items: [
                          if (widget.includeAllOption)
                            const DropdownMenuItem<String>(
                              child: Text(
                                'Todos los comerciales',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                          ..._vendedores.map((v) {
                            final code = v['code']?.toString() ?? '';
                            final name = v['name']?.toString() ?? '';
                            final displayName = name.isNotEmpty
                                ? '$code - $name'
                                : 'Vendedor $code';
                            return DropdownMenuItem<String>(
                              value: code,
                              child: Text(
                                displayName,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 12,
                                ),
                              ),
                            );
                          }),
                        ],
                        onChanged: (value) {
                          ref.read(filterProvider.notifier).setVendor(value);
                          if (widget.onChanged != null) widget.onChanged!();
                        },
                      ),
                    ),
            ),
          ),
        ],
      ),
    );
  }
}
