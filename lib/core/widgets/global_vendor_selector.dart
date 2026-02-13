import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/filter_provider.dart';
import '../api/api_client.dart';
import '../theme/app_theme.dart';

class GlobalVendorSelector extends StatefulWidget {
  final bool isJefeVentas;
  final VoidCallback? onChanged;

  const GlobalVendorSelector({
    Key? key,
    required this.isJefeVentas,
    this.onChanged,
  }) : super(key: key);

  @override
  State<GlobalVendorSelector> createState() => _GlobalVendorSelectorState();
}

class _GlobalVendorSelectorState extends State<GlobalVendorSelector> {
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
      // Using cache to prevent redundant calls on every tab switch
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
                // Filter out ZZ-prefixed obsolete entries
                if (name.toUpperCase().startsWith('ZZ')) return false;
                return true;
              })
              .toList();
          // Sort by code ascending (numeric-aware)
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

    return Consumer<FilterProvider>(
      builder: (context, filterProvider, _) {
        final selectedVendor = filterProvider.selectedVendor;
        
        // Validation: Ensure selected vendor exists in list (or is null)
        final isValidSelection = selectedVendor == null || 
            _vendedores.any((v) => v['code'].toString() == selectedVendor);
            
        final currentValue = isValidSelection ? selectedVendor : null;

        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          color: AppTheme.surfaceColor,
          child: Row(
            children: [
              const Icon(Icons.visibility, color: AppTheme.neonBlue, size: 18),
              const SizedBox(width: 8),
              const Text(
                'Ver como:', 
                style: TextStyle(fontSize: 12, color: Colors.white70)
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Container(
                  height: 36, // Fixed height for consistency
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  decoration: BoxDecoration(
                    color: AppTheme.darkSurface,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
                  ),
                  child: _isLoading 
                      ? const Center(child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.neonBlue)))
                      : DropdownButtonHideUnderline(
                          child: DropdownButton<String>(
                            value: currentValue,
                            isExpanded: true,
                            isDense: true,
                            dropdownColor: AppTheme.darkCard,
                            icon: const Icon(Icons.arrow_drop_down, color: AppTheme.neonBlue, size: 20),
                            style: const TextStyle(color: Colors.white, fontSize: 13),
                            hint: const Text(
                              'Todos los comerciales', 
                              style: TextStyle(
                                color: Colors.white, 
                                fontWeight: FontWeight.bold,
                                fontSize: 13
                              )
                            ),
                            items: [
                              const DropdownMenuItem<String>(
                                value: null,
                                child: Text(
                                  'Todos los comerciales', 
                                  style: TextStyle(
                                    color: Colors.white, 
                                    fontWeight: FontWeight.bold
                                  )
                                ),
                              ),
                              ..._vendedores.map((v) {
                                final code = v['code']?.toString() ?? '';
                                final name = v['name']?.toString() ?? '';
                                // REMOVED (0) count as requested by User
                                final displayName = name.isNotEmpty ? name : 'Vendedor $code';
                                return DropdownMenuItem<String>(
                                  value: code,
                                  child: Text(displayName, style: const TextStyle(color: Colors.white)),
                                );
                              }),
                            ],
                            onChanged: (value) {
                              filterProvider.setVendor(value);
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
    );
  }
}
