import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/api/api_client.dart';

/// Widget de selección de día destino para mover cliente
/// Excluye Domingo de las opciones
class DaySelectorDialog extends StatelessWidget {
  final String currentDay;
  final String clientName;
  final String clientCode;

  const DaySelectorDialog({
    super.key,
    required this.currentDay,
    required this.clientName,
    required this.clientCode,
  });

  static const Map<String, String> dayLabels = {
    'lunes': 'Lunes',
    'martes': 'Martes',
    'miercoles': 'Miércoles',
    'jueves': 'Jueves',
    'viernes': 'Viernes',
    'sabado': 'Sábado',
  };

  static const Map<String, IconData> dayIcons = {
    'lunes': Icons.looks_one,
    'martes': Icons.looks_two,
    'miercoles': Icons.looks_3,
    'jueves': Icons.looks_4,
    'viernes': Icons.looks_5,
    'sabado': Icons.looks_6,
  };

  @override
  Widget build(BuildContext context) {
    // Días disponibles: todos menos Domingo y el día actual
    final availableDays = dayLabels.keys
        .where((d) => d != currentDay.toLowerCase())
        .toList();

    return AlertDialog(
      backgroundColor: AppTheme.surfaceColor,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.swap_horiz, color: AppTheme.neonBlue),
              const SizedBox(width: 8),
              const Text('Mover a otro día'),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            clientName,
            style: TextStyle(fontSize: 14, color: AppTheme.textSecondary),
          ),
          Text(
            'Código: $clientCode',
            style: TextStyle(fontSize: 12, color: AppTheme.textSecondary.withOpacity(0.7)),
          ),
        ],
      ),
      content: SizedBox(
        width: double.maxFinite,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Info: Domingo no disponible
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppTheme.warning.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppTheme.warning.withOpacity(0.3)),
              ),
              child: Row(
                children: [
                  Icon(Icons.info_outline, color: AppTheme.warning, size: 18),
                  const SizedBox(width: 8),
                  const Expanded(
                    child: Text(
                      'El Domingo no está disponible como día de visita.',
                      style: TextStyle(fontSize: 12),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'Selecciona el día destino:',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
            ),
            const SizedBox(height: 12),
            ...availableDays.map((day) => _DayOption(
              day: day,
              label: dayLabels[day] ?? day,
              icon: dayIcons[day] ?? Icons.calendar_today,
              onTap: () => Navigator.pop(context, day),
            )),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancelar', style: TextStyle(color: Colors.grey)),
        ),
      ],
    );
  }
}

class _DayOption extends StatelessWidget {
  final String day;
  final String label;
  final IconData icon;
  final VoidCallback onTap;

