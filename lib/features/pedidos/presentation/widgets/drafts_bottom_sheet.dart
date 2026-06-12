/// Drafts Bottom Sheet
/// ===================
/// Shows saved order drafts with load/delete options
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/pedidos/providers/pedidos_provider.dart';

class DraftsBottomSheet {
  static Future<void> show(
    BuildContext context,
    WidgetRef ref, {
    required PedidosProvider provider,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppTheme.darkSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => _DraftsBody(provider: provider),
    );
  }
}

class _DraftsBody extends StatelessWidget {
  const _DraftsBody({required this.provider});

  final PedidosProvider provider;

  @override
  Widget build(BuildContext context) {
    final drafts = provider.savedDrafts;

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Borradores guardados',
            style: TextStyle(
              color: Colors.white,
              fontSize: Responsive.fontSize(context, small: 16, large: 18),
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 12),
          if (drafts.isEmpty)
            const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Column(
                  children: [
                    Icon(
                      Icons.description_outlined,
                      color: Colors.white38,
                      size: 48,
                    ),
                    SizedBox(height: 8),
                    Text(
                      'No hay borradores guardados',
                      style: TextStyle(color: Colors.white54),
                    ),
                  ],
                ),
              ),
            )
          else
            ...drafts.take(10).map((draft) {
              final client = draft['clientName'] ?? draft['clientCode'] ?? '';
              final lines = (draft['lines'] as List?)?.length ?? 0;
              final savedAtRaw = (draft['savedAt'] ?? '').toString();
              final savedAtLabel = savedAtRaw.length >= 10
                  ? savedAtRaw.substring(0, 10)
                  : savedAtRaw;
              final key = draft['draftKey'] as String;
              return Card(
                color: AppTheme.darkCard,
                margin: const EdgeInsets.only(bottom: 6),
                child: ListTile(
                  leading: const Icon(
                    Icons.description_outlined,
                    color: AppTheme.neonBlue,
                  ),
                  title: Text(
                    client.toString(),
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  subtitle: Text(
                    '$lines lineas - $savedAtLabel',
                    style: const TextStyle(color: Colors.white54, fontSize: 12),
                  ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        icon: const Icon(
                          Icons.restore,
                          color: AppTheme.neonGreen,
                          size: 20,
                        ),
                        onPressed: () {
                          provider.loadDraft(draft);
                          Navigator.pop(context);
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Borrador cargado'),
                              backgroundColor: AppTheme.neonGreen,
                            ),
                          );
                        },
                      ),
                      IconButton(
                        icon: const Icon(
                          Icons.delete_outline,
                          color: AppTheme.error,
                          size: 20,
                        ),
                        onPressed: () async {
                          await provider.deleteDraft(key);
                          if (context.mounted) Navigator.pop(context);
                        },
                      ),
                    ],
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }
}
