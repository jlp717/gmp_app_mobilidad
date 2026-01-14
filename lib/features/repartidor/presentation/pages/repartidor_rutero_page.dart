import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import '../../../../core/providers/auth_provider.dart';
import '../../../../core/providers/filter_provider.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/smart_sync_header.dart';
import '../../../entregas/providers/entregas_provider.dart';
import '../../../../core/api/api_client.dart';

class RepartidorRuteroPage extends StatefulWidget {
  final String? repartidorId;

  const RepartidorRuteroPage({super.key, this.repartidorId});

  @override
  State<RepartidorRuteroPage> createState() => _RepartidorRuteroPageState();
}

class _RepartidorRuteroPageState extends State<RepartidorRuteroPage> {
  DateTime _selectedDate = DateTime.now();
  List<Map<String, dynamic>> _weekDays = [];
  bool _isLoadingWeek = false;
  String? _lastLoadedId;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadData();
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final filter = Provider.of<FilterProvider>(context, listen: true);
    
    // Determine effective target
    String targetId = widget.repartidorId ?? auth.currentUser?.code ?? '';
    if (auth.isDirector && filter.selectedVendor != null) {
      targetId = filter.selectedVendor!;
    }

    // Auto-reload if ID changed
    if (targetId.isNotEmpty && targetId != _lastLoadedId) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          setState(() { _lastLoadedId = targetId; });
          _loadData(); 
        }
      });
    }
  }

  Future<void> _loadData() async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final filter = Provider.of<FilterProvider>(context, listen: false);
    final entregas = Provider.of<EntregasProvider>(context, listen: false);

    String targetId = widget.repartidorId ?? auth.currentUser?.code ?? '';
    
    // View As logic
    if (auth.isDirector && filter.selectedVendor != null) {
      targetId = filter.selectedVendor!;
    }

    if (targetId.isNotEmpty) {
      _lastLoadedId = targetId; // Sync
      entregas.setRepartidor(targetId);
      entregas.seleccionarFecha(_selectedDate); 
      _loadWeekData(targetId);
    }
  }

  Future<void> _loadWeekData(String repartidorId) async {
    if (_isLoadingWeek) return;
    setState(() => _isLoadingWeek = true);

    try {
      final response = await ApiClient.get('/repartidor/rutero/week/$repartidorId?date=${_selectedDate.toIso8601String()}');
      if (response['success'] == true && mounted) {
        setState(() {
          _weekDays = List<Map<String, dynamic>>.from(response['days']);
        });
      }
    } catch (e) {
      print('Error loading week data: $e');
    } finally {
      if (mounted) setState(() => _isLoadingWeek = false);
    }
  }

  void _onDaySelected(DateTime date) {
    setState(() {
      _selectedDate = date;
    });
    final entregas = Provider.of<EntregasProvider>(context, listen: false);
    entregas.seleccionarFecha(date);
  }

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthProvider>(context);
    final filter = Provider.of<FilterProvider>(context);
    final entregas = Provider.of<EntregasProvider>(context);

    // Header Name Logic
    String currentName = auth.currentUser?.name ?? 'Repartidor';
    if (auth.isDirector && filter.selectedVendor != null) {
      currentName = 'Repartidor ${filter.selectedVendor}';
    }

    return Scaffold(
      backgroundColor: AppTheme.darkBase, // Dark Background
      body: Column(
        children: [
          // HEADER
          SmartSyncHeader(
            title: 'Rutero Reparto',
            subtitle: currentName,
            onSync: () => _loadData(),
            isLoading: entregas.isLoading || _isLoadingWeek,
          ),

          // WEEKLY STRIP
          if (_weekDays.isNotEmpty) _buildWeeklyStrip(),

          // ERROR
          if (entregas.error != null)
             Container(
               padding: const EdgeInsets.all(8),
               color: AppTheme.error.withOpacity(0.1),
               width: double.infinity,
               child: Text(
                 '${entregas.error}', 
                 style: const TextStyle(color: AppTheme.error, fontSize: 12),
                 textAlign: TextAlign.center,
                ),
             ),

          // LIST
          Expanded(
            child: entregas.isLoading 
                ? const Center(child: CircularProgressIndicator(color: AppTheme.neonBlue))
                : _buildClientList(entregas),
          ),
        ],
      ),
    );
  }

  Widget _buildWeeklyStrip() {
    return Container(
      height: 85,
      color: AppTheme.surfaceColor, // Dark Surface
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        itemCount: _weekDays.length,
        itemBuilder: (context, index) {
          final dayData = _weekDays[index];
          final date = DateTime.parse(dayData['date']);
          final isSelected = DateUtils.isSameDay(date, _selectedDate);
          final status = dayData['status'];
          final count = dayData['clients'] ?? 0;

          Color bgColor = AppTheme.darkCard;
          Color borderColor = Colors.white.withOpacity(0.1);
          Color textColor = AppTheme.textSecondary;
          
          if (status == 'good') {
            bgColor = AppTheme.success.withOpacity(0.1);
            borderColor = AppTheme.success.withOpacity(0.3);
            textColor = AppTheme.success;
          } else if (status == 'bad') {
            bgColor = AppTheme.error.withOpacity(0.1);
            borderColor = AppTheme.error.withOpacity(0.3);
            textColor = AppTheme.error;
          }

          if (isSelected) {
            bgColor = AppTheme.neonBlue;
            borderColor = AppTheme.neonBlue;
            textColor = AppTheme.darkBase;
          }

          return GestureDetector(
            onTap: () => _onDaySelected(date),
            child: Container(
              width: 55,
              margin: const EdgeInsets.only(right: 6),
              decoration: BoxDecoration(
                color: bgColor,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: borderColor, width: 1.5),
                boxShadow: isSelected ? [
                  BoxShadow(color: AppTheme.neonBlue.withOpacity(0.4), blurRadius: 4, offset:const Offset(0, 2))
                ] : null
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    dayData['dayName'] ?? '',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                      color: textColor.withOpacity(isSelected ? 0.9 : 0.7),
                    ),
                  ),
                  Text(
                    '${dayData['day']}',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w900,
                      color: textColor,
                    ),
                  ),
                  if (count > 0 || status != 'none')
                     Container(
                       margin: const EdgeInsets.only(top: 2),
                       width: 6,
                       height: 6,
                       decoration: BoxDecoration(
                         shape: BoxShape.circle,
                         color: isSelected ? AppTheme.darkBase : (status == 'good' ? AppTheme.success : (status == 'bad' ? AppTheme.error : Colors.grey)),
                       ),
                     )
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildClientList(EntregasProvider provider) {
    if (provider.albaranes.isEmpty) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.assignment_turned_in_outlined, size: 64, color: AppTheme.textSecondary),
            SizedBox(height: 16),
            Text('No hay entregas para este día', style: TextStyle(color: AppTheme.textSecondary, fontSize: 16)),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(12),
      itemCount: provider.albaranes.length,
      itemBuilder: (context, index) {
        final albaran = provider.albaranes[index];
        return _buildClientCard(albaran);
      },
    );
  }

  Widget _buildClientCard(AlbaranEntrega albaran) {
    
    // Status Logic
    bool isDelivered = albaran.estado == EstadoEntrega.entregado;
    bool isPartial = albaran.estado == EstadoEntrega.parcial;
    bool isCTR = albaran.esCTR;
    
    Color statusColor = Colors.orange;
    String statusText = 'PENDIENTE';
    IconData statusIcon = Icons.schedule;

    if (isDelivered) {
      statusColor = AppTheme.success;
      statusText = 'ENTREGADO';
      statusIcon = Icons.check_circle;
    } else if (isPartial) {
      statusColor = AppTheme.warning;
      statusText = 'PARCIAL';
      statusIcon = Icons.pie_chart;
    } else if (isCTR) {
      statusColor = AppTheme.error;
      statusText = 'COBRO'; 
      statusIcon = Icons.euro;
    }

    return Card(
      elevation: 4,
      color: AppTheme.darkCard,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: InkWell(
        onTap: () => _showDetailDialog(albaran),
        borderRadius: BorderRadius.circular(12),
        splashColor: AppTheme.neonBlue.withOpacity(0.1),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Top Row: Code & Amount
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                   Container(
                     padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                     decoration: BoxDecoration(
                       color: AppTheme.darkBase,
                       borderRadius: BorderRadius.circular(4),
                       border: Border.all(color: AppTheme.borderColor)
                     ),
                     child: Text(
                       albaran.codigoCliente, 
                       style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.textSecondary)
                     ),
                   ),
                   Text(
                     '${albaran.importeTotal.toStringAsFixed(2)} €',
                     style: TextStyle(
                       fontWeight: FontWeight.bold,
                       fontSize: 16,
                       color: isCTR ? AppTheme.error : AppTheme.textPrimary
                     ),
                   ),
                ],
              ),
              const SizedBox(height: 8),

              // Name
              Text(
                albaran.nombreCliente,
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),

              const SizedBox(height: 4),
              // Address
               Row(
                children: [
                  const Icon(Icons.location_on, size: 14, color: AppTheme.textTertiary),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      '${albaran.direccion}, ${albaran.poblacion}',
                      style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              
              const SizedBox(height: 12),
              
              // Footer: Status & Albaran
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Icon(statusIcon, size: 16, color: statusColor),
                      const SizedBox(width: 4),
                      Text(
                        statusText,
                        style: TextStyle(
                          color: statusColor,
                          fontWeight: FontWeight.bold,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                  Text(
                    'Alb #${albaran.numeroAlbaran}',
                    style: const TextStyle(color: AppTheme.textTertiary, fontSize: 12),
                  ),
                ],
              )
            ],
          ),
        ),
      ),
    );
  }

  void _showDetailDialog(AlbaranEntrega albaran) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => _DetailSheet(albaran: albaran),
    );
  }
}

