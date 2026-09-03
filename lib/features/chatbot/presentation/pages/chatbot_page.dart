import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_sync_header.dart'; // Import Sync Header
import 'package:gmp_app_mobilidad/features/chatbot/presentation/widgets/chat_message_bubble.dart';
import 'package:gmp_app_mobilidad/features/chatbot/providers/chatbot_provider.dart';

/// [ChatbotPage] - Professional AI Sales Assistant
///
/// Professional chat interface with:
/// - Clean professional design without childish emojis
/// - Quick action pills with icons
/// - Operational surfaces and restrained motion
class ChatbotPage extends ConsumerStatefulWidget {
  const ChatbotPage({
    required this.vendedorCodes,
    super.key,
    this.repartidorId,
  });

  final List<String> vendedorCodes;

  final String? repartidorId;
  @override
  ConsumerState<ChatbotPage> createState() => _ChatbotPageState();
}

class _ChatbotPageState extends ConsumerState<ChatbotPage>
    with SingleTickerProviderStateMixin {
  static final _background = AppTheme.inkSurface;
  static final _surface = AppTheme.raisedSurface;
  static final _surfaceRaised = AppTheme.softPanel;
  static final _line = AppTheme.borderColor;
  static const _mint = AppTheme.success;
  static const _cyan = AppTheme.info;
  static const _amber = AppTheme.accentAmber;
  static const _rose = AppTheme.accentRose;

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
    _syncChatbotContext();
  }

  @override
  void didUpdateWidget(covariant ChatbotPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.vendedorCodes.join(',') != widget.vendedorCodes.join(',') ||
        oldWidget.repartidorId != widget.repartidorId) {
      _syncChatbotContext();
    }
  }

  void _syncChatbotContext() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(chatbotProvider.notifier).setVendedorCodes(widget.vendedorCodes);
    });
    ref.read(chatbotProvider.notifier).setRepartidorScope(widget.repartidorId);
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
      backgroundColor: AppColors.transparent,
      builder: (sheetContext) {
        return Consumer(
          builder: (context, ref, _) {
            final sessions =
                ref.watch(chatbotProvider.select((state) => state.sessions));
            final activeSessionId = ref.watch(
              chatbotProvider.select((state) => state.activeSessionId),
            );

            return SafeArea(
              top: false,
              child: Container(
                constraints: BoxConstraints(
                  maxHeight: MediaQuery.of(context).size.height * 0.72,
                ),
                decoration: BoxDecoration(
                  color: AppTheme.raisedSurface,
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
                        color: AppColors.themedWhite24,
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 14, 12, 8),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.history_rounded,
                            color: AppTheme.info,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Historial de chats',
                              style: TextStyle(
                                color: AppColors.themedWhite,
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
                      color: AppTheme.info.withValues(alpha: 0.14),
                    ),
                    if (sessions.isEmpty)
                      Padding(
                        padding: const EdgeInsets.all(22),
                        child: Row(
                          children: [
                            Icon(
                              Icons.forum_outlined,
                              color:
                                  AppColors.themedWhite.withValues(alpha: 0.48),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Text(
                                'Todavia no hay conversaciones guardadas. '
                                'La primera consulta creara un historial.',
                                style: TextStyle(
                                  color: AppColors.systemGrey400,
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
                            final isActive = session.id == activeSessionId;
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
                                      ? AppTheme.info.withValues(alpha: 0.1)
                                      : AppColors.themedWhite
                                          .withValues(alpha: 0.035),
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(
                                    color: isActive
                                        ? AppTheme.info.withValues(alpha: 0.36)
                                        : AppColors.themedWhite
                                            .withValues(alpha: 0.08),
                                  ),
                                ),
                                child: Row(
                                  children: [
                                    Container(
                                      width: 38,
                                      height: 38,
                                      decoration: BoxDecoration(
                                        color: AppTheme.info
                                            .withValues(alpha: 0.12),
                                        borderRadius: BorderRadius.circular(8),
                                      ),
                                      child: Icon(
                                        isActive
                                            ? Icons.mark_chat_read_outlined
                                            : Icons.chat_bubble_outline,
                                        color: AppTheme.info,
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
                                            style: TextStyle(
                                              color: AppColors.themedWhite,
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
                                              color: AppColors.systemGrey500,
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
                                      color: AppColors.themedWhite54,
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

    final chatbotState = ref.watch(chatbotProvider.select((state) => (
          state.isLoading,
          state.error,
        )));
    final isLoading = chatbotState.$1;
    final chatbotError = chatbotState.$2;

    return Scaffold(
      backgroundColor: _background,
      body: Column(
        children: [
          SmartSyncHeader(
            title: isJefe ? 'Copiloto GMP (Supervisor)' : 'Copiloto GMP',
            subtitle: 'Datos comerciales, documentos y decisiones',
            lastSync: DateTime.now(),
            isLoading: isLoading,
            onSync: () => ref.read(chatbotProvider.notifier).clearChat(),
          ),
          Expanded(
            child: Container(
              decoration: BoxDecoration(color: _background),
              child: Column(
                children: [
                  _buildCommandCenter(isJefe),
                  if (chatbotError != null) _buildErrorBanner(),
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
                color: AppTheme.softPanel.withValues(alpha: 0.82),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: AppTheme.info.withValues(alpha: 0.3),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icon, color: AppTheme.info, size: 18),
                  const SizedBox(width: 8),
                  Text(
                    label,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      color: AppColors.themedWhite70,
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

  Widget _buildCommandCenter(bool isJefe) {
    final messages =
        ref.watch(chatbotProvider.select((state) => state.messages));
    final sessionCount = ref.watch(
      chatbotProvider.select((state) => state.sessions.length),
    );
    final documentCount = messages.fold<int>(
      0,
      (sum, message) => sum + message.metadata.documents.length,
    );
    final answerCount = messages.where((m) => !m.isUser).length;

    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 10),
      decoration: BoxDecoration(
        color: _surface.withValues(alpha: 0.96),
        border: Border(
          bottom: BorderSide(
            color: _line.withValues(alpha: 0.7),
          ),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      isJefe ? 'Mesa comercial completa' : 'Mesa comercial',
                      style: TextStyle(
                        color: AppColors.themedWhite,
                        fontSize: 15,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 0,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      isJefe
                          ? 'Supervisor: clientes, rutas, PDFs y objetivos'
                          : 'Cartera, ruta, cobros, pedidos y documentos',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: AppColors.systemGrey400,
                        fontSize: 11.5,
                        height: 1.2,
                      ),
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
                  color: _mint,
                  style: IconButton.styleFrom(
                    backgroundColor: _mint.withValues(alpha: 0.1),
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
                  onPressed: () => _sendQuery('que puedes hacer por pestañas'),
                  icon: const Icon(Icons.radar_outlined),
                  color: _cyan,
                  style: IconButton.styleFrom(
                    backgroundColor: _cyan.withValues(alpha: 0.1),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _StatusPill(
                icon: Icons.verified_user_outlined,
                label: isJefe ? 'Supervisor' : 'Comercial',
                value: isJefe ? 'todo' : 'cartera',
                accent: _mint,
              ),
              _StatusPill(
                icon: Icons.history,
                label: 'Historial',
                value: '$sessionCount',
                accent: _cyan,
              ),
              _StatusPill(
                icon: Icons.picture_as_pdf_outlined,
                label: 'PDF',
                value: '$documentCount',
                accent: _rose,
              ),
              _StatusPill(
                icon: Icons.analytics_outlined,
                label: 'Respuestas',
                value: '$answerCount',
                accent: _amber,
              ),
            ],
          ),
          const SizedBox(height: 12),
          _buildPlaybookStrip(),
          const SizedBox(height: 10),
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
        'Resumen Alertas hoy, top clientes y cobros',
      ),
      (
        Icons.manage_search_outlined,
        'Producto',
        'Dime el producto de migas y opciones parecidas',
      ),
      (
        Icons.receipt_long_outlined,
        'Factura',
        'Lee la factura F/100/2026 y ensename el PDF',
      ),
      (
        Icons.flag_outlined,
        'Objetivo',
        'Objetivo acumulado últimos 3 meses',
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
      height: 48,
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
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: selected
                      ? _mint.withValues(alpha: 0.14)
                      : AppColors.themedWhite.withValues(alpha: 0.045),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: selected
                        ? _mint.withValues(alpha: 0.44)
                        : _line.withValues(alpha: 0.8),
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      icon,
                      size: 16,
                      color: selected ? _mint : AppColors.themedWhite70,
                    ),
                    const SizedBox(width: 7),
                    Text(
                      label,
                      style: TextStyle(
                        color: selected
                            ? AppColors.themedWhite
                            : AppColors.themedWhite70,
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
        Icons.manage_search_outlined,
        'Producto',
        'Busca producto migas y dime opciones',
        _cyan,
      ),
      (
        Icons.groups_2_outlined,
        'Clientes',
        'Deuda, ventas, riesgo y compras de un cliente',
        _mint,
      ),
      (
        Icons.route_outlined,
        'Ruta',
        'Mi ruta hoy y cobros del repartidor',
        AppTheme.accentMint,
      ),
      (
        Icons.payments_outlined,
        'Comisiones',
        'Comision acumulada últimos 3 meses',
        _amber,
      ),
      (
        Icons.flag_outlined,
        'Objetivos',
        'Objetivo acumulado enero a marzo',
        AppTheme.accentIndigo,
      ),
      (
        Icons.picture_as_pdf_outlined,
        'PDF',
        'Lee la factura F/100/2026',
        _rose,
      ),
      (
        Icons.ac_unit_outlined,
        'Alertas',
        'Resumen Alertas hoy',
        AppTheme.info,
      ),
      (
        Icons.account_balance_wallet_outlined,
        'Bolsa',
        'Movimientos bolsa',
        AppTheme.accentIndigo,
      ),
      (
        Icons.local_shipping_outlined,
        'Almacen',
        'Camiones y vehiculos hoy',
        AppTheme.accentAmber,
      ),
    ];

    return SizedBox(
      height: 74,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: EdgeInsets.zero,
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
                width: 150,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.075),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: accent.withValues(alpha: 0.34)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Row(
                      children: [
                        Icon(icon, size: 17, color: accent),
                        const SizedBox(width: 7),
                        Expanded(
                          child: Text(
                            label,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: AppColors.themedWhite,
                              fontSize: 12,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 5),
                    Text(
                      query,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: AppColors.systemGrey400,
                        fontSize: 10,
                        height: 1.1,
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
              style: TextStyle(color: AppColors.systemGrey300, fontSize: 12.5),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMessageList() {
    final messages =
        ref.watch(chatbotProvider.select((state) => state.messages));
    final isLoading =
        ref.watch(chatbotProvider.select((state) => state.isLoading));

    if (messages.isEmpty) {
      return _buildWelcomeScreen();
    }

    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      itemCount: messages.length + (isLoading ? 1 : 0),
      itemBuilder: (context, index) {
        if (index == messages.length && isLoading) {
          return const ChatMessageBubble(
            message: '',
            isUser: false,
            isLoading: true,
          );
        }

        final message = messages[index];
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
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: _surfaceRaised.withValues(alpha: 0.88),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: _line.withValues(alpha: 0.9),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    AnimatedBuilder(
                      animation: _pulseAnimation,
                      builder: (context, child) => Transform.scale(
                        scale: 0.96 + (_pulseAnimation.value * 0.04),
                        child: child,
                      ),
                      child: Container(
                        width: 46,
                        height: 46,
                        decoration: BoxDecoration(
                          color: _mint.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: _mint.withValues(alpha: 0.36),
                          ),
                        ),
                        child: const Icon(
                          Icons.psychology_alt_outlined,
                          color: _mint,
                          size: 24,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Copiloto Comercial GMP',
                            style: TextStyle(
                              color: AppColors.themedWhite,
                              fontSize: 18,
                              fontWeight: FontWeight.w900,
                              letterSpacing: 0,
                            ),
                          ),
                          SizedBox(height: 3),
                          Text(
                            'Consulta clientes, rutas, facturas, objetivos y PDFs desde una sola conversacion.',
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: AppColors.themedWhite60,
                              fontSize: 12,
                              height: 1.25,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Tooltip(
                      message: 'Lanzar briefing comercial',
                      child: IconButton(
                        onPressed: () => _sendQuery(
                          'Resumen Alertas hoy con top clientes, pedidos y cobros',
                        ),
                        icon: const Icon(Icons.bolt_outlined),
                        color: _amber,
                        style: IconButton.styleFrom(
                          backgroundColor: _amber.withValues(alpha: 0.1),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                LayoutBuilder(
                  builder: (context, constraints) {
                    final compact = constraints.maxWidth < 520;
                    final cards = [
                      (
                        Icons.manage_search_outlined,
                        'Producto',
                        'Migas, precios, stock',
                        _cyan,
                      ),
                      (
                        Icons.groups_2_outlined,
                        'Cliente',
                        'Riesgo, deuda, compras',
                        _mint,
                      ),
                      (
                        Icons.picture_as_pdf_outlined,
                        'Factura PDF',
                        'Lineas, importes, archivo',
                        _rose,
                      ),
                    ];
                    return Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: cards.map((card) {
                        final (icon, title, detail, accent) = card;
                        return SizedBox(
                          width: compact
                              ? (constraints.maxWidth - 8) / 2
                              : (constraints.maxWidth - 16) / 3,
                          child: _WelcomeMetric(
                            icon: icon,
                            title: title,
                            detail: detail,
                            accent: accent,
                          ),
                        );
                      }).toList(),
                    );
                  },
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: () => _sendQuery(
                          'Que puedes hacer por pestañas',
                        ),
                        icon: const Icon(Icons.radar_outlined, size: 17),
                        label: const Text('Cobertura'),
                        style: FilledButton.styleFrom(
                          backgroundColor: _mint,
                          foregroundColor: AppTheme.inkSurface,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _showHistorySheet,
                        icon: const Icon(Icons.history_rounded, size: 17),
                        label: const Text('Historial'),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.themedWhite,
                          side: BorderSide(color: _line),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          _buildPriorityActions(),
          const SizedBox(height: 14),
          _buildCapabilityGrid(),
          const SizedBox(height: 18),
          _buildExampleQueries(),
        ],
      ),
    );
  }

  Widget _buildPriorityActions() {
    final actions = [
      (
        Icons.manage_search_outlined,
        'Producto',
        'Dime el producto de migas y opciones parecidas',
        'Catalogo, stock, precios',
        _cyan,
      ),
      (
        Icons.groups_2_outlined,
        'Cliente',
        'Evalua el cliente Central Hoteles',
        'Deuda, pedidos y riesgo',
        _mint,
      ),
      (
        Icons.picture_as_pdf_outlined,
        'Factura PDF',
        'Lee la factura F/100/2026 y ensename el PDF',
        'Lineas, importes, archivo',
        _rose,
      ),
      (
        Icons.bolt_outlined,
        'Briefing',
        'Resumen Alertas hoy con top clientes',
        'Ventas, cobros y pedidos',
        _amber,
      ),
      (
        Icons.flag_outlined,
        'Objetivos',
        'Objetivo acumulado de enero a marzo 2026',
        'Cumplimiento y familias',
        AppTheme.accentIndigo,
      ),
      (
        Icons.route_outlined,
        'Rutero',
        'Mi ruta hoy y cobros del repartidor',
        'Entregas y cobros',
        AppTheme.accentMint,
      ),
    ];

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: actions.length,
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 240,
        mainAxisExtent: 104,
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
      ),
      itemBuilder: (context, index) {
        final (icon, title, query, detail, accent) = actions[index];
        return TweenAnimationBuilder<double>(
          tween: Tween(begin: 0, end: 1),
          duration: Duration(milliseconds: 220 + index * 55),
          curve: Curves.easeOutCubic,
          builder: (context, value, child) => Opacity(
            opacity: value,
            child: Transform.translate(
              offset: Offset(0, 12 * (1 - value)),
              child: child,
            ),
          ),
          child: InkWell(
            borderRadius: BorderRadius.circular(8),
            onTap: () => _sendQuery(query),
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: _surfaceRaised.withValues(alpha: 0.72),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: accent.withValues(alpha: 0.34)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          color: accent.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Icon(icon, color: accent, size: 19),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: AppColors.themedWhite,
                            fontSize: 13,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ],
                  ),
                  Text(
                    detail,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: AppColors.systemGrey400,
                      fontSize: 11,
                      height: 1.15,
                    ),
                  ),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          query,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: accent,
                            fontSize: 10.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      Icon(
                        Icons.arrow_forward_rounded,
                        size: 15,
                        color: accent,
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildCapabilityGrid() {
    final capabilities = [
      (
        Icons.groups_2_outlined,
        'Clientes',
        'Ficha, deuda, compras, facturas y riesgo',
        _mint,
      ),
      (
        Icons.route_outlined,
        'Rutero',
        'Rutas, entregas, albaranes y cobros',
        AppTheme.accentMint,
      ),
      (
        Icons.euro_outlined,
        'Comisiones',
        'Generado, acumulado, meses y detalle',
        _amber,
      ),
      (
        Icons.flag_outlined,
        'Objetivos',
        'Mes, acumulado, familias y desviaciones',
        AppTheme.accentIndigo,
      ),
      (
        Icons.picture_as_pdf_outlined,
        'Facturas',
        'Cabecera, lineas, importes y PDF',
        _rose,
      ),
      (
        Icons.ac_unit_outlined,
        'Alertas',
        'Ventas, actividad, pedidos y cobros',
        AppTheme.info,
      ),
      (
        Icons.account_balance_wallet_outlined,
        'Bolsa',
        'Saldo, movimientos y contexto comercial',
        AppTheme.accentIndigo,
      ),
      (
        Icons.local_shipping_outlined,
        'Almacen',
        'Camiones, carga, stock y vehiculos',
        AppTheme.accentAmber,
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _SectionLabel(
          icon: Icons.dashboard_customize_outlined,
          label: 'Cobertura por pestañas',
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: capabilities.map((cap) {
            final (icon, title, desc, accent) = cap;
            return SizedBox(
              width: 168,
              child: _CapabilityCard(
                icon: icon,
                title: title,
                description: desc,
                accent: accent,
              ),
            );
          }).toList(),
        ),
      ],
    );
  }

  Widget _buildExampleQueries() {
    final currentClientCode =
        ref.watch(chatbotProvider.select((state) => state.currentClientCode));
    final examples = [
      (
        Icons.payments_outlined,
        'Comisiones',
        'Mi comision acumulada de enero a marzo.',
      ),
      (
        Icons.flag_outlined,
        'Objetivos',
        'Objetivo acumulado últimos 3 meses.',
      ),
      (
        Icons.picture_as_pdf_outlined,
        'Factura',
        'Lee la factura F/100/2026 y dime lineas e importe.',
      ),
      (
        Icons.ac_unit_outlined,
        'Alertas',
        'Resumen Alertas hoy y top clientes.',
      ),
      (
        Icons.route_outlined,
        'Rutero',
        'Mi ruta hoy y cobros del repartidor.',
      ),
      if (currentClientCode != null)
        (
          Icons.groups_2_outlined,
          'Cliente',
          'Evalua el cliente $currentClientCode con deuda, facturas y pedidos.',
        ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _SectionLabel(
          icon: Icons.auto_awesome_motion_outlined,
          label: 'Preguntas listas para lanzar',
        ),
        const SizedBox(height: 10),
        ...examples.map(
          (item) {
            final (icon, label, query) = item;
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _PromptTile(
                icon: icon,
                label: label,
                query: query,
                onTap: () => _sendQuery(query),
              ),
            );
          },
        ),
      ],
    );
  }

  Widget _buildInputArea() {
    final isLoading =
        ref.watch(chatbotProvider.select((state) => state.isLoading));

    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 14),
      decoration: BoxDecoration(
        color: _surface.withValues(alpha: 0.98),
        border: Border(
          top: BorderSide(color: _line.withValues(alpha: 0.85)),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        _ComposerTool(
                          icon: Icons.manage_search_outlined,
                          label: 'Producto',
                          onTap: () => _sendQuery(
                            'Dime el producto de migas y opciones parecidas',
                          ),
                        ),
                        const SizedBox(width: 8),
                        _ComposerTool(
                          icon: Icons.receipt_long_outlined,
                          label: 'Factura',
                          onTap: () => _sendQuery(
                            'Lee la factura F/100/2026 y ensename el PDF',
                          ),
                        ),
                        const SizedBox(width: 8),
                        _ComposerTool(
                          icon: Icons.groups_2_outlined,
                          label: 'Cliente',
                          onTap: () => _sendQuery(
                            'Evalua el cliente Central Hoteles',
                          ),
                        ),
                        const SizedBox(width: 8),
                        _ComposerTool(
                          icon: Icons.flag_outlined,
                          label: 'Objetivo',
                          onTap: () => _sendQuery(
                            'objetivo acumulado últimos 3 meses',
                          ),
                        ),
                        const SizedBox(width: 8),
                        _ComposerTool(
                          icon: Icons.euro_outlined,
                          label: 'Comision',
                          onTap: () => _sendQuery(
                            'mi comision acumulada últimos 3 meses',
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
                    color: _mint,
                    style: IconButton.styleFrom(
                      backgroundColor: _mint.withValues(alpha: 0.08),
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
                    onPressed: isLoading
                        ? null
                        : () => ref
                            .read(chatbotProvider.notifier)
                            .startNewSession(),
                    icon: const Icon(Icons.add_comment_outlined),
                    color: _cyan,
                    style: IconButton.styleFrom(
                      backgroundColor: _cyan.withValues(alpha: 0.08),
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
                    onPressed: isLoading
                        ? null
                        : () => ref
                            .read(chatbotProvider.notifier)
                            .retryLastMessage(),
                    icon: const Icon(Icons.refresh_rounded),
                    color: _amber,
                    style: IconButton.styleFrom(
                      backgroundColor: _amber.withValues(alpha: 0.08),
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
                      color: _background.withValues(alpha: 0.72),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: isLoading
                            ? _amber.withValues(alpha: 0.42)
                            : _mint.withValues(alpha: 0.28),
                      ),
                    ),
                    child: TextField(
                      controller: _messageController,
                      style:
                          TextStyle(color: AppColors.themedWhite, fontSize: 15),
                      decoration: InputDecoration(
                        hintText:
                            'Pregunta por cliente, producto, factura, ruta, objetivo...',
                        hintStyle: TextStyle(color: AppColors.systemGrey500),
                        border: InputBorder.none,
                        prefixIcon: Icon(
                          isLoading
                              ? Icons.hourglass_top_rounded
                              : Icons.manage_search,
                          color: isLoading ? _amber : _mint,
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
                    onPressed: isLoading ? null : _sendMessage,
                    style: FilledButton.styleFrom(
                      padding: EdgeInsets.zero,
                      backgroundColor:
                          isLoading ? AppColors.systemGrey800 : _mint,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                    child: Icon(
                      isLoading ? Icons.hourglass_top : Icons.send_rounded,
                      color: isLoading
                          ? AppColors.themedWhite70
                          : AppTheme.inkSurface,
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

class _WelcomeMetric extends StatelessWidget {
  const _WelcomeMetric({
    required this.icon,
    required this.title,
    required this.detail,
    required this.accent,
  });

  final IconData icon;
  final String title;
  final String detail;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minHeight: 72),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: accent.withValues(alpha: 0.28)),
      ),
      child: Row(
        children: [
          Icon(icon, color: accent, size: 20),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: AppColors.themedWhite,
                    fontSize: 12,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  detail,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: AppColors.systemGrey400,
                    fontSize: 10.5,
                    height: 1.15,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel({
    required this.icon,
    required this.label,
  });

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, color: AppTheme.success, size: 16),
        const SizedBox(width: 7),
        Text(
          label.toUpperCase(),
          style: TextStyle(
            color: AppColors.systemGrey400,
            fontSize: 10.5,
            fontWeight: FontWeight.w800,
            letterSpacing: 0,
          ),
        ),
      ],
    );
  }
}

class _CapabilityCard extends StatelessWidget {
  const _CapabilityCard({
    required this.icon,
    required this.title,
    required this.description,
    required this.accent,
  });

  final IconData icon;
  final String title;
  final String description;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minHeight: 106),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.softPanel.withValues(alpha: 0.74),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: accent.withValues(alpha: 0.28)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: accent, size: 18),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: AppColors.themedWhite,
                    fontSize: 12.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 9),
          Text(
            description,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: AppColors.systemGrey400,
              fontSize: 11,
              height: 1.2,
            ),
          ),
        ],
      ),
    );
  }
}

class _PromptTile extends StatelessWidget {
  const _PromptTile({
    required this.icon,
    required this.label,
    required this.query,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final String query;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
        decoration: BoxDecoration(
          color: AppTheme.raisedSurface.withValues(alpha: 0.78),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: AppTheme.borderColor),
        ),
        child: Row(
          children: [
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: AppTheme.success.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(icon, color: AppTheme.success, size: 17),
            ),
            const SizedBox(width: 10),
            SizedBox(
              width: 88,
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: AppColors.themedWhite,
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                query,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: AppColors.systemGrey400,
                  fontSize: 12,
                  height: 1.2,
                ),
              ),
            ),
            const SizedBox(width: 8),
            const Icon(
              Icons.arrow_forward_rounded,
              color: AppTheme.success,
              size: 17,
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
              color: AppColors.systemGrey400,
              fontSize: 10,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(width: 5),
          Text(
            value,
            style: TextStyle(
              color: AppColors.themedWhite,
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
          color: AppColors.themedWhite.withValues(alpha: 0.045),
          borderRadius: BorderRadius.circular(8),
          border:
              Border.all(color: AppColors.themedWhite.withValues(alpha: 0.08)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: AppTheme.info),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                color: AppColors.themedWhite70,
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
