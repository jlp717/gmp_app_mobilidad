import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/providers/filter_provider.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';

/// Global Vendor Selector — V2 Premium.
/// Modern dropdown with refined styling and subtle interactions.
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
        (widget.includeAllOption && selectedVendor == 'ALL') ||
        _vendedores.any((v) => v['code'].toString() == selectedVendor);

    final currentValue = isValidSelection ? selectedVendor : null;
    final isCompact = Responsive.isLandscapeCompact(context);

    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: 12,
        vertical: isCompact ? 2 : 8,
      ),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppTheme.darkCard,
            AppTheme.darkSurface.withValues(alpha: 0.9),
          ],
        ),
        border: Border(
          bottom: BorderSide(color: AppTheme.neonBlue.withValues(alpha: 0.1)),
        ),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: AppTheme.neonBlue.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(AppTheme.radiusSm),
            ),
            child: const Icon(Icons.visibility_rounded, color: AppTheme.neonBlue, size: 16),
          ),
          const SizedBox(width: 8),
          const Text(
            'Ver como:',
            style: TextStyle(fontSize: 12, color: Colors.white60, fontWeight: FontWeight.w500),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Container(
              height: 36 * Responsive.landscapeScale(context),
              padding: const EdgeInsets.symmetric(horizontal: 10),
              decoration: BoxDecoration(
                color: AppTheme.darkSurface.withValues(alpha: 0.6),
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                border: Border.all(
                  color: AppTheme.neonBlue.withValues(alpha: 0.2),
                  width: 1,
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
                          Icons.arrow_drop_down_rounded,
                          color: AppTheme.neonBlue,
                          size: 20,
                        ),
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                        ),
                        hint: Text(
                          widget.includeAllOption
                              ? 'Todos los comerciales'
                              : 'Selecciona comercial',
                          style: const TextStyle(
                            color: Colors.white60,
                            fontWeight: FontWeight.w500,
                            fontSize: 13,
                          ),
                        ),
                        items: [
                          if (widget.includeAllOption)
                            const DropdownMenuItem<String>(
                              value: 'ALL',
                              child: Text(
                                'Todos los comerciales',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w600,
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