// INLINE DETAIL SHEET
class _DetailSheet extends StatefulWidget {
  final AlbaranEntrega albaran;
  const _DetailSheet({required this.albaran});
  @override
  State<_DetailSheet> createState() => _DetailSheetState();
}

class _DetailSheetState extends State<_DetailSheet> {
  late AlbaranEntrega _details;
  bool _loading = true;
  String _error = '';
  Map<String, bool> _checkedItems = {}; // Code -> Checked
  final TextEditingController _obsController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadDetails();
  }

  Future<void> _loadDetails() async {
    try {
       final provider = Provider.of<EntregasProvider>(context, listen: false);
       final full = await provider.obtenerDetalleAlbaran(widget.albaran.numeroAlbaran, widget.albaran.ejercicio);
       if (mounted) {
         if (full != null) {
           setState(() {
             _details = full;
             _loading = false;
             // Default check all items as Delivered
             for(var i in _details.items) {
               _checkedItems[i.codigoArticulo] = true;
             }
           });
         } else {
           setState(() { _error = 'No se pudo cargar detalles'; _loading = false; });
         }
       }
    } catch(e) {
      if(mounted) setState(() { _error = 'Error: $e'; _loading = false; });
    }
  }

  bool get _allItemsChecked => _checkedItems.values.every((v) => v);

  @override
  Widget build(BuildContext context) {
    return Container(
      height: MediaQuery.of(context).size.height * 0.9,
      decoration: const BoxDecoration(
        color: AppTheme.surfaceColor, // Dark background
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: Column(
        children: [
          // Header
          Container(
            padding: const EdgeInsets.all(16),
            decoration: const BoxDecoration(
              border: Border(bottom: BorderSide(color: AppTheme.borderColor))
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(widget.albaran.nombreCliente, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: AppTheme.textPrimary)),
                      Text('${widget.albaran.direccion}', style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                    ],
                  ),
                ),
                IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close, color: AppTheme.textPrimary)),
              ],
            ),
          ),
          
          if (_loading) const Expanded(child: Center(child: CircularProgressIndicator(color: AppTheme.neonBlue))),
          
          if (!_loading)
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  // Info Card
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppTheme.neonBlue.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3))
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                         const Text('Importe Total:', style: TextStyle(fontWeight: FontWeight.w500, color: AppTheme.textPrimary)),
                         Text('${widget.albaran.importeTotal.toStringAsFixed(2)} €', 
                           style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonBlue, fontSize: 18)),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  
                  const Text('Artículos', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: AppTheme.textPrimary)),
                  const SizedBox(height: 8),

                  if (_details.items.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 20),
                      child: Center(child: Text('No hay artículos disponibles. Verificar Albarán.', style: TextStyle(color: AppTheme.textTertiary))),
                    ),

                  ..._details.items.map((item) {
                    final isChecked = _checkedItems[item.codigoArticulo] ?? false;
                    return CheckboxListTile(
                      value: isChecked,
                      activeColor: AppTheme.neonBlue,
                      checkColor: AppTheme.darkBase,
                      title: Text(item.descripcion.isNotEmpty ? item.descripcion : 'Art. ${item.codigoArticulo}', style: const TextStyle(color: AppTheme.textPrimary)),
                      subtitle: Text('${item.cantidadPedida.toStringAsFixed(0)} Uds', style: const TextStyle(color: AppTheme.textSecondary)),
                      controlAffinity: ListTileControlAffinity.leading,
                      contentPadding: EdgeInsets.zero,
                      onChanged: (val) {
                        setState(() {
                          _checkedItems[item.codigoArticulo] = val ?? false;
                        });
                      },
                    );
                  }).toList(),
                  
                  const SizedBox(height: 20),
                  const Divider(color: AppTheme.borderColor),
                  const SizedBox(height: 10),

                  // Observations
                  TextField(
                    controller: _obsController,
                    maxLines: 2,
                    decoration: InputDecoration(
                      labelText: 'Observaciones / Motivo',
                      hintText: !_allItemsChecked ? 'Obligatorio si hay incidencias' : 'Opcional',
                      hintStyle: TextStyle(color: AppTheme.textSecondary.withOpacity(0.5)),
                      labelStyle: const TextStyle(color: AppTheme.textSecondary),
                      border: const OutlineInputBorder(),
                      filled: true,
                      fillColor: AppTheme.darkBase,
                    ),
                    style: const TextStyle(color: AppTheme.textPrimary),
                    onChanged: (v) => setState((){}),
                  ),
                ],
              ),
            ),

          // Footer Actions
          Container(
            padding: const EdgeInsets.all(16),
            decoration: const BoxDecoration(
              border: Border(top: BorderSide(color: AppTheme.borderColor))
            ),
            child: SizedBox(
               width: double.infinity,
               child: ElevatedButton(
                 style: ElevatedButton.styleFrom(
                   backgroundColor: _allItemsChecked ? AppTheme.success : AppTheme.warning,
                   padding: const EdgeInsets.symmetric(vertical: 16),
                 ),
                 onPressed: () {
                   if (!_allItemsChecked && _obsController.text.trim().isEmpty) {
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                        content: Text('Debe indicar motivo si desmarca artículos'),
                        backgroundColor: AppTheme.error,
                      ));
                      return;
                   }
                   // Logic to complete...
                   Navigator.pop(context);
                 },
                 child: Text(
                   _allItemsChecked ? 'CONFIRMAR ENTREGA' : 'REGISTRAR INCIDENCIA',
                   style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.darkBase),
                 ),
               ),
            ),
          )
        ],
      ),
    );
  }
}
