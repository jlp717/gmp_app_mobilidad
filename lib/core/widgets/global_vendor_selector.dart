import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/filter_provider.dart';
import '../api/api_client.dart';
import '../theme/app_theme.dart';
import '../utils/responsive.dart';

class GlobalVendorSelector extends ConsumerStatefulWidget {
  final bool isJefeVentas;
  final VoidCallback? onChanged;

  const GlobalVendorSelector({
    super.key,
    required this.isJefeVentas,
    this.onChanged,
  });

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
    if (widget.isJefeVentas) {
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
                return true;
              })
              .toList();
          _vendedores.sort((a, b) {
            final codeA = a['code']?.toString() ?? '';
            final codeB = b['code']?.toString() ?? '';
            return codeA.compareTo(codeB);
          });
          _isLoading = false;
        });
      }
    } catch (e) {
      debugPrint('Error loading vendedores: $e');
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.isJefeVentas) return const SizedBox.shrink();

    final filterState = ref.watch(filterProvider);
    final selectedVendor = filterState.selectedVendor;

    final isValidSelection = selectedVendor == null ||
        _vendedores.any((v) => v['code'].toString() == selectedVendor);

    final currentValue = isValidSelection ? selectedVendor : null;
    final bool isCompact = Responsive.isLandscapeCompact(context);

    return Container(
      padding: EdgeInsets.symmetric(
          horizontal: 12, vertical: isCompact ? 2 : 8),
      color: AppTheme.surfaceColor,
      child: Row(
        children: [
          const Icon(Icons.visibility, color: AppTheme.neonBlue, size: 18),
          const SizedBox(width: 8),
          const Text('Ver como:',
              style: TextStyle(fontSize: 12, color: Colors.white70)),
          const SizedBox(width: 8),
          Expanded(
            child: Container(
              height: 36 * Responsive.landscapeScale(context),
              padding: const EdgeInsets.symmetric(horizontal: 10),
              decoration: BoxDecoration(
                color: AppTheme.darkSurface,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                    color: AppTheme.neonBlue.withOpacity(0.3)),
              ),
              child: _isLoading
                  ? const Center(
                      child: SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: AppTheme.neonBlue)))
                  : DropdownButtonHideUnderline(
                      child: DropdownButton<String>(
                        value: currentValue,
                        isExpanded: true,
                        isDense: true,
                        dropdownColor: AppTheme.darkCard,
                        icon: const Icon(Icons.arrow_drop_down,
                            color: AppTheme.neonBlue, size: 20),
                        style: const TextStyle(
                            color: Colors.white, fontSize: 13),
                        hint: const Text('Todos los comerciales',
                            style: TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.bold,
                                fontSize: 13)),
                        items: [
                          const DropdownMenuItem<String>(
                            value: null,
                            child: Text('Todos los comerciales',
                                style: TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.bold)),
                          ),
                          ..._vendedores.map((v) {
                            final code = v['code']?.toString() ?? '';
                            final name = v['name']?.toString() ?? '';
                            final displayName = name.isNotEmpty
                                ? '$code - $name'
                                : 'Vendedor $code';
                            return DropdownMenuItem<String>(
                              value: code,
                              child: Text(displayName,
                                  style: const TextStyle(
                                      color: Colors.white, fontSize: 12)),
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