  const _DayOption({
    required this.day,
    required this.label,
    required this.icon,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: AppTheme.darkSurface,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(8),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              children: [
                Icon(icon, color: AppTheme.neonBlue, size: 24),
                const SizedBox(width: 12),
                Text(
                  label.toUpperCase(),
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
                const Spacer(),
                const Icon(Icons.arrow_forward_ios, size: 16, color: Colors.grey),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Widget de selección de posición en el día destino
class PositionSelectorDialog extends StatefulWidget {
  final String targetDay;
  final String vendorCode;
  final String role;
  final String clientName;

  const PositionSelectorDialog({
    super.key,
    required this.targetDay,
    required this.vendorCode,
    required this.role,
    required this.clientName,
  });

  @override
  State<PositionSelectorDialog> createState() => _PositionSelectorDialogState();
}

class _PositionSelectorDialogState extends State<PositionSelectorDialog> {
  bool _isLoading = true;
  int _totalClients = 0;
  String _selectedPosition = 'end'; // 'start', 'end', or number string

  @override
  void initState() {
    super.initState();
    _loadPositions();
  }

  Future<void> _loadPositions() async {
    try {
      final response = await ApiClient.get(
        '/rutero/positions/${widget.targetDay}',
        queryParameters: {
          'vendedorCodes': widget.vendorCode,
          'role': widget.role,
        },
      );
      
      if (mounted) {
        setState(() {
          _totalClients = (response['count'] as int?) ?? 0;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: AppTheme.surfaceColor,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: Row(
        children: [
          Icon(Icons.format_list_numbered, color: AppTheme.neonPink),
          const SizedBox(width: 8),
          const Expanded(child: Text('Posición en la ruta')),
        ],
      ),
      content: _isLoading
          ? const SizedBox(
              height: 100,
              child: Center(child: CircularProgressIndicator()),
            )
          : Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'El ${_getDayLabel(widget.targetDay)} tiene $_totalClients cliente(s).',
                  style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                ),
                const SizedBox(height: 16),
                const Text(
                  '¿Dónde quieres insertar a ${''} ?',
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 12),
                _PositionOption(
                  label: 'Al inicio de la ruta',
                  subtitle: 'Será el primer cliente a visitar',
                  icon: Icons.vertical_align_top,
                  isSelected: _selectedPosition == 'start',
                  onTap: () => setState(() => _selectedPosition = 'start'),
                ),
                _PositionOption(
                  label: 'Al final de la ruta',
                  subtitle: 'Será el último cliente a visitar',
                  icon: Icons.vertical_align_bottom,
                  isSelected: _selectedPosition == 'end',
                  onTap: () => setState(() => _selectedPosition = 'end'),
                ),
                if (_totalClients > 1)
                  _PositionOption(
                    label: 'Elegir posición específica',
                    subtitle: 'Seleccionar número del 1 al ${_totalClients + 1}',
                    icon: Icons.pin_drop,
                    isSelected: _selectedPosition != 'start' && _selectedPosition != 'end',
                    onTap: () => _showPositionPicker(),
                  ),
              ],
            ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancelar', style: TextStyle(color: Colors.grey)),
        ),
        ElevatedButton(
          onPressed: () => Navigator.pop(context, _selectedPosition),
          style: ElevatedButton.styleFrom(backgroundColor: AppTheme.neonPink),
          child: const Text('Continuar'),
        ),
      ],
    );
  }

  String _getDayLabel(String day) {
    const labels = {
      'lunes': 'Lunes',
      'martes': 'Martes',
      'miercoles': 'Miércoles',
      'jueves': 'Jueves',
      'viernes': 'Viernes',
      'sabado': 'Sábado',
    };
    return labels[day.toLowerCase()] ?? day;
  }

  Future<void> _showPositionPicker() async {
    final result = await showDialog<int>(
      context: context,
      builder: (ctx) => _NumberPickerDialog(
        max: _totalClients + 1,
        initialValue: 1,
      ),
    );
    
    if (result != null && mounted) {
      setState(() => _selectedPosition = result.toString());
    }
  }
}

class _PositionOption extends StatelessWidget {
  final String label;
  final String subtitle;
  final IconData icon;
  final bool isSelected;
  final VoidCallback onTap;

  const _PositionOption({
    required this.label,
    required this.subtitle,
    required this.icon,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: isSelected ? AppTheme.neonPink.withOpacity(0.1) : AppTheme.darkSurface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: isSelected ? AppTheme.neonPink : Colors.transparent,
          width: 2,
        ),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Icon(icon, color: isSelected ? AppTheme.neonPink : Colors.grey, size: 24),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        color: isSelected ? AppTheme.neonPink : Colors.white,
                      ),
                    ),
                    Text(
                      subtitle,
                      style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                    ),
                  ],
                ),
              ),
              if (isSelected)
                Icon(Icons.check_circle, color: AppTheme.neonPink, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}

class _NumberPickerDialog extends StatefulWidget {
  final int max;
  final int initialValue;

  const _NumberPickerDialog({
    required this.max,
    required this.initialValue,
  });

  @override
  State<_NumberPickerDialog> createState() => _NumberPickerDialogState();
}

class _NumberPickerDialogState extends State<_NumberPickerDialog> {
  late int _value;
  late TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _value = widget.initialValue;
    _controller = TextEditingController(text: _value.toString());
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: AppTheme.surfaceColor,
      title: const Text('Seleccionar posición'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('Elige una posición del 1 al ${widget.max}'),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              IconButton(
                onPressed: _value > 1 ? () => setState(() {
                  _value--;
                  _controller.text = _value.toString();
                }) : null,
                icon: const Icon(Icons.remove_circle),
                color: AppTheme.neonBlue,
              ),
              SizedBox(
                width: 60,
                child: TextField(
                  controller: _controller,
                  keyboardType: TextInputType.number,
                  textAlign: TextAlign.center,
                  decoration: const InputDecoration(
                    border: OutlineInputBorder(),
                    contentPadding: EdgeInsets.symmetric(vertical: 8),
                  ),
                  onChanged: (val) {
                    final n = int.tryParse(val);
                    if (n != null && n >= 1 && n <= widget.max) {
                      setState(() => _value = n);
                    }
                  },
                ),
              ),
              IconButton(
                onPressed: _value < widget.max ? () => setState(() {
                  _value++;
                  _controller.text = _value.toString();
                }) : null,
                icon: const Icon(Icons.add_circle),
                color: AppTheme.neonBlue,
              ),
            ],
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancelar', style: TextStyle(color: Colors.grey)),
        ),
        ElevatedButton(
          onPressed: () => Navigator.pop(context, _value),
          style: ElevatedButton.styleFrom(backgroundColor: AppTheme.neonPink),
          child: const Text('Seleccionar'),
        ),
      ],
    );
  }
}

