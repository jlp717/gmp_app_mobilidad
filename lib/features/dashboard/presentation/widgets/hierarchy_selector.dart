import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';

class HierarchySelector extends StatefulWidget {
  final List<String> currentHierarchy;
  final Function(List<String>) onChanged;

  const HierarchySelector({
    super.key, 
    required this.currentHierarchy, 
    required this.onChanged,
  });

  @override
  State<HierarchySelector> createState() => _HierarchySelectorState();
}

class _HierarchySelectorState extends State<HierarchySelector> {
  // Available dimensions
  final Map<String, String> _dimensionLabels = {
    'vendor': 'Comercial',
    'client': 'Cliente',
    'product': 'Producto',
    'family': 'Familia',
  };

  final Map<String, IconData> _dimensionIcons = {
    'vendor': Icons.person_outline,
    'client': Icons.business,
    'product': Icons.inventory_2_outlined,
    'family': Icons.category_outlined,
  };

  late List<String> _activeDimensions;
  late List<String> _availableDimensions;

  @override
  void initState() {
    super.initState();
    _activeDimensions = List.from(widget.currentHierarchy);
    _availableDimensions = _dimensionLabels.keys
        .where((d) => !_activeDimensions.contains(d))
        .toList();
  }
  
  void _updateHierarchy() {
    widget.onChanged(_activeDimensions);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: AppTheme.glassMorphism(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              const Icon(Icons.layers, color: AppTheme.neonBlue, size: 18),
              const SizedBox(width: 8),
              Text(
                'Jerarquía de Agrupación',
                style: Theme.of(context).textTheme.titleSmall?.copyWith(color: Colors.white70),
              ),
              const Spacer(),
              const Text(
                'Arrastra para ordenar', 
                style: TextStyle(color: Colors.white30, fontSize: 10, fontStyle: FontStyle.italic)
              ),
            ],
          ),
          const SizedBox(height: 12),
          
          // Reorderable List for Active
          ReorderableListView(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            onReorder: (oldIndex, newIndex) {
              setState(() {
                if (oldIndex < newIndex) {
                  newIndex -= 1;
                }
                final String item = _activeDimensions.removeAt(oldIndex);
                _activeDimensions.insert(newIndex, item);
                _updateHierarchy();
              });
            },
            children: [
               for (final dim in _activeDimensions)
                 _buildChip(dim, true, Key(dim)),
            ],
          ),
          
          // Add button for inactive
          if (_availableDimensions.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: _availableDimensions.map((dim) => _buildChip(dim, false, Key('inactive_$dim'))).toList(),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildChip(String dim, bool isActive, Key key) {
    return Container(
      key: key,
      margin: const EdgeInsets.symmetric(vertical: 4),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () {
            setState(() {
              if (isActive) {
                // Don't allow removing if it's the only one
                if (_activeDimensions.length > 1) {
                  _activeDimensions.remove(dim);
                  _availableDimensions.add(dim);
                  _updateHierarchy();
                }
              } else {
                _availableDimensions.remove(dim);
                _activeDimensions.add(dim);
                _updateHierarchy();
              }
            });
          },
          borderRadius: BorderRadius.circular(20),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: isActive ? AppTheme.neonBlue.withOpacity(0.15) : Colors.white10,
              border: Border.all(
                color: isActive ? AppTheme.neonBlue.withOpacity(0.5) : Colors.white10,
              ),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (isActive) 
                  const Icon(Icons.drag_indicator, size: 16, color: Colors.white30),
                if (isActive) const SizedBox(width: 8),
                Icon(_dimensionIcons[dim], size: 16, color: isActive ? AppTheme.neonBlue : Colors.white30),
                const SizedBox(width: 8),
                Text(
                  _dimensionLabels[dim]!,
                  style: TextStyle(
                    color: isActive ? Colors.white : Colors.white54,
                    fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
                    fontSize: 13,
                  ),
                ),
                if (isActive && _activeDimensions.length > 1) ...[
                   const SizedBox(width: 8),
                   const Icon(Icons.close, size: 14, color: Colors.white30),
                ] else if (!isActive) ...[
                   const SizedBox(width: 8),
                   const Icon(Icons.add, size: 14, color: AppTheme.neonBlue),
                ]
              ],
            ),
          ),
        ),
      ),
    );
  }
}
