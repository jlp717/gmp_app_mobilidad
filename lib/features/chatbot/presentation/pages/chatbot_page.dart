import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_sync_header.dart'; // Import Sync Header
import 'package:gmp_app_mobilidad/features/chatbot/presentation/widgets/chat_message_bubble.dart';
import 'package:gmp_app_mobilidad/features/chatbot/providers/chatbot_provider.dart';

/// [ChatbotPage] - Professional AI Sales Assistant
///
/// Premium futuristic chat interface with:
/// - Clean professional design without childish emojis
/// - Quick action pills with icons
/// - Gradient accents and glowing effects
class ChatbotPage extends ConsumerStatefulWidget {
  const ChatbotPage({
    required this.vendedorCodes,
    super.key,
  });

  final List<String> vendedorCodes;

  @override
  ConsumerState<ChatbotPage> createState() => _ChatbotPageState();
}

class _ChatbotPageState extends ConsumerState<ChatbotPage>
    with SingleTickerProviderStateMixin {
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;
  String? _restoredForUser;
  int _selectedPlaybook = 0;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      duration: const Duration(milliseconds: 2000),
      vsync: this,
    )..repeat(reverse: true);
    _pulseAnimation = Tween<double>(begin: 0.8, end: 1).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );
    _syncVendedorCodesContext();
  }

  @override
  void didUpdateWidget(covariant ChatbotPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.vendedorCodes.join(',') != widget.vendedorCodes.join(',')) {
      _syncVendedorCodesContext();
    }
  }

  void _syncVendedorCodesContext() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(chatbotProvider.notifier).setVendedorCodes(widget.vendedorCodes);
    });
  }

  void _restoreSessionFor(String? userCode) {
    final normalized = userCode?.trim();
    if (normalized == null || normalized.isEmpty) return;
    if (_restoredForUser == normalized) return;
    _restoredForUser = normalized;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(chatbotProvider.notifier).restoreSession(normalized);
    });
  }

  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    _pulseController.dispose();
    super.dispose();
  }

  void _sendMessage() {
    final text = _messageController.text.trim();
    if (text.isEmpty) return;

    ref.read(chatbotProvider.notifier).sendMessage(text);
    _messageController.clear();
    _scrollToBottomSoon();
  }

  void _scrollToBottomSoon() {
    Future.delayed(const Duration(milliseconds: 100), () {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _sendQuery(String query) {
    _messageController.text = query;
    _sendMessage();
  }

  void _showHistorySheet() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) {
        return Consumer(
          builder: (context, ref, _) {
            final chatState = ref.watch(chatbotProvider);
            final sessions = chatState.sessions;

            return SafeArea(
              top: false,
              child: Container(
                constraints: BoxConstraints(
                  maxHeight: MediaQuery.of(context).size.height * 0.72,
                ),
                decoration: const BoxDecoration(
                  color: Color(0xFF0B1020),
                  borderRadius: BorderRadius.vertical(top: Radius.circular(8)),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const SizedBox(height: 10),
                    Container(
                      width: 42,
                      height: 4,
                      decoration: BoxDecoration(
                        color: Colors.white24,
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 14, 12, 8),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.history_rounded,
                            color: AppTheme.neonBlue,
                          ),
                          const SizedBox(width: 10),
                          const Expanded(
                            child: Text(
                              'Historial de chats',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 17,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                          TextButton.icon(
                            onPressed: () async {
                              Navigator.of(sheetContext).pop();
                              await ref
                                  .read(chatbotProvider.notifier)
                                  .startNewSession();
                            },
                            icon: const Icon(Icons.add_rounded, size: 18),
                            label: const Text('Nuevo'),
                          ),
                        ],
                      ),
                    ),
                    Divider(
                      height: 1,
                      color: AppTheme.neonBlue.withValues(alpha: 0.14),
                    ),
                    if (sessions.isEmpty)
                      Padding(
                        padding: const EdgeInsets.all(22),
                        child: Row(
                          children: [
                            Icon(
                              Icons.forum_outlined,
                              color: Colors.white.withValues(alpha: 0.48),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Text(
                                'Todavia no hay conversaciones guardadas. '
                                'La primera consulta creara un historial.',
                                style: TextStyle(
                                  color: Colors.grey.shade400,
                                  fontSize: 13,
                                ),
                              ),
                            ),
                          ],
                        ),
                      )
                    else
                      Flexible(
                        child: ListView.separated(
                          padding: const EdgeInsets.fromLTRB(12, 10, 12, 18),
                          shrinkWrap: true,
                          itemCount: sessions.length,
                          separatorBuilder: (_, __) =>
                              const SizedBox(height: 8),
                          itemBuilder: (context, index) {
                            final session = sessions[index];
                            final isActive =
                                session.id == chatState.activeSessionId;
                            final sessionAge =
                                _formatSessionAge(session.updatedAt);
                            final sessionMeta =
                                '${session.messageCount} mensajes - $sessionAge';
                            return InkWell(
                              borderRadius: BorderRadius.circular(8),
                              onTap: () async {
                                Navigator.of(sheetContext).pop();
                                await ref
                                    .read(chatbotProvider.notifier)
                                    .loadSession(session.id);
                                _scrollToBottomSoon();
                              },
                              child: AnimatedContainer(
                                duration: const Duration(milliseconds: 160),
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: isActive
                                      ? AppTheme.neonBlue.withValues(alpha: 0.1)
                                      : Colors.white.withValues(alpha: 0.035),
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(
                                    color: isActive
                                        ? AppTheme.neonBlue
                                            .withValues(alpha: 0.36)
                                        : Colors.white.withValues(alpha: 0.08),
                                  ),
                                ),
                                child: Row(
                                  children: [
                                    Container(
                                      width: 38,
                                      height: 38,
                                      decoration: BoxDecoration(
                                        color: AppTheme.neonBlue
                                            .withValues(alpha: 0.12),
                                        borderRadius: BorderRadius.circular(8),
                                      ),
                                      child: Icon(
                                        isActive
                                            ? Icons.mark_chat_read_outlined
                                            : Icons.chat_bubble_outline,
                                        color: AppTheme.neonBlue,
                                        size: 19,
                                      ),
                                    ),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            session.title,
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: const TextStyle(
                                              color: Colors.white,
                                              fontSize: 13,
                                              fontWeight: FontWeight.w800,
                                            ),
                                          ),
                                          const SizedBox(height: 4),
                                          Text(
                                            sessionMeta,
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: TextStyle(
                                              color: Colors.grey.shade500,
                                              fontSize: 11,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    IconButton(
                                      tooltip: 'Eliminar chat',
                                      onPressed: () => ref
                                          .read(chatbotProvider.notifier)
                                          .deleteSession(session.id),
                                      icon: const Icon(
                                        Icons.delete_outline,
                                        size: 18,
                                      ),
                                      color: Colors.white54,
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                      ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  String _formatSessionAge(DateTime updatedAt) {
    final now = DateTime.now();
    final diff = now.difference(updatedAt);
    if (diff.inMinutes < 1) return 'ahora';
    if (diff.inHours < 1) return '${diff.inMinutes} min';
    if (diff.inDays < 1) return '${diff.inHours} h';
    if (diff.inDays < 7) return '${diff.inDays} dias';
    final day = updatedAt.day.toString().padLeft(2, '0');
    final month = updatedAt.month.toString().padLeft(2, '0');
    final hour = updatedAt.hour.toString().padLeft(2, '0');
    final minute = updatedAt.minute.toString().padLeft(2, '0');
    return '$day/$month $hour:$minute';
  }

  @override
  Widget build(BuildContext context) {
    // Check role for custom message
    final authState = ref.watch(authProvider).value;
    _restoreSessionFor(
      authState?.user?.code ?? authState?.user?.vendedorCode,
    );
    final isJefe = (authState?.user?.isDirector ?? false) ||
        widget.vendedorCodes.length > 1;

    final chatbotState = ref.watch(chatbotProvider);

    return Scaffold(
      // Wrapped in Scaffold for safety
      backgroundColor: const Color(0xFF0A0E21),
      body: Column(
        children: [
          SmartSyncHeader(
            title: isJefe ? 'Asistente (Supervisor)' : 'Asistente',
            subtitle: 'Asistente Comercial Inteligente',
            lastSync: DateTime.now(),
            isLoading: chatbotState.isLoading,
            onSync: () => ref
                .read(chatbotProvider.notifier)
                .clearChat(), // Clear as sync/reset action
          ),
          Expanded(
            child: Container(
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Color(0xFF0E1426),
                    Color(0xFF070A14),
                  ],
                ),
              ),
              child: Column(
                children: [
                  _buildCommandCenter(chatbotState, isJefe),
                  if (chatbotState.error != null) _buildErrorBanner(),
                  Expanded(child: _buildMessageList()),
                  _buildInputArea(),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildQuickActions() {
    // Professional quick actions without emojis
    final quickActions = [
      (
        Icons.explore_outlined,
        'Navegación',
        'Guíame para moverme por clientes, facturas, pedidos, cobros y bolsa.',
      ),
      (
        Icons.receipt_long_outlined,
        'Facturas',
        'Resume facturas pendientes y próximos pasos de revisión.',
      ),
      (
        Icons.shopping_cart_outlined,
        'Pedidos',
        'Ayúdame a revisar pedidos, estado y oportunidades de venta.',
      ),
      (
        Icons.query_stats_outlined,
        'Evaluar',
        'Evalúa la situación comercial con deuda, pedidos, facturas y acciones recomendadas.',
      ),
      (
        Icons.euro_outlined,
        'Comisiones',
        'Explícame comisiones y evolución comercial relevante.',
      ),
      (
        Icons.account_balance_wallet,
        'Deuda Cliente',
        'Analiza la deuda de un cliente y prioriza la acción de cobro.',
      ),
      (
        Icons.inventory,
        'Stock',
        'Consulta disponibilidad de stock y alternativas si falta producto.',
      ),
      (
        Icons.attach_money,
        'Margen Global',
        'Analiza margen global y riesgos de precio mínimo.',
      ),
      (
        Icons.trending_up,
        'Precios',
        'Sugiere cómo revisar precios mínimos, máximos y margen.',
      ),
      (
        Icons.local_offer,
        'Promociones',
        'Indica promociones aplicables y cómo validarlas.',
      ),
    ];

    return Container(
      height: 58,
      margin: const EdgeInsets.symmetric(vertical: 8),
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: quickActions.length,
        separatorBuilder: (_, __) => const SizedBox(width: 10),
        itemBuilder: (context, index) {
          final (icon, label, query) = quickActions[index];
          return GestureDetector(
            onTap: () => _sendQuery(query),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    AppTheme.neonBlue.withValues(alpha: 0.1),
                    AppTheme.neonPurple.withValues(alpha: 0.05),
                  ],
                ),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: AppTheme.neonBlue.withValues(alpha: 0.3),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icon, color: AppTheme.neonBlue, size: 18),
                  const SizedBox(width: 8),
                  Text(
                    label,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      color: Colors.white70,
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildCommandCenter(ChatbotState chatState, bool isJefe) {
    final documentCount = chatState.messages.fold<int>(
      0,
      (sum, message) => sum + message.metadata.documents.length,
    );
    final answerCount = chatState.messages.where((m) => !m.isUser).length;

    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
      decoration: BoxDecoration(
        color: const Color(0xFF11182A).withValues(alpha: 0.82),
        border: Border(
          bottom: BorderSide(
            color: AppTheme.neonBlue.withValues(alpha: 0.12),
          ),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    _StatusPill(
                      icon: Icons.verified_user_outlined,
                      label: isJefe ? 'Supervisor' : 'Comercial',
                      value: isJefe ? 'todo' : 'cartera',
                      accent: AppTheme.neonBlue,
                    ),
                    _StatusPill(
                      icon: Icons.history,
                      label: 'Historial',
                      value: '${chatState.sessions.length}',
                      accent: Colors.greenAccent,
                    ),
                    _StatusPill(
                      icon: Icons.picture_as_pdf_outlined,
                      label: 'PDF',
                      value: '$documentCount',
                      accent: Colors.pinkAccent,
                    ),
                    _StatusPill(
                      icon: Icons.analytics_outlined,
                      label: 'Respuestas',
                      value: '$answerCount',
                      accent: Colors.amberAccent,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Tooltip(
                message: 'Abrir historial de chats',
                child: IconButton(
                  onPressed: _showHistorySheet,
                  icon: const Icon(Icons.history_rounded),
                  color: Colors.greenAccent,
                  style: IconButton.styleFrom(
                    backgroundColor: Colors.greenAccent.withValues(alpha: 0.08),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 6),
              Tooltip(
                message: 'Cobertura del asistente',
                child: IconButton(
                  onPressed: () => _sendQuery('que puedes hacer por pestanas'),
                  icon: const Icon(Icons.radar_outlined),
                  color: AppTheme.neonBlue,
                  style: IconButton.styleFrom(
                    backgroundColor: AppTheme.neonBlue.withValues(alpha: 0.08),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          _buildPlaybookStrip(),
          _buildCoverageRail(),
        ],
      ),
    );
  }

  Widget _buildPlaybookStrip() {
    final playbooks = [
      (
        Icons.bolt_outlined,
        'Briefing',
        'Resumen Glacius hoy y top clientes',
      ),
      (
        Icons.receipt_long_outlined,
        'Factura',
        'Lee la factura F/100/2026',
      ),
      (
        Icons.flag_outlined,
        'Objetivo',
        'Objetivo acumulado ultimos 3 meses',
      ),
      (
        Icons.euro_outlined,
        'Comision',
        'Comision acumulada de enero a marzo',
      ),
      (
        Icons.route_outlined,
        'Ruta',
        'Mi ruta hoy y cobros del repartidor',
      ),
    ];

    return SizedBox(
      height: 42,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: playbooks.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final (icon, label, query) = playbooks[index];
          final selected = _selectedPlaybook == index;
          return Tooltip(
            message: query,
            child: InkWell(
              borderRadius: BorderRadius.circular(8),
              onTap: () {
                setState(() => _selectedPlaybook = index);
                _sendQuery(query);
              },
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                decoration: BoxDecoration(
                  color: selected
                      ? AppTheme.neonBlue.withValues(alpha: 0.16)
                      : Colors.white.withValues(alpha: 0.035),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: selected
                        ? AppTheme.neonBlue.withValues(alpha: 0.42)
                        : Colors.white.withValues(alpha: 0.08),
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      icon,
                      size: 16,
                      color: selected ? AppTheme.neonBlue : Colors.white70,
                    ),
                    const SizedBox(width: 7),
                    Text(
                      label,
                      style: TextStyle(
                        color: selected ? Colors.white : Colors.white70,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildCoverageRail() {
    final modules = [
      (
        Icons.groups_2_outlined,
        'Clientes',
        'Deuda, ventas, riesgo y compras de un cliente',
        Colors.cyanAccent,
      ),
      (
        Icons.route_outlined,
        'Ruta',
        'Mi ruta hoy y cobros del repartidor',
        Colors.greenAccent,
      ),
      (
        Icons.payments_outlined,
        'Comisiones',
        'Comision acumulada ultimos 3 meses',
        Colors.amberAccent,
      ),
      (
        Icons.flag_outlined,
        'Objetivos',
        'Objetivo acumulado enero a marzo',
        Colors.lightBlueAccent,
      ),
      (
        Icons.picture_as_pdf_outlined,
        'PDF',
        'Lee la factura F/100/2026',
        Colors.pinkAccent,
      ),
      (
        Icons.ac_unit_outlined,
        'Glacius',
        'Resumen Glacius hoy',
        Colors.tealAccent,
      ),
      (
        Icons.account_balance_wallet_outlined,
        'Bolsa',
        'Movimientos bolsa',
        Colors.deepPurpleAccent,
      ),
      (
        Icons.local_shipping_outlined,
        'Almacen',
        'Camiones y vehiculos hoy',
        Colors.orangeAccent,
      ),
    ];

    return SizedBox(
      height: 86,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
        itemCount: modules.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final (icon, label, query, accent) = modules[index];
          return TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: 1),
            duration: Duration(milliseconds: 260 + index * 45),
            curve: Curves.easeOutCubic,
            builder: (context, value, child) => Opacity(
              opacity: value,
              child: Transform.translate(
                offset: Offset(0, 10 * (1 - value)),
                child: child,
              ),
            ),
            child: InkWell(
              borderRadius: BorderRadius.circular(8),
              onTap: () {
                _sendQuery(query);
              },
              child: Container(
                width: 138,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.035),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: accent.withValues(alpha: 0.32)),
                ),
                child: Row(
                  children: [
                    Icon(icon, size: 18, color: accent),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildErrorBanner() {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: AppTheme.error.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.error.withValues(alpha: 0.28)),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.warning_amber_rounded,
            color: AppTheme.error,
            size: 18,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'No se pudo completar la última consulta. '
              'Revisa la conexión e inténtalo de nuevo.',
              style: TextStyle(color: Colors.grey.shade300, fontSize: 12.5),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMessageList() {
    final chatState = ref.watch(chatbotProvider);

    if (chatState.messages.isEmpty) {
      return _buildWelcomeScreen();
    }

    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      itemCount: chatState.messages.length + (chatState.isLoading ? 1 : 0),
      itemBuilder: (context, index) {
        if (index == chatState.messages.length && chatState.isLoading) {
          return const ChatMessageBubble(
            message: '',
            isUser: false,
            isLoading: true,
          );
        }

        final message = chatState.messages[index];
        return ChatMessageBubble(
          message: message.content,
          isUser: message.isUser,
          timestamp: message.timestamp,
          metadata: message.metadata,
          isPinned: message.isPinned,
          messageIndex: index,
          onFollowUpTap: message.isUser
              ? null
              : (query) {
                  _messageController.text = query;
                  _sendMessage();
                },
          onPinToggle: message.isUser
              ? null
              : () {
                  final notifier = ref.read(chatbotProvider.notifier);
                  if (message.isPinned) {
                    notifier.unpinMessage();
                  } else {
                    notifier.pinMessage(index);
                  }
                },
        );
      },
    );
  }

  Widget _buildWelcomeScreen() {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.035),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: AppTheme.neonBlue.withValues(alpha: 0.16),
              ),
            ),
            child: Row(
              children: [
                AnimatedBuilder(
                  animation: _pulseAnimation,
                  builder: (context, child) => Transform.scale(
                    scale: 0.96 + (_pulseAnimation.value * 0.04),
                    child: child,
                  ),
                  child: Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: AppTheme.neonBlue.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: AppTheme.neonBlue.withValues(alpha: 0.28),
                      ),
                    ),
                    child: const Icon(
                      Icons.psychology,
                      color: AppTheme.neonBlue,
                      size: 24,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Text(
                    'Centro Comercial IA',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Briefing',
                  onPressed: () => _sendQuery(
                    'Resumen Glacius hoy con top clientes, pedidos y cobros',
                  ),
                  icon: const Icon(Icons.bolt_outlined),
                  color: AppTheme.neonBlue,
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          _buildCapabilityGrid(),
          const SizedBox(height: 18),
          _buildExampleQueries(),
        ],
      ),
    );
  }

  Widget _buildCapabilityGrid() {
    final capabilities = [
      (Icons.groups_2_outlined, 'Clientes', 'Ficha, deuda y compras'),
      (Icons.route_outlined, 'Rutero', 'Entregas y cobros'),
      (Icons.euro_outlined, 'Comisiones', 'Mes y acumulados'),
      (Icons.flag_outlined, 'Objetivos', 'Cumplimiento y familias'),
      (Icons.picture_as_pdf_outlined, 'Facturas', 'Detalle y PDF'),
      (Icons.ac_unit_outlined, 'Glacius', 'Panel y KPIs'),
      (Icons.account_balance_wallet_outlined, 'Bolsa', 'Saldo y movimientos'),
      (Icons.local_shipping_outlined, 'Almacen', 'Vehiculos y carga'),
    ];

    return Wrap(
      spacing: 12,
      runSpacing: 12,
      alignment: WrapAlignment.center,
      children: capabilities.map((cap) {
        final (icon, title, desc) = cap;
        return Container(
          width: 160,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.03),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
          ),
          child: Column(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppTheme.neonBlue.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(icon, color: AppTheme.neonBlue, size: 24),
              ),
              const SizedBox(height: 12),
              Text(
                title,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: Colors.white,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                desc,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 11,
                  color: Colors.grey.shade600,
                ),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }

  Widget _buildExampleQueries() {
    final currentClientCode = ref.watch(chatbotProvider).currentClientCode;
    final examples = [
      'Mi comision acumulada de enero a marzo.',
      'Objetivo acumulado ultimos 3 meses.',
      'Lee la factura F/100/2026 y dime lineas e importe.',
      'Resumen Glacius hoy y top clientes.',
      'Mi ruta hoy y cobros del repartidor.',
      if (currentClientCode != null)
        'Evalua el cliente $currentClientCode con deuda, facturas y pedidos.',
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4),
          child: Text(
            'PRUEBA PREGUNTAR',
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w600,
              color: Colors.grey.shade700,
              letterSpacing: 1.5,
            ),
          ),
        ),
        const SizedBox(height: 12),
        ...examples.map(
          (q) => Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: GestureDetector(
              onTap: () {
                _sendQuery(q);
              },
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.02),
                  borderRadius: BorderRadius.circular(8),
                  border:
                      Border.all(color: Colors.white.withValues(alpha: 0.06)),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.arrow_forward_ios,
                      size: 12,
                      color: AppTheme.neonBlue,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        q,
                        style: TextStyle(
                          fontSize: 13,
                          color: Colors.grey.shade400,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildInputArea() {
    final chatState = ref.watch(chatbotProvider);

    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 14),
      decoration: BoxDecoration(
        color: const Color(0xFF060914).withValues(alpha: 0.94),
        border: Border(
          top: BorderSide(color: AppTheme.neonBlue.withValues(alpha: 0.15)),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Expanded(
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        _ComposerTool(
                          icon: Icons.receipt_long_outlined,
                          label: 'Factura',
                          onTap: () => _sendQuery('lee la factura F/100/2026'),
                        ),
                        const SizedBox(width: 8),
                        _ComposerTool(
                          icon: Icons.flag_outlined,
                          label: 'Objetivo',
                          onTap: () => _sendQuery(
                            'objetivo acumulado ultimos 3 meses',
                          ),
                        ),
                        const SizedBox(width: 8),
                        _ComposerTool(
                          icon: Icons.euro_outlined,
                          label: 'Comision',
                          onTap: () => _sendQuery(
                            'mi comision acumulada ultimos 3 meses',
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Tooltip(
                  message: 'Historial de chats',
                  child: IconButton(
                    onPressed: _showHistorySheet,
                    icon: const Icon(Icons.history_rounded),
                    color: Colors.white70,
                    style: IconButton.styleFrom(
                      backgroundColor: Colors.white.withValues(alpha: 0.05),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                Tooltip(
                  message: 'Nuevo chat',
                  child: IconButton(
                    onPressed: chatState.isLoading
                        ? null
                        : () => ref
                            .read(chatbotProvider.notifier)
                            .startNewSession(),
                    icon: const Icon(Icons.add_comment_outlined),
                    color: Colors.white70,
                    style: IconButton.styleFrom(
                      backgroundColor: Colors.white.withValues(alpha: 0.05),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                Tooltip(
                  message: 'Reintentar ultimo mensaje',
                  child: IconButton(
                    onPressed: chatState.isLoading
                        ? null
                        : () => ref
                            .read(chatbotProvider.notifier)
                            .retryLastMessage(),
                    icon: const Icon(Icons.refresh_rounded),
                    color: Colors.white70,
                    style: IconButton.styleFrom(
                      backgroundColor: Colors.white.withValues(alpha: 0.05),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: Container(
                    constraints: const BoxConstraints(minHeight: 54),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.045),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: AppTheme.neonBlue.withValues(alpha: 0.22),
                      ),
                    ),
                    child: TextField(
                      controller: _messageController,
                      style: const TextStyle(color: Colors.white, fontSize: 15),
                      decoration: InputDecoration(
                        hintText:
                            'Pregunta por cliente, factura, objetivo, ruta...',
                        hintStyle: TextStyle(color: Colors.grey.shade600),
                        border: InputBorder.none,
                        prefixIcon: Icon(
                          Icons.manage_search,
                          color: AppTheme.neonBlue.withValues(alpha: 0.78),
                        ),
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 15,
                        ),
                      ),
                      keyboardType: TextInputType.multiline,
                      minLines: 1,
                      maxLines: 5,
                      textInputAction: TextInputAction.newline,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                SizedBox(
                  width: 54,
                  height: 54,
                  child: FilledButton(
                    onPressed: chatState.isLoading ? null : _sendMessage,
                    style: FilledButton.styleFrom(
                      padding: EdgeInsets.zero,
                      backgroundColor: chatState.isLoading
                          ? Colors.grey.shade800
                          : AppTheme.neonBlue,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                    child: Icon(
                      chatState.isLoading
                          ? Icons.hourglass_top
                          : Icons.send_rounded,
                      color: Colors.white,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({
    required this.icon,
    required this.label,
    required this.value,
    required this.accent,
  });

  final IconData icon;
  final String label;
  final String value;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minHeight: 34),
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: accent.withValues(alpha: 0.22)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: accent),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              color: Colors.grey.shade400,
              fontSize: 10,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(width: 5),
          Text(
            value,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 10,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _ComposerTool extends StatelessWidget {
  const _ComposerTool({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: 38),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.045),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: AppTheme.neonBlue),
            const SizedBox(width: 6),
            Text(
              label,
              style: const TextStyle(
                color: Colors.white70,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
