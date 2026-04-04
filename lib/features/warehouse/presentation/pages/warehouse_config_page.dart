/// WAREHOUSE CONFIG PAGE — Global config key-value editor
/// Reads/writes from ALMACEN_CONFIG_GLOBAL via /warehouse/config

import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../data/warehouse_data_service.dart';

class WarehouseConfigPage extends StatefulWidget {
  const WarehouseConfigPage({super.key});

  @override
  State<WarehouseConfigPage> createState() => _WarehouseConfigPageState();
}

class _WarehouseConfigPageState extends State<WarehouseConfigPage> {
  Map<String, String> _config = {};
  bool _loading = true;
  String? _error;
  bool _seeding = false;

  // Labels and descriptions for known config keys
  static const _labels = <String, String>{
    'MAX_ALTURA_APILADO_CM': 'Altura max apilado (cm)',
    'MARGEN_LATERAL_CM': 'Margen lateral (cm)',
    'EQUILIBRIO_EJES': 'Equilibrio de ejes',
    'PCT_MAX_EJE_TRASERO': 'Max peso eje trasero (%)',
    'HUECO_ENTRE_CAJAS_CM': 'Hueco entre cajas (cm)',
    'PRIORIDAD_OPTIMIZAR': 'Prioridad optimizar',
    'MUST_DELIVER_SIEMPRE': 'Must-deliver siempre',
    'TOLERANCIA_GLOBAL_PCT': 'Tolerancia global (%)',
    'RESERVA_RETORNOS_PCT': 'Reserva retornos (%)',
  };

  static const _descriptions = <String, String>{
    'MAX_ALTURA_APILADO_CM':
        'Altura maxima a la que se pueden apilar cajas',
    'MARGEN_LATERAL_CM':
        'Espacio minimo entre cajas y paredes laterales',
    'EQUILIBRIO_EJES':
        'Activar/desactivar calculo de equilibrio de ejes',
    'PCT_MAX_EJE_TRASERO':
        'Porcentaje maximo de peso en el eje trasero',
    'HUECO_ENTRE_CAJAS_CM':
        'Espacio entre cajas para facilitar la carga/descarga',
    'PRIORIDAD_OPTIMIZAR':
        'Criterio de optimizacion: MARGEN, VOLUMEN o PESO',
    'MUST_DELIVER_SIEMPRE':
        'Pedidos must-deliver siempre se cargan primero',
    'TOLERANCIA_GLOBAL_PCT':
        'Porcentaje de tolerancia sobre la capacidad maxima',
    'RESERVA_RETORNOS_PCT':
        'Porcentaje de espacio reservado para retornos',
  };

  @override
  void initState() {
    super.initState();
    _loadConfig();
  }