/// Modal de confirmación final para mover cliente
class MoveConfirmationDialog extends StatelessWidget {
  final String clientName;
  final String clientCode;
  final String fromDay;
  final String toDay;
  final String position;

  const MoveConfirmationDialog({
    super.key,
    required this.clientName,
    required this.clientCode,
    required this.fromDay,
    required this.toDay,
    required this.position,
  });

  String _getDayLabel(String day) {
    const labels = {
      'lunes': 'LUNES',
      'martes': 'MARTES',
      'miercoles': 'MIÉRCOLES',
      'jueves': 'JUEVES',
      'viernes': 'VIERNES',
      'sabado': 'SÁBADO',
    };
    return labels[day.toLowerCase()] ?? day.toUpperCase();
  }

  String _getPositionLabel(String pos) {
    if (pos == 'start') return 'al inicio';
    if (pos == 'end') return 'al final';
    return 'en posición $pos';
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: AppTheme.surfaceColor,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: Row(
        children: [
          Icon(Icons.warning_amber_rounded, color: AppTheme.warning, size: 28),
          const SizedBox(width: 8),
          const Text('Confirmar movimiento'),
        ],
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppTheme.darkBase,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              children: [
                // Client info
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: AppTheme.neonBlue.withOpacity(0.2),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(Icons.person, color: AppTheme.neonBlue, size: 20),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            clientName,
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                          ),
                          Text(
                            clientCode,
                            style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                const Divider(height: 1),
                const SizedBox(height: 16),
                // Movement visualization
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        children: [
                          const Text('DE', style: TextStyle(fontSize: 10, color: Colors.grey)),
                          const SizedBox(height: 4),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                            decoration: BoxDecoration(
                              color: AppTheme.error.withOpacity(0.2),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              _getDayLabel(fromDay),
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                color: AppTheme.error,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    Icon(Icons.arrow_forward, color: AppTheme.neonPink, size: 28),
                    Expanded(
                      child: Column(
                        children: [
                          const Text('A', style: TextStyle(fontSize: 10, color: Colors.grey)),
                          const SizedBox(height: 4),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                            decoration: BoxDecoration(
                              color: AppTheme.success.withOpacity(0.2),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              _getDayLabel(toDay),
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                color: AppTheme.success,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Text(
                  'Se insertará ${_getPositionLabel(position)}',
                  style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Text(
            '⚠️ Este cambio se aplicará de forma permanente.',
            style: TextStyle(
              fontSize: 12,
              color: AppTheme.warning,
              fontStyle: FontStyle.italic,
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('Cancelar', style: TextStyle(color: Colors.grey)),
        ),
        ElevatedButton.icon(
          onPressed: () => Navigator.pop(context, true),
          style: ElevatedButton.styleFrom(backgroundColor: AppTheme.neonPink),
          icon: const Icon(Icons.check, size: 18),
          label: const Text('Confirmar y Guardar'),
        ),
      ],
    );
  }
}

/// Modal de confirmación para guardar el nuevo orden (reordenamiento)
class ReorderConfirmationDialog extends StatelessWidget {
  final int changesCount;
  final String day;

  const ReorderConfirmationDialog({
    super.key,
    required this.changesCount,
    required this.day,
  });

  String _getDayLabel(String day) {
    const labels = {
      'lunes': 'Lunes',
      'martes': 'Martes',
      'miercoles': 'Miércoles',
      'jueves': 'Jueves',
      'viernes': 'Viernes',
      'sabado': 'Sábado',
    };
    return labels[day.toLowerCase()] ?? day;
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: AppTheme.surfaceColor,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: Row(
        children: [
          Icon(Icons.save, color: AppTheme.neonBlue, size: 28),
          const SizedBox(width: 8),
          const Text('Guardar orden'),
        ],
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.format_list_numbered,
            size: 48,
            color: AppTheme.neonPink.withOpacity(0.5),
          ),
          const SizedBox(height: 16),
          Text(
            '¿Guardar el nuevo orden para ${_getDayLabel(day)}?',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 16),
          ),
          const SizedBox(height: 8),
          Text(
            '$changesCount cliente(s) en la ruta',
            style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppTheme.warning.withOpacity(0.1),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              children: [
                Icon(Icons.info_outline, color: AppTheme.warning, size: 18),
                const SizedBox(width: 8),
                const Expanded(
                  child: Text(
                    'El orden afectará a tus visitas programadas.',
                    style: TextStyle(fontSize: 12),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('Cancelar', style: TextStyle(color: Colors.grey)),
        ),
        ElevatedButton.icon(
          onPressed: () => Navigator.pop(context, true),
          style: ElevatedButton.styleFrom(backgroundColor: AppTheme.neonPink),
          icon: const Icon(Icons.save, size: 18),
          label: const Text('Guardar'),
        ),
      ],
    );
  }
}
