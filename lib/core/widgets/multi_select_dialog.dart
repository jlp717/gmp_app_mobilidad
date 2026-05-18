import 'dart:async';

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';

/// Multi-select dialog — V2 Premium.
/// Modern dialog with refined styling, search, and smooth interactions.
class MultiSelectDialog<T> extends StatefulWidget {

  const MultiSelectDialog({
    required this.items, required this.selectedItems, required this.title, required this.labelBuilder, super.key,
    this.onRemoteSearch,
  });
  final List<T> items;
  final Set<T> selectedItems;
  final String title;
  final String Function(T) labelBuilder;
  final Future<List<T>> Function(String)? onRemoteSearch;

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
    final displayItems = widget.onRemoteSearch != null
        ? _currentItems
        : _currentItems.where((item) {
            return widget.labelBuilder(item).toLowerCase().contains(_searchQuery.toLowerCase());
          }).toList();

    return Dialog(
      backgroundColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.radiusLg)),
      child: Container(
        constraints: BoxConstraints(
          maxWidth: Responsive.clampWidth(context, 420),
          maxHeight: Responsive.clampHeight(context, 600),
        ),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              AppTheme.darkCard.withValues(alpha: 0.95),
              AppTheme.darkSurface.withValues(alpha: 0.9),
            ],
          ),
          borderRadius: BorderRadius.circular(AppTheme.radiusLg),
          border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.3),
              blurRadius: 30,
              offset: const Offset(0, 15),
            ),
          ],
        ),
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Header
            Text(
              widget.title,
              style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w700,
                color: Colors.white,
                letterSpacing: -0.3,
              ),
            ),
            const SizedBox(height: 16),
            // Search field
            TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'Buscar...',
                hintStyle: TextStyle(color: Colors.white.withValues(alpha: 0.3)),
                prefixIcon: _isLoading
                    ? const Padding(
                        padding: EdgeInsets.all(14),
                        child: SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.neonBlue),
                        ),
                      )
                    : Icon(Icons.search_rounded, color: Colors.white.withValues(alpha: 0.3)),
                filled: true,
                fillColor: AppTheme.darkSurface.withValues(alpha: 0.5),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                  borderSide: BorderSide.none,
                ),
                contentPadding: const EdgeInsets.symmetric(vertical: 10, horizontal: 14),
              ),
              style: const TextStyle(color: Colors.white),
              onChanged: _onSearchChanged,
            ),
            const SizedBox(height: 12),
            // List
            Flexible(
              child: displayItems.isEmpty
                  ? Center(
                      child: Text(
                        'No se encontraron resultados',
                        style: TextStyle(color: Colors.white.withValues(alpha: 0.25)),
                      ),
                    )
                  : ListView.builder(
                      shrinkWrap: true,
                      itemCount: displayItems.length,
                      itemBuilder: (context, index) {
                        final item = displayItems[index];

                        var isSelected = _tempSelected.contains(item);
                        if (!isSelected && item is Map && item.containsKey('code')) {
                          final code = item['code'];
                          isSelected = _tempSelected.any((e) => e is Map && e['code'] == code);
                        }

                        return Padding(
                          padding: const EdgeInsets.symmetric(vertical: 2),
                          child: Material(
                            color: Colors.transparent,
                            child: InkWell(
                              onTap: () {
                                setState(() {
                                  if (isSelected) {
                                    if (item is Map && item.containsKey('code')) {
                                      _tempSelected.removeWhere((e) => e is Map && e['code'] == item['code']);
                                    } else {
                                      _tempSelected.remove(item);
                                    }
                                  } else {
                                    if (item is Map && item.containsKey('code')) {
                                      _tempSelected.removeWhere((e) => e is Map && e['code'] == item['code']);
                                    }
                                    _tempSelected.add(item);
                                  }
                                });
                              },
                              borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                                child: Row(
                                  children: [
                                    Container(
                                      width: 22,
                                      height: 22,
                                      decoration: BoxDecoration(
                                        borderRadius: BorderRadius.circular(6),
                                        border: Border.all(
                                          color: isSelected
                                              ? AppTheme.neonBlue
                                              : Colors.white.withValues(alpha: 0.15),
                                          width: 1.5,
                                        ),
                                        color: isSelected
                                            ? AppTheme.neonBlue.withValues(alpha: 0.15)
                                            : Colors.transparent,
                                      ),
                                      child: isSelected
                                          ? const Icon(Icons.check_rounded, color: AppTheme.neonBlue, size: 16)
                                          : null,
                                    ),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: Text(
                                        widget.labelBuilder(item),
                                        style: TextStyle(
                                          color: isSelected
                                              ? Colors.white
                                              : Colors.white.withValues(alpha: 0.6),
                                          fontWeight: isSelected ? FontWeight.w500 : FontWeight.normal,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        );
                      },
                    ),
            ),
            const SizedBox(height: 16),
            // Actions
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.radiusMd)),
                  ),
                  child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.neonBlue,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.radiusMd)),
                    elevation: 0,
                  ),
                  onPressed: () => Navigator.pop(context, _tempSelected),
                  child: const Text('Aplicar', style: TextStyle(fontWeight: FontWeight.w600)),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
