import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_config.dart';

class RuteroReorderModal extends StatefulWidget {
  final List<Map<String, dynamic>> clients;
  final String employeeCode;
  final String day;

  const RuteroReorderModal({
    super.key,
    required this.clients,
    required this.employeeCode,
    required this.day,
  });

  @override
  State<RuteroReorderModal> createState() => _RuteroReorderModalState();
}

class _RuteroReorderModalState extends State<RuteroReorderModal> {
  late List<Map<String, dynamic>> _orderedClients;
  bool _isSaving = false;
  String? _error;
  String _searchQuery = '';
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    // Create a mutable copy
    _orderedClients = List.from(widget.clients);
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _saveOrder() async {
    setState(() {
      _isSaving = true;
      _error = null;
    });

    try {
      final orderList = _orderedClients.asMap().entries.map((entry) {
        return {
          'cliente': entry.value['code'],
          'posicion': entry.key,
        };
      }).toList();

      await ApiClient.post(
        ApiConfig.ruteroConfig,
        {
          'vendedor': widget.employeeCode,
          'dia': widget.day, // lowercase as expected by backend
          'orden': orderList,
        },
      );

      if (mounted) {
        Navigator.pop(context, true); // Return true to trigger refresh
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'Error al guardar: $e';
          _isSaving = false;
        });
      }
    }
  }

  void _moveClient(int oldIndex, int newIndex) {
    if (oldIndex < newIndex) {
      newIndex -= 1;
    }
    setState(() {
      final item = _orderedClients.removeAt(oldIndex);
      _orderedClients.insert(newIndex, item);
      _searchQuery = ''; // Clear search to show full list after move
      _searchController.clear();
    });
  }

  void _moveToTop(int index) {
     setState(() {
      final item = _orderedClients.removeAt(index);
      _orderedClients.insert(0, item);
      _searchQuery = '';
      _searchController.clear();
    });
  }

  void _moveToBottom(int index) {
     setState(() {
      final item = _orderedClients.removeAt(index);
      _orderedClients.add(item);
      _searchQuery = '';
      _searchController.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    // Filter for display BUT actions must map back to original list indices
    // This is tricky with ReorderableListView. 
    // ReorderableListView usually requires the full list to be rendered or handled carefully.
    // If we filter, we can't drag "into" hidden items.
    // Strategy: 
    // 1. If searching, show a standard ListView with "Move to Top/Bottom" actions.
    // 2. If NOT searching, show ReorderableListView.
    
    final isSearching = _searchQuery.isNotEmpty;
    
    final displayList = isSearching 
        ? _orderedClients.where((c) {
            final code = (c['code'] ?? '').toString().toLowerCase();
            final name = (c['name'] ?? '').toString().toLowerCase();
            return code.contains(_searchQuery) || name.contains(_searchQuery);
          }).toList() 
        : _orderedClients;

    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text('Ordenar Rutero', style: TextStyle(fontWeight: FontWeight.bold)),
        actions: [
          if (_isSaving)
            const Center(child: Padding(
              padding: EdgeInsets.only(right: 16.0),
              child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.neonPink)),
            ))
          else
            TextButton.icon(
              onPressed: _saveOrder,
              icon: Icon(Icons.save, color: AppTheme.neonPink),
              label: Text('Guardar', style: TextStyle(color: AppTheme.neonPink, fontWeight: FontWeight.bold)),
            ),
        ],
      ),
      body: Column(
        children: [
          if (_error != null)
            Container(
              padding: const EdgeInsets.all(8),
              color: AppTheme.error.withOpacity(0.2),
              width: double.infinity,
              child: Text(
                _error!,
                style: TextStyle(color: AppTheme.error),
                textAlign: TextAlign.center,
              ),
            ),
            
          // Search Bar
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: TextField(
              controller: _searchController,
              onChanged: (val) => setState(() => _searchQuery = val.toLowerCase()),
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                hintText: 'Buscar cliente para mover...',
                hintStyle: TextStyle(color: Colors.grey.shade500),
                prefixIcon: const Icon(Icons.search, color: Colors.grey),
                filled: true,
                fillColor: AppTheme.surfaceColor,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                suffixIcon: isSearching 
                  ? IconButton(
                      icon: const Icon(Icons.clear, color: Colors.grey),
                      onPressed: () => setState(() {
                        _searchController.clear();
                        _searchQuery = '';
                      }),
                    ) 
                  : null,
              ),
            ),
          ),
          
          if (isSearching)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
              child: Row(
                children: [
                  Icon(Icons.info_outline, color: AppTheme.neonBlue, size: 16),
                  const SizedBox(width: 8),
                  Expanded(child: Text(
                    'Limpia la búsqueda para arrastrar y soltar.',
                    style: TextStyle(color: AppTheme.neonBlue, fontSize: 12),
                  )),
                ],
              ),
            ),

          Expanded(
            child: isSearching 
              ? ListView.builder(
                  itemCount: displayList.length,
                  itemBuilder: (context, index) {
                    final client = displayList[index];
                    // Find actual index in main list
                    final realIndex = _orderedClients.indexOf(client);
                    
                    return _buildListItem(client, realIndex, false);
                  },
                )
              : ReorderableListView.builder(
                  itemCount: _orderedClients.length,
                  onReorder: _moveClient,
                  itemBuilder: (context, index) {
                     final client = _orderedClients[index];
                     return _buildListItem(client, index, true);
                  },
                ),
          ),
        ],
      ),
    );
  }

  Widget _buildListItem(Map<String, dynamic> client, int index, bool isReorderable) {
    // Unique key is critical for ReorderableListView
    final key = ValueKey(client['code']);
    
    return Container(
      key: key,
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      decoration: BoxDecoration(
        color: AppTheme.darkSurface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white.withOpacity(0.05)),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        leading: CircleAvatar(
          backgroundColor: AppTheme.neonPink.withOpacity(0.1),
          child: Text(
            '${index + 1}', 
            style: TextStyle(color: AppTheme.neonPink, fontWeight: FontWeight.bold)
          ),
        ),
        title: Text(
          client['name'] ?? 'Sin Nombre',
          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w500),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Text(
          client['code'] ?? '',
          style: TextStyle(color: Colors.grey.shade400),
        ),
        trailing: isReorderable 
          ? const Icon(Icons.drag_handle, color: Colors.grey)
          : Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(
                  icon: const Icon(Icons.vertical_align_top),
                  color: AppTheme.neonBlue,
                  tooltip: 'Mover al inicio',
                  onPressed: () => _moveToTop(index),
                ),
                IconButton(
                  icon: const Icon(Icons.vertical_align_bottom),
                  color: AppTheme.neonBlue,
                  tooltip: 'Mover al final',
                  onPressed: () => _moveToBottom(index),
                ),
              ],
            ),
      ),
    );
  }
}
