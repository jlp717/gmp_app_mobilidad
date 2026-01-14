import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import '../../../../core/providers/auth_provider.dart';
import '../../../../core/providers/filter_provider.dart';
import '../../../../core/widgets/smart_sync_header.dart';
import '../../../entregas/providers/entregas_provider.dart';
import '../../../../core/api/api_client.dart';

class RepartidorRuteroPage extends StatefulWidget {
  // Removed repartidorId from constructor as it should be derived from global state (Auth/Filter)
  // But to be compatible with existing navigation if passed:
  final String? repartidorId;

  const RepartidorRuteroPage({super.key, this.repartidorId});

  @override
  State<RepartidorRuteroPage> createState() => _RepartidorRuteroPageState();
}

class _RepartidorRuteroPageState extends State<RepartidorRuteroPage> {
  DateTime _selectedDate = DateTime.now();
  List<Map<String, dynamic>> _weekDays = [];
  bool _isLoadingWeek = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadData();
    });
  }

  Future<void> _loadData() async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final filter = Provider.of<FilterProvider>(context, listen: false);
    final entregas = Provider.of<EntregasProvider>(context, listen: false);

    String targetId = widget.repartidorId ?? auth.user?.code ?? '';
    
    // Support "View As"
    if (auth.isJefeVentas && filter.selectedVendorCode != null) {
      targetId = filter.selectedVendorCode!;
    }

    if (targetId.isNotEmpty) {
      entregas.setRepartidor(targetId);
      entregas.seleccionarFecha(_selectedDate); // Load deliveries
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
     // Reload week stats effectively? Or keeps static? 
     // Usually stats don't change by clicking a day, but clicking sync does.
  }

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthProvider>(context);
    final filter = Provider.of<FilterProvider>(context);
    final entregas = Provider.of<EntregasProvider>(context);

    String currentName = auth.user?.name ?? 'Repartidor';
    if (auth.isJefeVentas && filter.selectedVendor != null) {
      currentName = filter.selectedVendor!.name;
    }

    return Scaffold(
      backgroundColor: Colors.grey[100],
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
               color: Colors.red.shade50,
               width: double.infinity,
               child: Text(
                 '${entregas.error}', 
                 style: TextStyle(color: Colors.red.shade800, fontSize: 12),
                 textAlign: TextAlign.center,
                ),
             ),

          // LIST
          Expanded(
            child: entregas.isLoading 
                ? const Center(child: CircularProgressIndicator())
                : _buildClientList(entregas),
          ),
        ],
      ),
    );
  }

  Widget _buildWeeklyStrip() {
    return Container(
      height: 85,
      color: Colors.white,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        itemCount: _weekDays.length,
        itemBuilder: (context, index) {
          final dayData = _weekDays[index];
          final date = DateTime.parse(dayData['date']);
          final isSelected = DateUtils.isSameDay(date, _selectedDate);
          final status = dayData['status']; // 'good' (green), 'bad' (red), 'none' (gray)
          final count = dayData['clients'] ?? 0;

          Color bgColor = Colors.white;
          Color borderColor = Colors.grey.shade300;
          Color textColor = Colors.black87;
          
          if (status == 'good') {
            bgColor = Colors.green.shade50;
            borderColor = Colors.green.shade200;
            textColor = Colors.green.shade900;
          } else if (status == 'bad') {
            bgColor = Colors.red.shade50;
            borderColor = Colors.red.shade200;
            textColor = Colors.red.shade900;
          }

          if (isSelected) {
            bgColor = Theme.of(context).primaryColor;
            borderColor = Theme.of(context).primaryColor;
            textColor = Colors.white;
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
                  BoxShadow(color: bgColor.withOpacity(0.4), blurRadius: 4, offset:const Offset(0, 2))
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
                         color: isSelected ? Colors.white : (status == 'good' ? Colors.green : (status == 'bad' ? Colors.red : Colors.grey)),
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
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.assignment_turned_in_outlined, size: 64, color: Colors.grey[300]),
            const SizedBox(height: 16),
            Text('No hay entregas para este día', style: TextStyle(color: Colors.grey[600], fontSize: 16)),
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
      statusColor = Colors.green;
      statusText = 'ENTREGADO';
      statusIcon = Icons.check_circle;
    } else if (isPartial) {
      statusColor = Colors.amber.shade700;
      statusText = 'PARCIAL';
      statusIcon = Icons.pie_chart;
    } else if (isCTR) {
      statusColor = Colors.red;
      statusText = 'COBRO'; // Highlight CTR
      statusIcon = Icons.euro;
    }

    return Card(
      elevation: 2,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: InkWell(
        onTap: () => _showDetailDialog(albaran),
        borderRadius: BorderRadius.circular(12),
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
                       color: Colors.grey[100],
                       borderRadius: BorderRadius.circular(4),
                       border: Border.all(color: Colors.grey.shade300)
                     ),
                     child: Text(
                       albaran.codigoCliente, 
                       style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: Colors.black54)
                     ),
                   ),
                   Text(
                     '${albaran.importeTotal.toStringAsFixed(2)} €',
                     style: TextStyle(
                       fontWeight: FontWeight.bold,
                       fontSize: 16,
                       color: isCTR ? Colors.red : Colors.black87
                     ),
                   ),
                ],
              ),
              const SizedBox(height: 8),

              // Name
              Text(
                albaran.nombreCliente,
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),

              const SizedBox(height: 4),
              // Address
               Row(
                children: [
                  Icon(Icons.location_on, size: 14, color: Colors.grey[500]),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      '${albaran.direccion}, ${albaran.poblacion}',
                      style: TextStyle(color: Colors.grey[600], fontSize: 13),
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
                    style: TextStyle(color: Colors.grey[400], fontSize: 12),
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
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: Column(
        children: [
          // Header
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              border: Border(bottom: BorderSide(color: Colors.grey.shade200))
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(widget.albaran.nombreCliente, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                      Text('${widget.albaran.direccion}', style: TextStyle(color: Colors.grey[600], fontSize: 12)),
                    ],
                  ),
                ),
                IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close)),
              ],
            ),
          ),
          
          if (_loading) const Expanded(child: Center(child: CircularProgressIndicator())),
          
          if (!_loading)
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  // Info Card
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.blue.shade50,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                         const Text('Importe Total:', style: TextStyle(fontWeight: FontWeight.w500)),
                         Text('${widget.albaran.importeTotal.toStringAsFixed(2)} €', 
                           style: TextStyle(fontWeight: FontWeight.bold, color: Colors.blue.shade900, fontSize: 18)),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  
                  const Text('Artículos', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  const SizedBox(height: 8),

                  if (_details.items.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 20),
                      child: Center(child: Text('No hay artículos disponibles. Verificar Albarán.', style: TextStyle(color: Colors.grey))),
                    ),

                  ..._details.items.map((item) {
                    final isChecked = _checkedItems[item.codigoArticulo] ?? false;
                    return CheckboxListTile(
                      value: isChecked,
                      activeColor: Colors.blue,
                      title: Text(item.descripcion.isNotEmpty ? item.descripcion : 'Art. ${item.codigoArticulo}'),
                      subtitle: Text('${item.cantidadPedida.toStringAsFixed(0)} Uds'),
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
                  const Divider(),
                  const SizedBox(height: 10),

                  // Observations
                  TextField(
                    controller: _obsController,
                    maxLines: 2,
                    decoration: InputDecoration(
                      labelText: 'Observaciones / Motivo',
                      hintText: !_allItemsChecked ? 'Obligatorio si hay incidencias' : 'Opcional',
                      border: const OutlineInputBorder(),
                      filled: true,
                      fillColor: Colors.grey[50],
                    ),
                    onChanged: (v) => setState((){}),
                  ),
                ],
              ),
            ),

          // Footer Actions
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              border: Border(top: BorderSide(color: Colors.grey.shade200))
            ),
            child: SizedBox(
               width: double.infinity,
               child: ElevatedButton(
                 style: ElevatedButton.styleFrom(
                   backgroundColor: _allItemsChecked ? Colors.green : Colors.orange,
                   padding: const EdgeInsets.symmetric(vertical: 16),
                 ),
                 onPressed: () {
                   if (!_allItemsChecked && _obsController.text.trim().isEmpty) {
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                        content: Text('Debe indicar motivo si desmarca artículos'),
                        backgroundColor: Colors.red,
                      ));
                      return;
                   }
                   // Logic to complete...
                   Navigator.pop(context);
                 },
                 child: Text(
                   _allItemsChecked ? 'CONFIRMAR ENTREGA' : 'REGISTRAR INCIDENCIA',
                   style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white),
                 ),
               ),
            ),
          )
        ],
      ),
    );
  }
}
