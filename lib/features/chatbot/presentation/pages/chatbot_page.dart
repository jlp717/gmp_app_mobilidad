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

  @override
  Widget build(BuildContext context) {
    // Check role for custom message
    final authState = ref.read(authProvider).value;
    final isJefe = (authState?.user?.isDirector ?? false) ||
        widget.vendedorCodes.length > 1;

    final chatbotState = ref.watch(chatbotProvider);

    return Scaffold(
      // Wrapped in Scaffold for safety
      backgroundColor: const Color(0xFF0A0E21),
      body: Column(
        children: [
          SmartSyncHeader(
            title: isJefe ? 'NEXUS AI (Supervisor)' : 'NEXUS AI',
            subtitle: 'Asistente Comercial Inteligente',
            lastSync: DateTime.now(),
            isLoading: chatbotState.isLoading,
            onSync: () => ref
                .read(chatbotProvider.notifier)
                .clearChat(), // Clear as sync/reset action
          ),
          Expanded(
            child: Column(
              children: [
                _buildQuickActions(),
                if (chatbotState.error != null) _buildErrorBanner(),
                Expanded(child: _buildMessageList()),
                _buildInputArea(),
              ],
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
            onTap: () {
              _messageController.text = query;
              _sendMessage();
            },
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    AppTheme.neonBlue.withValues(alpha: 0.1),
                    AppTheme.neonPurple.withValues(alpha: 0.05),
                  ],
                ),
                borderRadius: BorderRadius.circular(12),
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
        );
      },
    );
  }

  Widget _buildWelcomeScreen() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        children: [
          const SizedBox(height: 40),
          // AI Logo
          AnimatedBuilder(
            animation: _pulseAnimation,
            builder: (context, child) => Transform.scale(
              scale: _pulseAnimation.value,
              child: child,
            ),
            child: Container(
              width: 100,
              height: 100,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    AppTheme.neonBlue.withValues(alpha: 0.2),
                    AppTheme.neonPurple.withValues(alpha: 0.1),
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(24),
                border: Border.all(
                  color: AppTheme.neonBlue.withValues(alpha: 0.3),
                ),
                boxShadow: [
                  BoxShadow(
                    color: AppTheme.neonBlue.withValues(alpha: 0.18),
                    blurRadius: 28,
                    spreadRadius: 2,
                  ),
                ],
              ),
              child: const Icon(
                Icons.psychology,
                size: 50,
                color: AppTheme.neonBlue,
              ),
            ),
          ),
          const SizedBox(height: 28),

          // Title
          ShaderMask(
            shaderCallback: (bounds) => const LinearGradient(
              colors: [AppTheme.neonBlue, AppTheme.neonPurple],
            ).createShader(bounds),
            child: const Text(
              'Asistente de Ventas',
              style: TextStyle(
                fontSize: 26,
                fontWeight: FontWeight.bold,
                color: Colors.white,
                letterSpacing: 1,
              ),
            ),
          ),
          const SizedBox(height: 12),

          Text(
            'Consulta navegación, facturas, pedidos, deudas,\nstock y estrategias comerciales.',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 14,
              color: Colors.grey.shade500,
              height: 1.6,
            ),
          ),
          const SizedBox(height: 40),

          // Capability cards
          _buildCapabilityGrid(),

          const SizedBox(height: 32),

          // Example queries
          _buildExampleQueries(),
        ],
      ),
    );
  }

  Widget _buildCapabilityGrid() {
    final capabilities = [
      (Icons.explore_outlined, 'Navegación', 'Guía por módulos clave'),
      (Icons.receipt_long_outlined, 'Facturas', 'Pendientes y revisión'),
      (Icons.shopping_cart_outlined, 'Pedidos', 'Estado y oportunidades'),
      (Icons.query_stats_outlined, 'Evaluar', 'Prioridades comerciales'),
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
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
          ),
          child: Column(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppTheme.neonBlue.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(12),
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
      'Guíame para revisar facturas, pedidos y deuda de un cliente.',
      'Evalúa qué clientes necesitan atención comercial hoy.',
      'Resume pedidos recientes y riesgos de stock.',
      'Explícame cómo revisar comisiones y margen global.',
      if (currentClientCode != null)
        'Evalúa el cliente $currentClientCode con deuda, facturas y pedidos.',
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
                _messageController.text = q;
                _sendMessage();
              },
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.02),
                  borderRadius: BorderRadius.circular(12),
                  border:
                      Border.all(color: Colors.white.withValues(alpha: 0.06)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.arrow_forward_ios,
                        size: 12, color: AppTheme.neonBlue),
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
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.4),
        border: Border(
          top: BorderSide(color: AppTheme.neonBlue.withValues(alpha: 0.15)),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Row(
          children: [
            Expanded(
              child: Container(
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.05),
                  borderRadius: BorderRadius.circular(28),
                  border: Border.all(
                      color: AppTheme.neonBlue.withValues(alpha: 0.2)),
                ),
                child: TextField(
                  controller: _messageController,
                  style: const TextStyle(color: Colors.white, fontSize: 15),
                  decoration: InputDecoration(
                    hintText: 'Escribe tu consulta...',
                    hintStyle: TextStyle(color: Colors.grey.shade600),
                    border: InputBorder.none,
                    contentPadding: const EdgeInsets.symmetric(
                        horizontal: 20, vertical: 14),
                  ),
                  keyboardType: TextInputType.multiline,
                  minLines: 1,
                  maxLines: 5,
                  textInputAction: TextInputAction.newline,
                ),
              ),
            ),
            const SizedBox(width: 12),
            GestureDetector(
              onTap: chatState.isLoading ? null : _sendMessage,
              child: Container(
                width: 54,
                height: 54,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: chatState.isLoading
                        ? [Colors.grey.shade800, Colors.grey.shade800]
                        : [AppTheme.neonBlue, AppTheme.neonPurple],
                  ),
                  borderRadius: BorderRadius.circular(27),
                  boxShadow: chatState.isLoading
                      ? []
                      : [
                          BoxShadow(
                            color: AppTheme.neonBlue.withValues(alpha: 0.4),
                            blurRadius: 16,
                            offset: const Offset(0, 4),
                          ),
                        ],
                ),
                child: Icon(
                  chatState.isLoading
                      ? Icons.hourglass_top
                      : Icons.send_rounded,
                  color: Colors.white,
                  size: 24,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
