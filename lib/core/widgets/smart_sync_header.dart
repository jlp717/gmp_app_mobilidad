import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import 'package:intl/intl.dart';

/// A smart header that shows sync status and allows manual refresh
/// Designed to be placed "just above" the content in a line-style
class SmartSyncHeader extends StatelessWidget {
  final DateTime? lastSync;
  final bool isLoading;
  final VoidCallback onSync;
  final String? error;

  const SmartSyncHeader({
    super.key,
    required this.lastSync,
    required this.isLoading,
    required this.onSync,
    this.error,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: AppTheme.darkBase.withOpacity(0.5),
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
      child: Row(
        children: [
          // Status Icon
          if (isLoading)
            const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.neonBlue),
            )
          else if (error != null)
            const Icon(Icons.cloud_off, color: AppTheme.error, size: 16)
          else
            const Icon(Icons.cloud_done, color: AppTheme.neonGreen, size: 16),
            
          const SizedBox(width: 8),
          
          // Status Text
          Expanded(
            child: Text(
              _getStatusText(),
              style: TextStyle(
                color: error != null ? AppTheme.error : Colors.white70,
                fontSize: 12,
                fontFamily: 'Roboto',
              ),
            ),
          ),
          
          // Refresh Action (only if not loading)
          if (!isLoading)
            InkWell(
              onTap: onSync,
              borderRadius: BorderRadius.circular(12),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  border: Border.all(color: AppTheme.neonBlue.withOpacity(0.5)),
                  borderRadius: BorderRadius.circular(12),
                  color: AppTheme.neonBlue.withOpacity(0.1),
                ),
                child: const Text('Sincronizar', style: TextStyle(color: AppTheme.neonBlue, fontSize: 10, fontWeight: FontWeight.bold)),
              ),
            ),
        ],
      ),
    );
  }

  String _getStatusText() {
    if (isLoading) return 'Sincronizando datos...';
    if (error != null) return 'Error de conexión';
    if (lastSync == null) return 'Datos no sincronizados';
    
    final now = DateTime.now();
    final diff = now.difference(lastSync!);
    
    if (diff.inMinutes < 1) return 'Datos actualizados hace un momento';
    if (diff.inMinutes < 60) return 'Actualizado hace ${diff.inMinutes} min';
    if (diff.inHours < 24) return 'Actualizado hace ${diff.inHours} horas';
    
    final fmt = DateFormat('dd/MM HH:mm');
    return 'Última sinc: ${fmt.format(lastSync!)}';
  }
}
