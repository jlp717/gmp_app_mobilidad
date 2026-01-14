import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import 'package:signature/signature.dart';
import 'dart:convert';
import 'dart:typed_data';
import '../../../../core/providers/auth_provider.dart';
import '../../../../core/providers/filter_provider.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/smart_sync_header.dart';
import '../../../entregas/providers/entregas_provider.dart';
import '../../../../core/api/api_client.dart';

// Imports cleaned up
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

  // Removing didChangeDependencies manual check in favor of Consumer in build or listener
  // Actually, keeping strict listener is good, but let's make it robust.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // We rely on the build method's Consumer/Watch to trigger updates if we structure it right,
    // but here we need to trigger a FETCH.
    final auth = Provider.of<AuthProvider>(context, listen: false); // Role doesn't change often
    final filter = Provider.of<FilterProvider>(context, listen: true); // Listen to filter!
    
    String targetId = widget.repartidorId ?? auth.currentUser?.code ?? '';
    if (auth.isDirector && filter.selectedVendor != null) {
      targetId = filter.selectedVendor!;
    }

    if (targetId.isNotEmpty && targetId != _lastLoadedId) {
       // Debounce or immediate? Immediate is fine.
       // We must defer state change/async call
       WidgetsBinding.instance.addPostFrameCallback((_) {
         if (mounted) {
           _lastLoadedId = targetId; 
           _loadData(); // This will use the new targetId
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
      // Update local state to match effective target
      if (_lastLoadedId != targetId) {
        _lastLoadedId = targetId;
      }
      
      entregas.setRepartidor(targetId);
      entregas.seleccionarFecha(_selectedDate); 
      _loadWeekData(targetId);
    }
  }

  Future<void> _loadWeekData(String repartidorId) async {
    if (_isLoadingWeek) return;
    if (mounted) setState(() => _isLoadingWeek = true);

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
    // Listen to Providers to trigger rebuilds
    final auth = Provider.of<AuthProvider>(context); 
    final filter = Provider.of<FilterProvider>(context);
    final entregas = Provider.of<EntregasProvider>(context);

    // Header Name Logic
    String currentName = auth.currentUser?.name ?? 'Repartidor';
    if (auth.isDirector && filter.selectedVendor != null) {
      currentName = 'Repartidor ${filter.selectedVendor}';
    }

    return Scaffold(
      backgroundColor: AppTheme.darkBase,
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
      color: AppTheme.surfaceColor, 
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
    // "Stapled" visual effect variables
    final bool isPendiente = albaran.estado == EstadoEntrega.pendiente;
    final bool isEntregado = albaran.estado == EstadoEntrega.entregado;
    final Color statusColor = isEntregado ? AppTheme.success : (isPendiente ? AppTheme.error : Colors.orange);

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      // Stack for the "Stapled" effect
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          // Background "Invoice" Card (The paper behind)
          Positioned(
            top: -4,
            left: 4,
            right: -4,
            bottom: 4,
            child: Container(
              decoration: BoxDecoration(
                color: const Color(0xFFF5F5F5), // Light paper color
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.grey.shade300),
              ),
              child: const Align(
                alignment: Alignment.topRight,
                child: Padding(
                  padding: EdgeInsets.all(8.0),
                  child: Icon(Icons.receipt_long, color: Colors.grey, size: 20),
                ),
              ),
            ),
          ),
          
          // Main "Albaran" Card
          Card(
            margin: EdgeInsets.zero,
            elevation: 4,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            color: AppTheme.darkSurface, // Keep dark theme consistent
            child: InkWell(
              onTap: () {
                 if (isEntregado) {
                   _showEditConfirmation(albaran);
                 } else {
                   _showDetailDialog(albaran);
                 }
              },
              borderRadius: BorderRadius.circular(12),
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Header: ID and Amount
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Left: ID & Label
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: AppTheme.darkBase,
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(color: Colors.grey.withOpacity(0.3)),
                              ),
                              child: Text(
                                'ALB #${albaran.numeroAlbaran}',
                                style: const TextStyle(
                                  color: AppTheme.textSecondary,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 12,
                                ),
                              ),
                            ),
                            const SizedBox(height: 4),
                            // Staple Visual (Icon)
                            RotationTransition(
                              turns: const AlwaysStoppedAnimation(-0.1),
                              child: Icon(Icons.attach_file, color: Colors.grey.shade400, size: 18),
                            ),
                          ],
                        ),
                        
                        // Right: Amount (Big & Bold)
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              NumberFormat.currency(symbol: '€', locale: 'es_ES').format(albaran.importeTotal),
                              style: TextStyle(
                                color: statusColor, // Green or Red
                                fontSize: 22,
                                fontWeight: FontWeight.bold,
                                letterSpacing: -0.5,
                              ),
                            ),
                            if (isPendiente)
                              Tooltip(
                                message: "Estado basado en gestión interna de DSEDAC",
                                triggerMode: TooltipTriggerMode.tap,
                                child: Row(
                                  children: [
                                    Icon(Icons.info_outline, size: 14, color: AppTheme.textSecondary),
                                    const SizedBox(width: 4),
                                    Text(
                                      "PENDIENTE",
                                      style: TextStyle(
                                        color: AppTheme.textSecondary,
                                        fontSize: 10,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                          ],
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    
                     // Client Info
                    Text(
                      albaran.nombreCliente,
                      style: const TextStyle(
                        fontFamily: 'Outfit',
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                        color: AppTheme.textPrimary,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                         Icon(Icons.location_on_outlined, size: 14, color: AppTheme.textSecondary),
                         const SizedBox(width: 4),
                         Expanded(
                           child: Text(
                             "${albaran.direccion}, ${albaran.poblacion}",
                             style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                             maxLines: 1,
                             overflow: TextOverflow.ellipsis,
                           ),
                         ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _showEditConfirmation(AlbaranEntrega albaran) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.darkSurface,
        title: const Text('⚠️ Albarán ya entregado', style: TextStyle(color: AppTheme.textPrimary)),
        content: const Text(
          'Este albarán ya ha sido confirmado y firmado.\n¿Estás seguro de que quieres editarlo? Esto podría afectar a los registros.',
          style: TextStyle(color: AppTheme.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancelar'),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              _showDetailDialog(albaran);
            },
            child: const Text('Sí, Editar', style: TextStyle(color: AppTheme.error)),
          ),
        ],
      ),
    );
  }

  void _showDetailDialog(AlbaranEntrega albaran) {
    final entregasProvider = Provider.of<EntregasProvider>(context, listen: false);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent, // Important for custom border radius
      builder: (context) => ChangeNotifierProvider.value(
        value: entregasProvider,
        child: _DetailSheet(albaran: albaran),
      ),
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
  Map<String, bool> _checkedItems = {}; 
  final TextEditingController _obsController = TextEditingController();
  
  // SIGNATURE
  final SignatureController _sigController = SignatureController(
    penStrokeWidth: 3,
    penColor: Colors.white,
    exportBackgroundColor: Colors.transparent,
  );
  bool _showSignaturePad = false;

  @override
  void initState() {
    super.initState();
    _loadDetails();
  }

  @override
  void dispose() {
    _obsController.dispose();
    _sigController.dispose();
    super.dispose();
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
             // Default state: ALL UNCHECKED (User request)
             for(var i in _details.items) {
               _checkedItems[i.codigoArticulo] = false;
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

  bool get _allItemsChecked => _checkedItems.isNotEmpty && _checkedItems.values.every((v) => v);
  bool get _anyItemChecked => _checkedItems.values.any((v) => v);

  void _toggleAll(bool value) {
    setState(() {
      for (var k in _checkedItems.keys) {
        _checkedItems[k] = value;
      }
    });
  }

  Future<void> _submit() async {
     // Validate
     if (!_allItemsChecked && _obsController.text.trim().isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Debe indicar motivo si desmarca artículos'),
          backgroundColor: AppTheme.error,
        ));
        return;
     }

     if (_sigController.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('La firma es obligatoria'),
          backgroundColor: AppTheme.warning,
        ));
        setState(() => _showSignaturePad = true);
        return;
     }

     // Process
     try {
       // Get Signature
       final Uint8List? sigBytes = await _sigController.toPngBytes();
       if (sigBytes == null) return;
       final String base64Sig = base64Encode(sigBytes);
       final String obs = _obsController.text.trim();

       final provider = Provider.of<EntregasProvider>(context, listen: false);
       bool success = false;

       if (_allItemsChecked) {
         success = await provider.marcarEntregado(
           albaranId: widget.albaran.id,
           firma: base64Sig,
           observaciones: obs.isNotEmpty ? obs : null,
         );
       } else {
         success = await provider.marcarParcial(
           albaranId: widget.albaran.id,
           observaciones: obs,
           firma: base64Sig,
         );
       }
       
       if (mounted) {
         if (success) {
            Navigator.pop(context);
            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                content: Text('Entrega registrada correctamente'),
                backgroundColor: AppTheme.success,
            ));
            // Trigger refresh logic? The provider update should handle list state.
         } else {
            ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                content: Text('Error al guardar: ${provider.error ?? "Desconocido"}'),
                backgroundColor: AppTheme.error,
            ));
         }
       }
     } catch (e) {
       print(e);
       if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
              content: Text('Error: $e'),
              backgroundColor: AppTheme.error,
          ));
       }
     }
  }

  @override
  Widget build(BuildContext context) {
    // FIX: Using dark decoration to prevent white background
    return Container(
      height: MediaQuery.of(context).size.height * 0.9,
      decoration: const BoxDecoration(
        color: AppTheme.darkSurface, // Dark background
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        boxShadow: [BoxShadow(blurRadius: 20, color: Colors.black54)]
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
          
          if (_error.isNotEmpty) 
             Expanded(child: Center(child: Text(_error, style: const TextStyle(color: AppTheme.error)))),

          if (!_loading && _error.isEmpty)
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  // Info Card
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppTheme.neonBlue.withOpacity(0.05),
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
                  
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                       const Text('Artículos', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: AppTheme.textPrimary)),
                       Row(
                         children: [
                           TextButton(
                             onPressed: () => _toggleAll(true),
                             child: const Text('Todo', style: TextStyle(fontSize: 12, color: AppTheme.neonBlue)),
                           ),
                           TextButton(
                             onPressed: () => _toggleAll(false),
                             child: const Text('Nada', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                           ),
                         ],
                       )
                    ],
                  ),
                  const SizedBox(height: 8),

                  if (_details.items.isEmpty)
                    Container(
                      padding: const EdgeInsets.all(20),
                      alignment: Alignment.center,
                      child: const Column(
                        children: [
                           Icon(Icons.inbox, color: AppTheme.textTertiary, size: 40),
                           SizedBox(height: 8),
                           Text('No hay artículos listados', style: TextStyle(color: AppTheme.textTertiary)),
                        ],
                      ),
                    ),

                  ..._details.items.map((item) {
                    final isChecked = _checkedItems[item.codigoArticulo] ?? false;
                    // Determine unit: Backend 'unit' (e.g. 'UNIDAD') -> Friendly (e.g. 'Uds')
                    // Assuming backend sends 'UNIT' in model, but if not updated in AlbaranItem model yet, might need to update model too.
                    // Checking existing model usage... 'cantidadPedida' is used.
                    // Wait, I updated backend to return 'UNIT' as 'unit' column but likely need to update Flutter model `AlbaranItem`.
                    String uom = 'Uds';
                    if (item.unit != null && item.unit!.isNotEmpty) {
                        uom = item.unit!; 
                        if (uom == 'UNIDAD') uom = 'Uds';
                    }
                    
                    return Theme(
                      data: ThemeData(unselectedWidgetColor: AppTheme.textSecondary),
                      child: CheckboxListTile(
                        value: isChecked,
                        activeColor: AppTheme.neonBlue,
                        checkColor: AppTheme.darkBase,
                        title: Text(item.descripcion.isNotEmpty ? item.descripcion : 'Art. ${item.codigoArticulo}', style: const TextStyle(color: AppTheme.textPrimary)),
                        subtitle: Text('${item.cantidadPedida.toStringAsFixed(0)} $uom', style: const TextStyle(color: AppTheme.textSecondary)),
                        controlAffinity: ListTileControlAffinity.leading,
                        contentPadding: EdgeInsets.zero,
                        onChanged: (val) {
                          setState(() {
                            _checkedItems[item.codigoArticulo] = val ?? false;
                          });
                        },
                      ),
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
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: AppTheme.borderColor)),
                      filled: true,
                      fillColor: AppTheme.darkBase,
                    ),
                    style: const TextStyle(color: AppTheme.textPrimary),
                    onChanged: (v) => setState((){}),
                  ),

                  const SizedBox(height: 20),
                  
                  // SIGNATURE PADDLE
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Firma Cliente', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: AppTheme.textPrimary)),
                      if (_showSignaturePad)
                        TextButton(
                          onPressed: () => _sigController.clear(), 
                          child: const Text('Borrar', style: TextStyle(color: AppTheme.error))
                        )
                    ],
                  ),
                  
                  if (!_showSignaturePad)
                    InkWell(
                      onTap: () => setState(() => _showSignaturePad = true),
                      child: Container(
                        height: 100,
                        width: double.infinity,
                        decoration: BoxDecoration(
                          color: AppTheme.darkBase,
                          border: Border.all(color: AppTheme.borderColor),
                          borderRadius: BorderRadius.circular(8)
                        ),
                        child: const Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                             Icon(Icons.edit, color: AppTheme.textSecondary),
                             SizedBox(height: 8),
                             Text('Toque para firmar', style: TextStyle(color: AppTheme.textSecondary)),
                          ],
                        ),
                      ),
                    )
                  else
                    Container(
                      height: 200,
                      decoration: BoxDecoration(
                        color: AppTheme.darkBase,
                        border: Border.all(color: AppTheme.neonBlue),
                        borderRadius: BorderRadius.circular(8)
                      ),
                      child: Signature(
                        controller: _sigController,
                        backgroundColor: AppTheme.darkBase,
                        width: MediaQuery.of(context).size.width - 64, // Estimate width
                        height: 198,
                      ),
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
                 onPressed: _submit,
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
