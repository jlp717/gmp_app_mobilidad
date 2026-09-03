import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/providers/filter_provider.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/utils/vendor_scope.dart';

/// Global vendor selector used in scoped sales views.
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

  List<String>? _effectiveAllowedCodes() {
    final authState = ref.read(authProvider).value;
    return effectiveAllowedVendorCodes(
      userCode: authState?.user?.code,
      authVendorCodes: authState?.vendedorCodes ?? const <String>[],
      explicitAllowedCodes: widget.allowedVendorCodes,
    );
  }

  bool get _isScopedCommercial {
    final authState = ref.read(authProvider).value;
    return hasScopedVendorAccess(
      userCode: authState?.user?.code,
      vendorCodes: authState?.vendedorCodes ?? const <String>[],
    );
  }

  String get _allOptionLabel =>
      _isScopedCommercial ? 'Equipo autorizado' : 'Todos los comerciales';

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
      final authState = ref.read(authProvider).value;
      final allowedCodes = _effectiveAllowedCodes();
      final scopeKey = allowedCodes == null || allowedCodes.isEmpty
          ? 'all'
          : allowedCodes.map(normalizeVendorCode).join('_');
      final response = await ApiClient.get(
        '/rutero/vendedores',
        cacheKey:
            'vendedores_list_${authState?.user?.code ?? 'anon'}_$scopeKey',
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
            if (allowedCodes != null &&
                allowedCodes.isNotEmpty &&
                !vendorCodeListContains(allowedCodes, code)) {
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
    if (_vendedores.isEmpty) return;

    final selectedVendor = ref.read(filterProvider).selectedVendor;
    if (widget.includeAllOption &&
        (selectedVendor == null || selectedVendor == 'ALL')) {
      return;
    }

    final hasValidSelection = selectedVendor != null &&
        _vendedores.any(
          (v) => vendorCodeListContains(
            <String>[v['code']?.toString() ?? ''],
            selectedVendor,
          ),
        );
    if (hasValidSelection) return;

    final defaultCode = widget.defaultVendorCode;
    final fallback = widget.includeAllOption
        ? 'ALL'
        : defaultCode != null &&
                _vendedores.any(
                  (v) => vendorCodeListContains(
                    <String>[v['code']?.toString() ?? ''],
                    defaultCode,
                  ),
                )
            ? defaultCode
            : _vendedores.first['code']?.toString();

    if (fallback != null && fallback.isNotEmpty) {
      ref.read(filterProvider.notifier).setVendor(fallback);
      widget.onChanged?.call();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.isJefeVentas && !widget.forceShow) {
      return const SizedBox.shrink();
    }

    ref.watch(
      authProvider.select(
        (state) => (
          state.value?.user?.code,
          state.value?.vendedorCodes.join(','),
        ),
      ),
    );

    final shouldLoadVendors = widget.isJefeVentas || widget.forceShow;
    if (shouldLoadVendors && _vendedores.isEmpty && !_isLoading) {
      _loadVendedores();
    }

    final selectedVendor = ref.watch(selectedVendorProvider);

    final isValidSelection = selectedVendor == null ||
        (widget.includeAllOption && selectedVendor == 'ALL') ||
        _vendedores.any(
          (v) => vendorCodeListContains(
            <String>[v['code'].toString()],
            selectedVendor,
          ),
        );

    final currentValue = isValidSelection ? selectedVendor : null;
    final isCompact = Responsive.isLandscapeCompact(context);

    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: 12,
        vertical: isCompact ? 3 : 8,
      ),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        border: Border(
          bottom:
              BorderSide(color: AppTheme.borderColor.withValues(alpha: 0.9)),
        ),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: AppTheme.info.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(AppTheme.radiusSm),
              border: Border.all(
                color: AppTheme.info.withValues(alpha: 0.18),
              ),
            ),
            child: const Icon(
              Icons.visibility_rounded,
              color: AppTheme.info,
              size: 16,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            'Ver como:',
            style: TextStyle(
              fontSize: 12,
              color: AppTheme.textSecondary,
              fontWeight: FontWeight.w600,
              letterSpacing: 0,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Container(
              height: 36 * Responsive.landscapeScale(context),
              padding: const EdgeInsets.symmetric(horizontal: 10),
              decoration: BoxDecoration(
                color: AppTheme.raisedSurface,
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                border: Border.all(
                  color: AppTheme.borderColor.withValues(alpha: 0.9),
                ),
              ),
              child: _isLoading
                  ? const Center(
                      child: SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    )
                  : DropdownButtonHideUnderline(
                      child: DropdownButton<String>(
                        value: currentValue,
                        isExpanded: true,
                        isDense: true,
                        dropdownColor: AppTheme.raisedSurface,
                        icon: const Icon(
                          Icons.arrow_drop_down_rounded,
                          color: AppTheme.info,
                          size: 20,
                        ),
                        style: TextStyle(
                          color: AppTheme.textPrimary,
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 0,
                        ),
                        hint: Text(
                          widget.includeAllOption
                              ? _allOptionLabel
                              : 'Selecciona comercial',
                          style: TextStyle(
                            color: AppTheme.textSecondary,
                            fontWeight: FontWeight.w600,
                            fontSize: 13,
                            letterSpacing: 0,
                          ),
                        ),
                        items: [
                          if (widget.includeAllOption)
                            DropdownMenuItem<String>(
                              value: 'ALL',
                              child: Text(
                                _allOptionLabel,
                                style: TextStyle(
                                  color: AppTheme.textPrimary,
                                  fontWeight: FontWeight.w700,
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
                                style: TextStyle(
                                  color: AppTheme.textPrimary,
                                  fontSize: 12,
                                ),
                              ),
                            );
                          }),
                        ],
                        onChanged: (value) {
                          ref.read(filterProvider.notifier).setVendor(value);
                          widget.onChanged?.call();
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
