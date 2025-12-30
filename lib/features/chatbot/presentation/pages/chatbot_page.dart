import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/theme/app_theme.dart';
import '../../providers/chatbot_provider.dart';
import '../widgets/chat_message_bubble.dart';

/// [ChatbotPage] - Professional AI Sales Assistant
/// 
/// Premium futuristic chat interface with:
/// - Clean professional design without childish emojis
/// - Quick action pills with icons
/// - Gradient accents and glowing effects
class ChatbotPage extends StatefulWidget {
  const ChatbotPage({
    super.key,
    required this.vendedorCodes,
  });

  final List<String> vendedorCodes;

  @override
  State<ChatbotPage> createState() => _ChatbotPageState();
}

class _ChatbotPageState extends State<ChatbotPage> with SingleTickerProviderStateMixin {
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  late ChatbotProvider _provider;
  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;

  @override
  void initState() {
    super.initState();
    _provider = ChatbotProvider(vendedorCodes: widget.vendedorCodes);
    _pulseController = AnimationController(
      duration: const Duration(milliseconds: 2000),
      vsync: this,
    )..repeat(reverse: true);
    _pulseAnimation = Tween<double>(begin: 0.8, end: 1.0).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    _pulseController.dispose();
    _provider.dispose();
    super.dispose();
  }

