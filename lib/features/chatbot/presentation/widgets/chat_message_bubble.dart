import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/widgets/pdf_preview_screen.dart';
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
                          if (!isUser) _buildAssistantHeader(),
                          _buildFormattedMessage(message, isUser),
                          if (!isUser) ...[
                            ChatDataCard(
                              kpis: metadata.kpis,
                              chartData: metadata.chartData,
                            ),
                            if (metadata.exportable != null)
                              ChatExportTable(data: metadata.exportable!),
                            if (metadata.documents.isNotEmpty)
                              _buildDocumentCards(context),
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

  Widget _buildDocumentCards(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Column(
        children: metadata.documents.asMap().entries.map((entry) {
          final index = entry.key;
          final document = entry.value;
          return TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: 1),
            duration: Duration(milliseconds: 220 + index * 60),
            curve: Curves.easeOutCubic,
            builder: (context, value, child) => Opacity(
              opacity: value,
              child: Transform.translate(
                offset: Offset(0, 8 * (1 - value)),
                child: child,
              ),
            ),
            child: Container(
              margin: EdgeInsets.only(top: index == 0 ? 0 : 8),
              decoration: BoxDecoration(
                color: AppColors.neonPurple.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: AppColors.neonPurple.withValues(alpha: 0.24),
                ),
              ),
              child: InkWell(
                borderRadius: BorderRadius.circular(8),
                onTap: () => _openDocument(context, document),
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: Row(
                    children: [
                      Container(
                        width: 38,
                        height: 38,
                        decoration: BoxDecoration(
                          color: AppColors.neonPurple.withValues(alpha: 0.14),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Icon(
                          Icons.picture_as_pdf_outlined,
                          color: AppColors.neonPurple,
                          size: 20,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              document.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 12.5,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              document.fileName ?? document.url,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: Colors.grey.shade500,
                                fontSize: 10.5,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      Tooltip(
                        message: 'Abrir PDF',
                        child: TextButton.icon(
                          onPressed: () => _openDocument(context, document),
                          icon: const Icon(Icons.open_in_new, size: 14),
                          label: const Text('Abrir'),
                          style: TextButton.styleFrom(
                            foregroundColor: AppColors.neonPurple,
                            minimumSize: const Size(70, 40),
                            padding: const EdgeInsets.symmetric(horizontal: 8),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildAssistantHeader() {
    final chips = <(IconData, String, Color)>[
      if (metadata.kpis.isNotEmpty)
        (
          Icons.speed_outlined,
          '${metadata.kpis.length} KPI',
          AppColors.neonBlue
        ),
      if (metadata.exportable != null)
        (Icons.table_chart_outlined, 'CSV', AppColors.neonGreen),
      if (metadata.chartData.isNotEmpty)
        (Icons.show_chart, 'Grafico', Colors.amberAccent),
      if (metadata.documents.isNotEmpty)
        (
          Icons.picture_as_pdf_outlined,
          '${metadata.documents.length} PDF',
          AppColors.neonPurple,
        ),
    ];

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          const Text(
            'IA Comercial',
            style: TextStyle(
              color: Colors.white,
              fontSize: 11,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Wrap(
              spacing: 5,
              runSpacing: 5,
              children: chips.map((chip) {
                final (icon, label, color) = chip;
                return Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.09),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: color.withValues(alpha: 0.20)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(icon, size: 11, color: color),
                      const SizedBox(width: 4),
                      Text(
                        label,
                        style: TextStyle(
                          color: color,
                          fontSize: 9.5,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                );
              }).toList(),
            ),
          ),
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
          if (metadata.documents.isNotEmpty)
            _ActionChip(
              icon: Icons.picture_as_pdf_outlined,
              label: metadata.documents.length == 1 ? 'Ver PDF' : 'PDFs',
              accent: AppColors.neonPurple,
              semanticsLabel: 'Abrir documento PDF',
              tooltip:
                  'Abrir el PDF asociado sin salir de la respuesta del asistente',
              onTap: () => _openDocuments(context, metadata.documents),
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

  Future<void> _openDocuments(
    BuildContext context,
    List<ChatDocumentReference> documents,
  ) async {
    if (documents.length == 1) {
      await _openDocument(context, documents.first);
      return;
    }

    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.darkSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Documentos',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(height: 12),
              ...documents.map(
                (doc) => ListTile(
                  leading: const Icon(
                    Icons.picture_as_pdf_outlined,
                    color: AppColors.neonPurple,
                  ),
                  title: Text(
                    doc.title,
                    style: const TextStyle(color: Colors.white),
                  ),
                  subtitle: Text(
                    doc.fileName ?? doc.url,
                    style: TextStyle(color: Colors.grey.shade500),
                  ),
                  onTap: () {
                    Navigator.pop(ctx);
                    _openDocument(context, doc);
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _openDocument(
    BuildContext context,
    ChatDocumentReference document,
  ) async {
    final messenger = ScaffoldMessenger.of(context);
    messenger.showSnackBar(
      const SnackBar(
        content: Text('Cargando PDF...'),
        duration: Duration(seconds: 1),
        behavior: SnackBarBehavior.floating,
      ),
    );

    try {
      final bytes = await ApiClient.getBytes(
        _normalizeDocumentEndpoint(document.url),
        queryParameters: {
          'preview': 'true',
          '_t': DateTime.now().millisecondsSinceEpoch.toString(),
        },
      );
      if (!context.mounted) return;
      messenger.hideCurrentSnackBar();
      if (bytes.length < 100) {
        throw Exception('El documento recibido no parece un PDF valido.');
      }
      await Navigator.of(context).push<void>(
        MaterialPageRoute(
          builder: (_) => PdfPreviewScreen(
            pdfBytes: Uint8List.fromList(bytes),
            title: document.title,
            fileName: _documentFileName(document),
          ),
        ),
      );
    } catch (e) {
      if (!context.mounted) return;
      messenger.hideCurrentSnackBar();
      messenger.showSnackBar(
        SnackBar(
          content: Text('No se pudo abrir el PDF: $e'),
          backgroundColor: AppTheme.error,
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  String _normalizeDocumentEndpoint(String rawUrl) {
    var endpoint = rawUrl.trim();
    final baseUrl = ApiClient.dio.options.baseUrl;
    if (endpoint.startsWith(baseUrl)) {
      endpoint = endpoint.substring(baseUrl.length);
    }
    if (endpoint.startsWith('/api/')) {
      endpoint = endpoint.substring(4);
    }
    if (!endpoint.startsWith('/')) {
      endpoint = '/$endpoint';
    }
    return endpoint;
  }

  String _documentFileName(ChatDocumentReference document) {
    final raw = (document.fileName?.trim().isNotEmpty ?? false)
        ? document.fileName!.trim()
        : document.title.trim().replaceAll(RegExp(r'[^A-Za-z0-9._-]+'), '-');
    return raw.toLowerCase().endsWith('.pdf') ? raw : '$raw.pdf';
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
    const steps = [
      (Icons.manage_search, 'Interpretando'),
      (Icons.verified_user_outlined, 'Permisos'),
      (Icons.storage_outlined, 'DB2'),
      (Icons.auto_awesome_motion_outlined, 'Respuesta'),
    ];

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
                'Analizando consulta...',
                style: TextStyle(
                  fontSize: 12,
                  color: AppTheme.neonBlue.withValues(alpha: 0.9),
                  fontStyle: FontStyle.italic,
                ),
              ),
            ],
          ),
        ),
        TweenAnimationBuilder<double>(
          tween: Tween(begin: 0, end: 1),
          duration: const Duration(milliseconds: 1300),
          curve: Curves.easeOutCubic,
          builder: (context, progress, _) => Wrap(
            spacing: 6,
            runSpacing: 6,
            children: steps.asMap().entries.map((entry) {
              final active = progress >= (entry.key / steps.length);
              final (icon, label) = entry.value;
              return _AnalysisStep(
                icon: icon,
                label: label,
                active: active,
              );
            }).toList(),
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

class _AnalysisStep extends StatelessWidget {
  const _AnalysisStep({
    required this.icon,
    required this.label,
    required this.active,
  });

  final IconData icon;
  final String label;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final color = active ? AppColors.neonBlue : Colors.grey.shade700;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: active ? 0.12 : 0.06),
        borderRadius: BorderRadius.circular(8),
        border:
            Border.all(color: color.withValues(alpha: active ? 0.28 : 0.12)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: color),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 10,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _ActionChip extends StatelessWidget {
  const _ActionChip({
    required this.icon,
    required this.label,
    required this.onTap,
    this.accent,
    this.semanticsLabel,
    this.tooltip,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color? accent;
  final String? semanticsLabel;
  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    final color = accent ?? AppColors.neonBlue;
    final child = Semantics(
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
    if (tooltip == null || tooltip!.isEmpty) return child;
    return Tooltip(message: tooltip!, child: child);
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
