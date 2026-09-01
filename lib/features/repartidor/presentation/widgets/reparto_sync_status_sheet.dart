// ignore_for_file: public_member_api_docs

import 'package:flutter/material.dart';

import 'package:gmp_app_mobilidad/core/offline/sync_queue_service.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';

/// Bottom sheet listing pending / failed offline sync operations for the
/// repartidor route: attempt counts, truncated last errors, retry and
/// manual-review actions. Four states: loading, empty, error, offline.
class RepartoSyncStatusSheet extends StatefulWidget {
  const RepartoSyncStatusSheet({super.key});

  @override
  State<RepartoSyncStatusSheet> createState() => _RepartoSyncStatusSheetState();
}

class _RepartoSyncStatusSheetState extends State<RepartoSyncStatusSheet> {
  List<SyncOperation> _pending = const <SyncOperation>[];
  List<SyncOperation> _failed = const <SyncOperation>[];
  bool _loading = true;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final pending = SyncQueueService.instance.pending;
      final failed = SyncQueueService.instance.failed;
      if (!mounted) return;
      setState(() {
        _pending = pending;
        _failed = failed;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  Future<void> _retryOperation(SyncOperation operation) async {
    await SyncQueueService.instance.retryManual(operation);
    await _reload();
  }

  @override
  Widget build(BuildContext context) {
    final title = Text(
      'Sincronización pendiente',
      style: Theme.of(context).textTheme.titleLarge,
    );

    if (_loading) {
      return Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            title,
            const SizedBox(height: 24),
            const CircularProgressIndicator(),
          ],
        ),
      );
    }

    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            title,
            const SizedBox(height: 24),
            const Icon(Icons.error_outline, color: AppColors.error, size: 48),
            const SizedBox(height: 16),
            const Text(
              'No se pudo leer la cola de sincronización. Inténtalo de nuevo.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: _reload,
              icon: const Icon(Icons.refresh),
              label: const Text('Reintentar'),
            ),
          ],
        ),
      );
    }

    if (_pending.isEmpty && _failed.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            title,
            const SizedBox(height: 24),
            const Icon(Icons.cloud_done, color: AppColors.success, size: 48),
            const SizedBox(height: 16),
            const Text(
              'Todo sincronizado. No hay operaciones pendientes.',
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
    }

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            title,
            const SizedBox(height: 8),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: <Widget>[
                  for (final operation in _pending)
                    _SyncOperationTile(
                      operation: operation,
                      onRetry: operation.isFailed
                          ? () => _retryOperation(operation)
                          : null,
                    ),
                  for (final operation in _failed)
                    _SyncOperationTile(
                      operation: operation,
                      onRetry: () => _retryOperation(operation),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SyncOperationTile extends StatelessWidget {
  const _SyncOperationTile({
    required this.operation,
    required this.onRetry,
  });

  final SyncOperation operation;
  final VoidCallback? onRetry;

  static const Map<String, String> _typeLabels = <String, String>{
    'confirm_delivery': 'Confirmación de entrega',
    'create_cobro': 'Registro de cobro',
    'mutation': 'Operación',
  };

  String get _label =>
      _typeLabels[operation.type] ?? 'Operación (${operation.type})';

  String get _subtitle {
    final deliveryId = operation.payload['delivery'] is Map
        ? (operation.payload['delivery'] as Map)['itemId']?.toString()
        : operation.payload['itemId']?.toString();
    final parts = <String>[
      if (deliveryId != null && deliveryId.isNotEmpty) deliveryId,
      'intentos: ${operation.attempts}',
      if (operation.lastError != null)
        (operation.lastError!.length <= 120
            ? operation.lastError!
            : operation.lastError!.substring(0, 120)),
    ];
    return parts.join(' · ');
  }

  @override
  Widget build(BuildContext context) {
    final failed = operation.isFailed;
    return Semantics(
      label: '$_label, ${failed ? 'requiere revisión' : 'pendiente'}',
      child: ListTile(
        leading: Icon(
          failed ? Icons.error_outline : Icons.cloud_upload_outlined,
          color: failed ? AppColors.error : AppColors.warning,
        ),
        title: Text(_label),
        subtitle: Text(
          _subtitle,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        isThreeLine: true,
        trailing: onRetry == null
            ? null
            : TextButton(
                onPressed: onRetry,
                child: const Text('Reintentar'),
              ),
      ),
    );
  }
}