  Future<void> _loadConfig() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final config = await WarehouseDataService.getConfig();
      if (mounted) {
        setState(() {
          _config = config;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    }
  }

  Future<void> _seedDefaults() async {
    setState(() => _seeding = true);
    try {
      await WarehouseDataService.seedConfig();
      await _loadConfig();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error: $e'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _seeding = false);
    }
  }

  Future<void> _editConfigValue(String key, String currentValue) async {
    final controller = TextEditingController(text: currentValue);
    final label = _labels[key] ?? key;
    final desc = _descriptions[key];

    final newValue = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.darkCard,
        title: Text(
          label,
          style: const TextStyle(color: Colors.white, fontSize: 16),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (desc != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(
                  desc,
                  style: const TextStyle(
                    color: Colors.white38,
                    fontSize: 12,
                  ),
                ),
              ),
            TextField(
              controller: controller,
              autofocus: true,
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                labelText: 'Valor',
                labelStyle: const TextStyle(color: Colors.white38),
                enabledBorder: OutlineInputBorder(
                  borderSide: BorderSide(
                    color: AppTheme.neonBlue.withValues(alpha: 0.3),
                  ),
                  borderRadius: BorderRadius.circular(8),
                ),
                focusedBorder: OutlineInputBorder(
                  borderSide: const BorderSide(color: AppTheme.neonBlue),
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text(
              'Cancelar',
              style: TextStyle(color: Colors.white38),
            ),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, controller.text),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.neonBlue.withValues(alpha: 0.2),
              foregroundColor: AppTheme.neonBlue,
            ),
            child: const Text('Guardar'),
          ),
        ],
      ),
    );

    if (newValue != null && newValue != currentValue) {
      try {
        await WarehouseDataService.updateConfig(
          key: key,
          value: newValue,
        );
        setState(() => _config[key] = newValue);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('$label actualizado'),
              backgroundColor: AppTheme.neonGreen.withValues(alpha: 0.8),
              duration: const Duration(seconds: 1),
            ),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Error: $e'),
              backgroundColor: Colors.redAccent,
            ),
          );
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      appBar: AppBar(
        backgroundColor: AppTheme.darkBase,
        elevation: 0,
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'CONFIGURACION',
              style: TextStyle(
                color: AppTheme.neonBlue,
                fontSize: 14,
                fontWeight: FontWeight.w800,
                letterSpacing: 1.5,
              ),
            ),
            Text(
              'Parametros globales del almacen',
              style: TextStyle(color: Colors.white38, fontSize: 11),
            ),
          ],
        ),
        actions: [
          IconButton(
            onPressed: _loadConfig,
            icon: const Icon(
              Icons.refresh_rounded,
              color: AppTheme.neonGreen,
            ),
          ),
        ],
      ),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: AppTheme.neonBlue),
            )
          : _error != null
              ? _buildError()
              : _buildContent(),
    );
  }

  Widget _buildContent() {
    if (_config.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.settings_rounded,
              color: Colors.white24,
              size: 48,
            ),
            const SizedBox(height: 12),
            const Text(
              'No hay configuracion guardada',
              style: TextStyle(color: Colors.white38, fontSize: 14),
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: _seeding ? null : _seedDefaults,
              icon: _seeding
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppTheme.neonGreen,
                      ),
                    )
                  : const Icon(Icons.auto_fix_high_rounded),
              label: Text(
                _seeding ? 'Generando...' : 'Generar valores por defecto',
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.neonGreen.withValues(alpha: 0.15),
                foregroundColor: AppTheme.neonGreen,
                padding: const EdgeInsets.symmetric(
                  horizontal: 24,
                  vertical: 12,
                ),
              ),
            ),
          ],
        ),
      );
    }

    final keys = _config.keys.toList()..sort();
    return ListView.builder(
      padding: const EdgeInsets.all(12),
      itemCount: keys.length + 1, // +1 for seed button at bottom
      itemBuilder: (_, i) {
        if (i == keys.length) {
          return Padding(
            padding: const EdgeInsets.only(top: 16),
            child: Center(
              child: TextButton.icon(
                onPressed: _seeding ? null : _seedDefaults,
                icon: const Icon(Icons.refresh_rounded, size: 16),
                label: const Text('Restablecer valores por defecto'),
                style: TextButton.styleFrom(
                  foregroundColor: Colors.white30,
                ),
              ),
            ),
          );
        }

        final key = keys[i];
        final value = _config[key] ?? '';
        final label = _labels[key] ?? key;
        final desc = _descriptions[key];

        return Container(
          margin: const EdgeInsets.only(bottom: 6),
          decoration: BoxDecoration(
            color: AppTheme.darkCard,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: AppTheme.neonBlue.withValues(alpha: 0.08),
            ),
          ),
          child: ListTile(
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 14,
              vertical: 4,
            ),
            title: Text(
              label,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            subtitle: desc != null
                ? Text(
                    desc,
                    style: const TextStyle(
                      color: Colors.white24,
                      fontSize: 10,
                    ),
                  )
                : null,
            trailing: Container(
              padding: const EdgeInsets.symmetric(
                horizontal: 12,
                vertical: 6,
              ),
              decoration: BoxDecoration(
                color: AppTheme.neonBlue.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                value,
                style: const TextStyle(
                  color: AppTheme.neonBlue,
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            onTap: () => _editConfigValue(key, value),
          ),
        );
      },
    );
  }

  Widget _buildError() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.error_outline_rounded,
            color: Colors.redAccent,
            size: 48,
          ),
          const SizedBox(height: 12),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Text(
              _error ?? 'Error',
              style: const TextStyle(color: Colors.white70, fontSize: 14),
              textAlign: TextAlign.center,
            ),
          ),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            onPressed: _loadConfig,
            icon: const Icon(Icons.refresh, size: 18),
            label: const Text('Reintentar'),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.neonBlue.withValues(alpha: 0.2),
              foregroundColor: AppTheme.neonBlue,
            ),
          ),
        ],
      ),
    );
  }
}
