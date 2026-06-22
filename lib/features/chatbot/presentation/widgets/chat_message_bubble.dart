import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/chatbot/data/chatbot_models.dart';
import 'package:gmp_app_mobilidad/features/chatbot/presentation/widgets/chat_data_card.dart';
import 'package:gmp_app_mobilidad/features/chatbot/presentation/widgets/chat_export_table.dart';
import 'package:gmp_app_mobilidad/features/chatbot/presentation/widgets/chat_share_actions.dart';
import 'package:gmp_app_mobilidad/features/chatbot/presentation/widgets/chat_typing_dots.dart';
import 'package:gmp_app_mobilidad/features/chatbot/providers/chatbot_shell_navigation.dart';

/// Professional styled message bubble with tables, KPIs, export and share.
class ChatMessageBubble extends ConsumerWidget {
  const ChatMessageBubble({
    required this.message,
    required this.isUser,
    super.key,
    this.timestamp,
    this.isLoading = false,
    this.metadata = const ChatResponseMetadata(),
    this.isPinned = false,
    this.messageIndex,
    this.onFollowUpTap,
    this.onPinToggle,
  });

  final String message;
  final bool isUser;
  final DateTime? timestamp;
  final bool isLoading;
  final ChatResponseMetadata metadata;
  final bool isPinned;
  final int? messageIndex;
  final ValueChanged<String>? onFollowUpTap;
  final VoidCallback? onPinToggle;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: EdgeInsets.only(
        left: isUser ? 60 : 0,
        right: isUser ? 0 : 60,
        bottom: 12,
      ),
      child: Row(
        mainAxisAlignment:
            isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (!isUser) ...[
            Container(
              width: 34,
              height: 34,
              margin: const EdgeInsets.only(right: 10),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [AppTheme.neonBlue, AppTheme.neonPurple],
                ),
                borderRadius: BorderRadius.circular(10),
                boxShadow: [
                  BoxShadow(
                    color: AppTheme.neonBlue.withValues(alpha: 0.3),
                    blurRadius: 8,
                    spreadRadius: 1,
                  ),
                ],
              ),
              child:
                  const Icon(Icons.psychology, color: Colors.white, size: 20),
            ),
          ],
          Flexible(
            child: TweenAnimationBuilder<double>(
              tween: Tween(begin: 1, end: isPinned ? 1.02 : 1),
              duration: const Duration(milliseconds: 220),
              curve: Curves.easeOutBack,
              builder: (context, scale, child) => Transform.scale(
                scale: scale,
                child: child,
              ),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: BoxDecoration(
                  gradient: isUser
                      ? LinearGradient(
                          colors: [
                            AppTheme.neonBlue,
                            AppTheme.neonBlue.withValues(alpha: 0.85),
                          ],
                        )
                      : null,
                  color: isUser ? null : const Color(0xFF1A1F35),
                  borderRadius: BorderRadius.only(
                    topLeft: const Radius.circular(18),
                    topRight: const Radius.circular(18),
                    bottomLeft: Radius.circular(isUser ? 18 : 4),
                    bottomRight: Radius.circular(isUser ? 4 : 18),
                  ),
                  border: isUser
                      ? null
                      : Border.all(
                          color: isPinned
                              ? AppColors.neonPurple.withValues(alpha: 0.5)
                              : AppTheme.neonBlue.withValues(alpha: 0.15),
                          width: isPinned ? 1.5 : 1,
                        ),
                  boxShadow: [
                    BoxShadow(
                      color: isUser
                          ? AppTheme.neonBlue.withValues(alpha: 0.3)
                          : Colors.black.withValues(alpha: 0.3),
                      blurRadius: 12,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: isLoading
                    ? _buildTypingIndicator()
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (isPinned && !isUser)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 6),
                              child: Row(
                                children: [
                                  Icon(
                                    Icons.push_pin,
                                    size: 12,
                                    color: AppColors.neonPurple
                                        .withValues(alpha: 0.9),
                                  ),
                                  const SizedBox(width: 4),
                                  Text(
                                    'Respuesta fijada',
                                    style: TextStyle(
                                      fontSize: 10,
                                      color: AppColors.neonPurple
                                          .withValues(alpha: 0.9),
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          _buildFormattedMessage(message, isUser),
                          if (!isUser) ...[
                            ChatDataCard(
                              kpis: metadata.kpis,
                              chartData: metadata.chartData,
                            ),
                            if (metadata.exportable != null)
                              ChatExportTable(data: metadata.exportable!),
                            _buildActionRow(context, ref),
                            if (metadata.suggestedFollowUps.isNotEmpty)
                              _buildFollowUpChips(),
                          ],
                          if (timestamp != null) ...[
                            const SizedBox(height: 6),
                            Text(
                              _formatTime(timestamp!),
                              style: TextStyle(
                                color: isUser
                                    ? Colors.white.withValues(alpha: 0.6)
                                    : Colors.grey.shade600,
                                fontSize: 10,
                                letterSpacing: 0.3,
                              ),
                            ),
                          ],
                        ],
                      ),
              ),
            ),
          ),
          if (isUser) ...[
            Container(
              width: 34,
              height: 34,
              margin: const EdgeInsets.only(left: 10),
              decoration: BoxDecoration(
                color: AppTheme.neonBlue.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: AppTheme.neonBlue.withValues(alpha: 0.3),
                ),
              ),
              child:
                  const Icon(Icons.person, color: AppTheme.neonBlue, size: 18),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildActionRow(BuildContext context, WidgetRef ref) {
    final exportable = metadata.exportable;
    final hasData = exportable != null || metadata.kpis.isNotEmpty;

    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [
          _ActionChip(
            icon: Icons.copy_rounded,
            label: 'Copiar',
            semanticsLabel: 'Copiar respuesta',
            onTap: () async {
              await ChatShareActions.copyToClipboard(message);
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('Copiado al portapapeles'),
                    duration: Duration(seconds: 2),
                    behavior: SnackBarBehavior.floating,
                  ),
                );
              }
            },
          ),
          if (onPinToggle != null)
            _ActionChip(
              icon: isPinned ? Icons.push_pin : Icons.push_pin_outlined,
              label: isPinned ? 'Desfijar' : 'Fijar',
              semanticsLabel:
                  isPinned ? 'Desfijar respuesta' : 'Fijar respuesta',
              onTap: onPinToggle!,
            ),
          if (exportable != null)
            _ActionChip(
              icon: Icons.table_chart_outlined,
              label: 'Exportar CSV',
              accent: AppColors.neonGreen,
              semanticsLabel: 'Exportar datos a CSV',
              onTap: () async {
                await ChatShareActions.exportAndShareCsv(exportable);
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Row(
                        children: [
                          const Icon(Icons.check_circle,
                              color: AppColors.neonGreen, size: 18),
                          const SizedBox(width: 8),
                          Text('CSV listo: ${exportable.filename}'),
                        ],
                      ),
                      duration: const Duration(seconds: 2),
                      behavior: SnackBarBehavior.floating,
                      backgroundColor: AppColors.darkCard,
                    ),
                  );
                }
              },
            ),
          if (hasData)
            _ActionChip(
              icon: Icons.share_outlined,
              label: 'Compartir',
              semanticsLabel: 'Compartir respuesta',
              onTap: () => _showShareSheet(context, exportable),
            ),
          if (metadata.deepLink != null)
            _ActionChip(
              icon: Icons.open_in_new_rounded,
              label: 'Ver en app',
              accent: AppColors.neonPurple,
              semanticsLabel: 'Abrir seccion en la app',
              onTap: () {
                ref
                    .read(chatbotShellNavigationProvider.notifier)
                    .navigate(metadata.deepLink!);
              },
            ),
        ],
      ),
    );
  }

  void _showShareSheet(BuildContext context, ChatExportableData? exportable) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.darkSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Compartir respuesta',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 16),
              ListTile(
                leading: const Icon(Icons.chat, color: AppColors.neonGreen),
                title: const Text('WhatsApp',
                    style: TextStyle(color: Colors.white)),
                onTap: () {
                  Navigator.pop(ctx);
                  ChatShareActions.shareViaWhatsApp(message);
                },
              ),
              ListTile(
                leading:
                    const Icon(Icons.email_outlined, color: AppColors.neonBlue),
                title:
                    const Text('Email', style: TextStyle(color: Colors.white)),
                onTap: () {
                  Navigator.pop(ctx);
                  ChatShareActions.shareViaEmail(message);
                },
              ),
              ListTile(
                leading:
                    const Icon(Icons.ios_share, color: AppColors.neonPurple),
                title: const Text(
                  'Más opciones',
                  style: TextStyle(color: Colors.white),
                ),
                subtitle: exportable != null
                    ? Text(
                        'Incluye nota sobre ${exportable.rows.length} filas exportables',
                        style: TextStyle(
                            color: Colors.grey.shade500, fontSize: 11),
                      )
                    : null,
                onTap: () {
                  Navigator.pop(ctx);
                  ChatShareActions.shareTextSummary(
                    summary: message,
                    exportable: exportable,
                  );
                },
              ),
              if (exportable != null)
                ListTile(
                  leading:
                      const Icon(Icons.table_chart, color: AppColors.neonGreen),
                  title: const Text(
                    'Compartir CSV',
                    style: TextStyle(color: Colors.white),
                  ),
                  onTap: () {
                    Navigator.pop(ctx);
                    ChatShareActions.exportAndShareCsv(exportable);
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildFollowUpChips() {
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Wrap(
        spacing: 6,
        runSpacing: 6,
        children: metadata.suggestedFollowUps.map((q) {
          return ActionChip(
            label: Text(
              q,
              style: const TextStyle(fontSize: 11, color: Colors.white70),
            ),
            backgroundColor: AppColors.neonBlue.withValues(alpha: 0.12),
            side: BorderSide(color: AppColors.neonBlue.withValues(alpha: 0.25)),
            onPressed: onFollowUpTap == null ? null : () => onFollowUpTap!(q),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildFormattedMessage(String text, bool isUser) {
    final lines = text.split('\n');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: lines.map((line) {
        if (line.startsWith('•') || line.startsWith('-')) {
          return Padding(
            padding: const EdgeInsets.only(left: 4, bottom: 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 4,
                  height: 4,
                  margin: const EdgeInsets.only(top: 8, right: 8),
                  decoration: BoxDecoration(
                    color: isUser ? Colors.white70 : AppTheme.neonBlue,
                    shape: BoxShape.circle,
                  ),
                ),
                Expanded(
                  child: _parseInlineStyles(line.substring(1).trim(), isUser),
                ),
              ],
            ),
          );
        }
        return Padding(
          padding: const EdgeInsets.only(bottom: 4),
          child: _parseInlineStyles(line, isUser),
        );
      }).toList(),
    );
  }

  Widget _parseInlineStyles(String text, bool isUser) {
    final regex = RegExp(r'\*\*(.+?)\*\*');
    final matches = regex.allMatches(text);

    if (matches.isEmpty) {
      return Text(
        text,
        style: TextStyle(
          color: isUser ? Colors.white : Colors.grey.shade300,
          fontSize: 14,
          height: 1.5,
        ),
      );
    }

    final spans = <InlineSpan>[];
    var lastEnd = 0;

    for (final match in matches) {
      if (match.start > lastEnd) {
        spans.add(TextSpan(text: text.substring(lastEnd, match.start)));
      }
      spans.add(
        TextSpan(
          text: match.group(1),
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
      );
      lastEnd = match.end;
    }

    if (lastEnd < text.length) {
      spans.add(TextSpan(text: text.substring(lastEnd)));
    }

    return RichText(
      text: TextSpan(
        style: TextStyle(
          color: isUser ? Colors.white : Colors.grey.shade300,
          fontSize: 14,
          height: 1.5,
        ),
        children: spans,
      ),
    );
  }

  Widget _buildTypingIndicator() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(vertical: 8),
          alignment: Alignment.centerLeft,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const ChatTypingDots(),
              const SizedBox(width: 12),
              Text(
                'Consultando datos...',
                style: TextStyle(
                  fontSize: 12,
                  color: AppTheme.neonBlue.withValues(alpha: 0.9),
                  fontStyle: FontStyle.italic,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        _SkeletonLine(widthFactor: 0.9),
        const SizedBox(height: 6),
        _SkeletonLine(widthFactor: 0.7),
        const SizedBox(height: 6),
        _SkeletonLine(widthFactor: 0.5),
      ],
    );
  }

  String _formatTime(DateTime time) {
    final diff = DateTime.now().difference(time);
    if (diff.inSeconds < 45) return 'ahora';
    if (diff.inMinutes < 60) return 'hace ${diff.inMinutes} min';
    if (diff.inHours < 24) return 'hace ${diff.inHours} h';
    final hour = time.hour.toString().padLeft(2, '0');
    final minute = time.minute.toString().padLeft(2, '0');
    return '$hour:$minute';
  }
}

class _ActionChip extends StatelessWidget {
  const _ActionChip({
    required this.icon,
    required this.label,
    required this.onTap,
    this.accent,
    this.semanticsLabel,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color? accent;
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) {
    final color = accent ?? AppColors.neonBlue;
    return Semantics(
      button: true,
      label: semanticsLabel ?? label,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          constraints: const BoxConstraints(minHeight: 48),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: color.withValues(alpha: 0.25)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 14, color: color),
              const SizedBox(width: 4),
              Text(
                label,
                style: TextStyle(
                    fontSize: 11, color: color, fontWeight: FontWeight.w500),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SkeletonLine extends StatelessWidget {
  const _SkeletonLine({required this.widthFactor});
  final double widthFactor;

  @override
  Widget build(BuildContext context) {
    return FractionallySizedBox(
      widthFactor: widthFactor,
      child: Container(
        height: 8,
        decoration: BoxDecoration(
          color: AppColors.neonBlue.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(4),
        ),
      ),
    );
  }
}
