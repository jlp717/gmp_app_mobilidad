import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../theme/app_theme.dart';

class SmartSyncHeader extends StatelessWidget {
  final String title;
  final String subtitle;
  final DateTime? lastSync;
  final bool isLoading;
  final VoidCallback onSync;
  final VoidCallback? onMonthTap; // Optional: specific for month picker interaction

  const SmartSyncHeader({
    super.key,
    required this.title,
    required this.subtitle,
    this.lastSync,
    this.isLoading = false,
    required this.onSync,
    this.onMonthTap,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppTheme.surfaceColor,
            AppTheme.surfaceColor.withOpacity(0.8),
          ],
        ),
        border: Border(
          bottom: BorderSide(color: AppTheme.neonBlue.withOpacity(0.2), width: 1),
        ),
      ),
      child: Column(
        children: [
          Row(
            children: [
              // Icon (can be customized or generic)
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [
                      AppTheme.neonBlue.withOpacity(0.2),
                      AppTheme.neonPurple.withOpacity(0.2),
                    ],
                  ),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(Icons.sync_alt, color: AppTheme.neonBlue, size: 24), // Generic sync icon
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                    if (onMonthTap != null)
                      GestureDetector(
                        onTap: onMonthTap,
                        child: Row(
                          children: [
                            Text(
                              subtitle,
                              style: TextStyle(
                                fontSize: 13,
                                color: AppTheme.neonBlue,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(width: 4),
                            const Icon(Icons.arrow_drop_down, color: AppTheme.neonBlue, size: 16),
                          ],
                        ),
                      )
                    else
                      Text(
                        subtitle,
                        style: TextStyle(
                          fontSize: 12,
                          color: AppTheme.textSecondary.withOpacity(0.8),
                        ),
                      ),
                  ],
                ),
              ),
              // Sync Button
              IconButton(
                onPressed: isLoading ? null : onSync,
                icon: isLoading
                    ? const SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: AppTheme.neonBlue,
                        ),
                      )
                    : const Icon(Icons.sync, color: AppTheme.neonBlue),
              ),
            ],
          ),
          if (lastSync != null)
            Padding(
              padding: const EdgeInsets.only(top: 8.0),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Última sincronización: ${DateFormat('dd/MM/yy HH:mm').format(lastSync!)}',
                  style: TextStyle(fontSize: 10, color: AppTheme.textSecondary.withOpacity(0.7)),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
