import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../utils/responsive.dart';
import 'dart:async';

class MultiSelectDialog<T> extends StatefulWidget {
  final List<T> items;
  final Set<T> selectedItems;
  final String title;
  final String Function(T) labelBuilder;
  final Future<List<T>> Function(String)? onRemoteSearch;

  const MultiSelectDialog({
    super.key,
    required this.items,
    required this.selectedItems,
    required this.title,
    required this.labelBuilder,
    this.onRemoteSearch,
  });

  @override
  State<MultiSelectDialog<T>> createState() => _MultiSelectDialogState<T>();
}

class _MultiSelectDialogState<T> extends State<MultiSelectDialog<T>> {
  late Set<T> _tempSelected;
  late List<T> _currentItems;
  String _searchQuery = '';
  final TextEditingController _searchController = TextEditingController();
  Timer? _debounce;
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _tempSelected = Set.from(widget.selectedItems);
    _currentItems = List.from(widget.items);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String query) {
    if (widget.onRemoteSearch != null) {
      if (_debounce?.isActive ?? false) _debounce!.cancel();
      _debounce = Timer(const Duration(milliseconds: 500), () async {
        setState(() => _isLoading = true);
        try {
          final results = await widget.onRemoteSearch!(query);
          if (mounted) {
            setState(() {
              _currentItems = results;
              _isLoading = false;
            });
          }
        } catch (e) {
          if (mounted) setState(() => _isLoading = false);
        }
      });
    } else {
      setState(() => _searchQuery = query);
    }
  }

  @override
  Widget build(BuildContext context) {
    // If remote search is enabled, show _currentItems directly (server does filtering)
    // If local search, filter _currentItems by query
    final displayItems = widget.onRemoteSearch != null 
        ? _currentItems 
        : _currentItems.where((item) {
            return widget.labelBuilder(item).toLowerCase().contains(_searchQuery.toLowerCase());
          }).toList();

    return Dialog(
      backgroundColor: AppTheme.surfaceColor,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Container(
        constraints: BoxConstraints(
          maxWidth: Responsive.clampWidth(context, 400),
          maxHeight: Responsive.clampHeight(context, 600),
        ),
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(widget.title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white)),
            const SizedBox(height: 16),
            TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'Buscar...',
                prefixIcon: _isLoading 
                    ? const Padding(padding: EdgeInsets.all(12), child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white70)))
                    : const Icon(Icons.search, color: Colors.white54),
                filled: true,
                fillColor: AppTheme.darkBase,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
                contentPadding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
              ),
              style: const TextStyle(color: Colors.white),
              onChanged: _onSearchChanged,
            ),
            const SizedBox(height: 12),
            Expanded(
              child: displayItems.isEmpty
                  ? const Center(child: Text('No se encontraron resultados', style: TextStyle(color: Colors.white30)))
                  : ListView.builder(
                      itemCount: displayItems.length,
                      itemBuilder: (context, index) {
                        final item = displayItems[index];
                        // Logic to handle selection state. 
                        // Note: For objects (Map), containment check might rely on reference equality.
                        // We assume T checks equality correctly or is same instance if possible.
                        // Ideally we should use ID checking, but T is generic. 
                        // We rely on '==' which works for Maps if contents identical? No, Dart Map equality is reference by default unless const.
                        // However, for this specific use case (Maps from JSON), we might need a custom key extractor or just assume equality works because we populated _tempSelected from the same pool or manually.
                        // Wait, if we search remotely, we get NEW instances of Maps. Map equality will FAIL.
                        // Fix: We need a way to compare items. 
                        // But T is generic. 
                        // Let's assume for now that if using Map, we can't easily fix this without breaking generic.
                        // BUT, for the dashboard, we select CODES (Strings). 
                        // Ah, _tempSelected is Set<T>. If T is Map, we have a problem with remote search returning new maps.
                        
                        // HACK for Map<String, dynamic>:
                        bool isSelected = _tempSelected.contains(item);
                        if (!isSelected && item is Map && item.containsKey('code')) {
                           // Try finding by code in _tempSelected if T is Map
                           // This breaks generic purity but solves the immediate issue for our Map-heavy app.
                           final code = item['code'];
                           isSelected = _tempSelected.any((e) => e is Map && e['code'] == code);
                        }

                        return CheckboxListTile(
                          title: Text(widget.labelBuilder(item), style: const TextStyle(color: Colors.white)),
                          value: isSelected,
                          activeColor: AppTheme.neonBlue,
                          checkColor: Colors.white,
                          onChanged: (val) {
                            setState(() {
                              if (val == true) {
                                // If using Map identification hack, we should remove the OLD entry with same code first to avoid duplicates?
                                // No, Set handles uniqueness by object.
                                // If we want to replace the object with same code:
                                if (item is Map && item.containsKey('code')) {
                                   _tempSelected.removeWhere((e) => e is Map && e['code'] == item['code']);
                                }
                                _tempSelected.add(item);
                              } else {
                                if (item is Map && item.containsKey('code')) {
                                   _tempSelected.removeWhere((e) => e is Map && e['code'] == item['code']);
                                } else {
                                  _tempSelected.remove(item);
                                }
                              }
                            });
                          },
                        );
                      },
                    ),
            ),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.neonBlue,
                    foregroundColor: Colors.white,
                  ),
                  onPressed: () => Navigator.pop(context, _tempSelected),
                  child: const Text('Aplicar'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