  void _sendMessage() {
    final text = _messageController.text.trim();
    if (text.isEmpty) return;

    _provider.sendMessage(text);
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
    return ChangeNotifierProvider.value(
      value: _provider,
      child: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              const Color(0xFF0A0E21),
              const Color(0xFF0D1320),
              const Color(0xFF0A0E21),
            ],
          ),
        ),
        child: Column(
          children: [
            _buildHeader(),
            _buildQuickActions(),
            Expanded(child: _buildMessageList()),
            _buildInputArea(),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.3),
        border: Border(
          bottom: BorderSide(
            color: AppTheme.neonBlue.withOpacity(0.2),
            width: 1,
          ),
        ),
      ),
      child: Row(
        children: [
          // AI Avatar with glow
          AnimatedBuilder(
            animation: _pulseAnimation,
            builder: (context, child) => Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    AppTheme.neonBlue,
                    AppTheme.neonPurple,
                  ],
                ),
                borderRadius: BorderRadius.circular(16),
                boxShadow: [
                  BoxShadow(
                    color: AppTheme.neonBlue.withOpacity(0.3 * _pulseAnimation.value),
                    blurRadius: 20,
                    spreadRadius: 2,
                  ),
                ],
              ),
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Icon(Icons.psychology, color: Colors.white, size: 28),
                  Positioned(
                    right: 6,
                    bottom: 6,
                    child: Container(
                      width: 12,
                      height: 12,
                      decoration: BoxDecoration(
                        color: AppTheme.neonGreen,
                        shape: BoxShape.circle,
                        border: Border.all(color: const Color(0xFF0A0E21), width: 2),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 16),
          
          // Title and status
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ShaderMask(
                  shaderCallback: (bounds) => LinearGradient(
                    colors: [AppTheme.neonBlue, AppTheme.neonPurple],
                  ).createShader(bounds),
                  child: const Text(
                    'NEXUS AI',
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 2,
                      color: Colors.white,
                    ),
                  ),
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(
                        color: AppTheme.neonGreen,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      'Asistente Comercial Activo',
                      style: TextStyle(
                        fontSize: 11,
                        color: Colors.grey.shade500,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          
          // Clear chat
          Consumer<ChatbotProvider>(
            builder: (context, provider, _) {
              if (provider.messages.isEmpty) return const SizedBox();
              return IconButton(
                icon: Icon(Icons.delete_outline, color: Colors.grey.shade600, size: 22),
                onPressed: () => provider.clearChat(),
                tooltip: 'Limpiar',
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _buildQuickActions() {
    // Professional quick actions without emojis
    final quickActions = [
      (Icons.attach_money, 'Margen Global', 'margin'),
      (Icons.trending_up, 'Precios', 'precios'),
      (Icons.account_balance_wallet, 'Deuda Cliente', 'deuda'),
      (Icons.local_offer, 'Promociones', 'promociones'),
      (Icons.inventory, 'Stock', 'stock'),
      (Icons.analytics, 'Comparativa', 'comparar'),
    ];

    return Container(
      height: 56,
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
              _messageController.text = label;
              _sendMessage();
            },
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    AppTheme.neonBlue.withOpacity(0.1),
                    AppTheme.neonPurple.withOpacity(0.05),
                  ],
                ),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: AppTheme.neonBlue.withOpacity(0.3),
                  width: 1,
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

  Widget _buildMessageList() {
    return Consumer<ChatbotProvider>(
      builder: (context, provider, _) {
        if (provider.messages.isEmpty) {
          return _buildWelcomeScreen();
        }

        return ListView.builder(
          controller: _scrollController,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          itemCount: provider.messages.length + (provider.isLoading ? 1 : 0),
          itemBuilder: (context, index) {
            if (index == provider.messages.length && provider.isLoading) {
              return const ChatMessageBubble(
                message: '',
                isUser: false,
                isLoading: true,
              );
            }
            
            final message = provider.messages[index];
            return ChatMessageBubble(
              message: message.content,
              isUser: message.isUser,
              timestamp: message.timestamp,
            );
          },
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
          Container(
            width: 100,
            height: 100,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [AppTheme.neonBlue.withOpacity(0.2), AppTheme.neonPurple.withOpacity(0.1)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
            ),
            child: Icon(Icons.psychology, size: 50, color: AppTheme.neonBlue),
          ),
          const SizedBox(height: 28),
          
          // Title
          ShaderMask(
            shaderCallback: (bounds) => LinearGradient(
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
            'Consulta precios, márgenes, deudas,\nstock y estrategias comerciales.',
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
      (Icons.attach_money, 'Márgenes', 'Análisis por cliente o global'),
      (Icons.local_offer, 'Precios', 'Mínimos y sugeridos'),
      (Icons.account_balance_wallet, 'Deudas', 'Estado de cobro'),
      (Icons.trending_up, 'Ventas', 'YoY y tendencias'),
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
            color: Colors.white.withOpacity(0.03),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.white.withOpacity(0.08)),
          ),
          child: Column(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppTheme.neonBlue.withOpacity(0.1),
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
    final examples = [
      '¿Cuál es mi margen global este mes?',
      '¿A qué precio puedo vender el producto ABC?',
      '¿Cuánto debe el cliente 12345?',
      'Comparar ventas 2024 vs 2023',
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
        ...examples.map((q) => Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: GestureDetector(
            onTap: () {
              _messageController.text = q;
              _sendMessage();
            },
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.02),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.white.withOpacity(0.06)),
              ),
              child: Row(
                children: [
                  Icon(Icons.arrow_forward_ios, size: 12, color: AppTheme.neonBlue),
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
        )),
      ],
    );
  }

  Widget _buildInputArea() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.4),
        border: Border(
          top: BorderSide(color: AppTheme.neonBlue.withOpacity(0.15)),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Row(
          children: [
            Expanded(
              child: Container(
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.05),
                  borderRadius: BorderRadius.circular(28),
                  border: Border.all(color: AppTheme.neonBlue.withOpacity(0.2)),
                ),
                child: TextField(
                  controller: _messageController,
                  style: const TextStyle(color: Colors.white, fontSize: 15),
                  decoration: InputDecoration(
                    hintText: 'Escribe tu consulta...',
                    hintStyle: TextStyle(color: Colors.grey.shade600),
                    border: InputBorder.none,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                  ),
                  textInputAction: TextInputAction.send,
                  onSubmitted: (_) => _sendMessage(),
                ),
              ),
            ),
            const SizedBox(width: 12),
            
            Consumer<ChatbotProvider>(
              builder: (context, provider, _) {
                return GestureDetector(
                  onTap: provider.isLoading ? null : _sendMessage,
                  child: Container(
                    width: 54,
                    height: 54,
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: provider.isLoading
                            ? [Colors.grey.shade800, Colors.grey.shade800]
                            : [AppTheme.neonBlue, AppTheme.neonPurple],
                      ),
                      borderRadius: BorderRadius.circular(27),
                      boxShadow: provider.isLoading ? [] : [
                        BoxShadow(
                          color: AppTheme.neonBlue.withOpacity(0.4),
                          blurRadius: 16,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Icon(
                      provider.isLoading ? Icons.hourglass_top : Icons.send_rounded,
                      color: Colors.white,
                      size: 24,
                    ),
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}
