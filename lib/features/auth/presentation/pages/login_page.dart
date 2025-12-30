import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'dart:math' as math;

import '../../../../core/theme/app_theme.dart';
import '../../../../core/providers/auth_provider.dart';

/// Página de login ultra-moderna con diseño futurista neón
class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> with TickerProviderStateMixin {
  final _formKey = GlobalKey<FormState>();
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;
  late AnimationController _glowController;
  late AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _glowController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 3),
    )..repeat(reverse: true);
    
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _usernameController.dispose();
    _passwordController.dispose();
    _glowController.dispose();
    _pulseController.dispose();
    super.dispose();
  }

  Future<void> _handleLogin() async {
    if (_formKey.currentState!.validate()) {
      final authProvider = context.read<AuthProvider>();
      final success = await authProvider.login(
        _usernameController.text,
        _passwordController.text,
      );

      if (success && mounted) {
        context.go('/dashboard');
      } else if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(Icons.error_outline, color: Colors.white),
                const SizedBox(width: 12),
                Expanded(child: Text(authProvider.error ?? 'Error de inicio de sesión')),
              ],
            ),
            backgroundColor: AppTheme.error,
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            duration: const Duration(seconds: 4),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    
    return Scaffold(
      body: Stack(
        children: [
          // Fondo animado con gradiente
          _buildAnimatedBackground(),
          
          // Decoraciones geométricas flotantes
          ..._buildFloatingShapes(),
          
          // Contenido principal
          Center(
            child: SingleChildScrollView(
              child: Padding(
                padding: const EdgeInsets.all(32.0),
                child: size.width > 900 
                  ? _buildWideLayout(size) 
                  : _buildNarrowLayout(size),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAnimatedBackground() {
    return AnimatedBuilder(
      animation: _glowController,
      builder: (context, child) {
        return Container(
          decoration: BoxDecoration(
            gradient: RadialGradient(
              center: Alignment(
                math.sin(_glowController.value * math.pi * 2) * 0.5,
                math.cos(_glowController.value * math.pi * 2) * 0.5,
              ),
              radius: 1.5,
              colors: [
                AppTheme.neonBlue.withOpacity(0.15),
                AppTheme.darkBase,
                AppTheme.darkSurface.withOpacity(0.95),
                AppTheme.neonPurple.withOpacity(0.08),
              ],
              stops: const [0.0, 0.3, 0.7, 1.0],
            ),
          ),
        );
      },
    );
  }

  List<Widget> _buildFloatingShapes() {
    return [
      // Círculo superior derecho
      Positioned(
        top: -80,
        right: -80,
        child: AnimatedBuilder(
          animation: _pulseController,
          builder: (context, child) {
            return Container(
              width: 300,
              height: 300,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [
                    AppTheme.neonBlue.withOpacity(0.2 + _pulseController.value * 0.1),
                    Colors.transparent,
                  ],
                ),
              ),
            );
          },
        ),
      ),
      // Círculo inferior izquierdo
      Positioned(
        bottom: -120,
        left: -120,
        child: AnimatedBuilder(
          animation: _pulseController,
          builder: (context, child) {
            return Container(
              width: 400,
              height: 400,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [
                    AppTheme.neonPurple.withOpacity(0.15 + _pulseController.value * 0.1),
                    Colors.transparent,
                  ],
                ),
              ),
            );
          },
        ),
      ),
      // Líneas decorativas
      Positioned(
        top: 100,
        left: 50,
        child: Transform.rotate(
          angle: math.pi / 6,
          child: Container(
            width: 200,
            height: 2,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  Colors.transparent,
                  AppTheme.neonBlue.withOpacity(0.5),
                  Colors.transparent,
                ],
              ),
            ),
          ),
        ).animate(onPlay: (c) => c.repeat())
          .shimmer(duration: 3.seconds, color: AppTheme.neonBlue.withOpacity(0.3)),
      ),
    ];
  }

  Widget _buildWideLayout(Size size) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        // Lado izquierdo - Branding
        Expanded(
          flex: 1,
          child: _buildBrandingSection(),
        ),
        const SizedBox(width: 80),
        // Lado derecho - Formulario
        Expanded(
          flex: 1,
          child: _buildLoginCard(),
        ),
      ],
    );
  }

  Widget _buildNarrowLayout(Size size) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        _buildBrandingSection(),
        const SizedBox(height: 48),
        _buildLoginCard(),
      ],
    );
  }

  Widget _buildBrandingSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        // Logo animado
        AnimatedBuilder(
          animation: _glowController,
          builder: (context, child) {
            return Container(
              width: 100,
              height: 100,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(24),
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    AppTheme.neonBlue,
                    AppTheme.neonPurple,
                  ],
                ),
                boxShadow: [
                  BoxShadow(
                    color: AppTheme.neonBlue.withOpacity(0.3 + _glowController.value * 0.3),
                    blurRadius: 30 + _glowController.value * 20,
                    spreadRadius: 5,
                  ),
                ],
              ),
              child: const Icon(
                Icons.analytics_rounded,
                size: 50,
                color: Colors.white,
              ),
            );
          },
        ).animate()
          .fadeIn(duration: 600.ms)
          .scale(delay: 200.ms, curve: Curves.easeOutBack),
        
        const SizedBox(height: 40),
        
        // Título con gradiente
        ShaderMask(
          shaderCallback: (bounds) => LinearGradient(
            colors: [AppTheme.neonBlue, AppTheme.neonPurple, AppTheme.neonPink],
          ).createShader(bounds),
          child: const Text(
            'GMP\nMobilidad',
            style: TextStyle(
              fontSize: 56,
              fontWeight: FontWeight.w700,
              height: 1.0,
              color: Colors.white,
              letterSpacing: -2,
            ),
          ),
        ).animate()
          .fadeIn(delay: 300.ms, duration: 600.ms)
          .slideX(begin: -0.3, end: 0, curve: Curves.easeOutCubic),
        
        const SizedBox(height: 20),
        
        // Subtítulo
        Text(
          'Plataforma de Análisis de Ventas\nInteligencia Comercial en Tiempo Real',
          style: TextStyle(
            fontSize: 16,
            color: AppTheme.textSecondary.withOpacity(0.8),
            height: 1.6,
            letterSpacing: 0.5,
          ),
        ).animate()
          .fadeIn(delay: 500.ms, duration: 600.ms),
        
        const SizedBox(height: 32),
        
        // Badges de características
        Wrap(
          spacing: 12,
          runSpacing: 8,
          children: [
            _buildFeatureBadge('AI Chatbot', Icons.smart_toy_outlined),
            _buildFeatureBadge('Tiempo Real', Icons.speed_outlined),
            _buildFeatureBadge('Analytics', Icons.insights_outlined),
          ],
        ).animate()
          .fadeIn(delay: 700.ms, duration: 400.ms),
      ],
    );
  }

  Widget _buildFeatureBadge(String label, IconData icon) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
        color: AppTheme.neonBlue.withOpacity(0.1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: AppTheme.neonBlue),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: AppTheme.neonBlue,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLoginCard() {
    return Container(
      constraints: const BoxConstraints(maxWidth: 420),
      padding: const EdgeInsets.all(40),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(32),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Colors.white.withOpacity(0.08),
            Colors.white.withOpacity(0.03),
          ],
        ),
        border: Border.all(
          color: Colors.white.withOpacity(0.1),
          width: 1.5,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.3),
            blurRadius: 40,
            offset: const Offset(0, 20),
          ),
        ],
      ),
      child: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Header
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(12),
                    color: AppTheme.neonBlue.withOpacity(0.1),
                  ),
                  child: const Icon(Icons.login_rounded, color: AppTheme.neonBlue, size: 24),
                ),
                const SizedBox(width: 16),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Iniciar Sesión',
                        style: TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.w600,
                          color: AppTheme.textPrimary,
                        ),
                      ),
                      Text(
                        'Accede a tu panel de control',
                        style: TextStyle(
                          fontSize: 13,
                          color: AppTheme.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            
            const SizedBox(height: 40),
            
            // Campo Usuario
            _buildTextField(
              controller: _usernameController,
              label: 'Usuario',
              hint: 'Tu código de usuario',
              icon: Icons.person_outline_rounded,
              validator: (v) => v?.isEmpty == true ? 'Ingresa tu usuario' : null,
            ),
            
            const SizedBox(height: 20),
            
            // Campo Contraseña
            _buildTextField(
              controller: _passwordController,
              label: 'Contraseña',
              hint: '••••••••',
              icon: Icons.lock_outline_rounded,
              obscure: _obscurePassword,
              suffixIcon: IconButton(
                icon: Icon(
                  _obscurePassword ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                  color: AppTheme.textSecondary,
                  size: 20,
                ),
                onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
              ),
              validator: (v) => v?.isEmpty == true ? 'Ingresa tu contraseña' : null,
              onSubmit: (_) => _handleLogin(),
            ),
            
            const SizedBox(height: 36),
            
            // Botón Login
            Consumer<AuthProvider>(
              builder: (context, auth, _) {
                return AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  height: 56,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(16),
                    gradient: auth.isLoading 
                      ? null 
                      : const LinearGradient(
                          colors: [AppTheme.neonBlue, AppTheme.neonPurple],
                        ),
                    color: auth.isLoading ? AppTheme.surfaceColor : null,
                    boxShadow: auth.isLoading ? [] : [
                      BoxShadow(
                        color: AppTheme.neonBlue.withOpacity(0.4),
                        blurRadius: 20,
                        offset: const Offset(0, 8),
                      ),
                    ],
                  ),
                  child: Material(
                    color: Colors.transparent,
                    child: InkWell(
                      borderRadius: BorderRadius.circular(16),
                      onTap: auth.isLoading ? null : _handleLogin,
                      child: Center(
                        child: auth.isLoading
                          ? const SizedBox(
                              width: 24,
                              height: 24,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.5,
                                color: AppTheme.neonBlue,
                              ),
                            )
                          : const Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Text(
                                  'Acceder',
                                  style: TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w600,
                                    color: Colors.white,
                                    letterSpacing: 0.5,
                                  ),
                                ),
                                SizedBox(width: 8),
                                Icon(Icons.arrow_forward_rounded, color: Colors.white, size: 20),
                              ],
                            ),
                      ),
                    ),
                  ),
                );
              },
            ),
            
            const SizedBox(height: 28),
            
            // Footer
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width: 6,
                  height: 6,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppTheme.neonGreen.withOpacity(0.8),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  'Sistema Seguro • v2.0',
                  style: TextStyle(
                    fontSize: 12,
                    color: AppTheme.textSecondary.withOpacity(0.6),
                    letterSpacing: 0.5,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    ).animate()
      .fadeIn(delay: 400.ms, duration: 600.ms)
      .slideY(begin: 0.1, end: 0, curve: Curves.easeOutCubic);
  }

  Widget _buildTextField({
    required TextEditingController controller,
    required String label,
    required String hint,
    required IconData icon,
    bool obscure = false,
    Widget? suffixIcon,
    String? Function(String?)? validator,
    void Function(String)? onSubmit,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w500,
            color: AppTheme.textSecondary,
            letterSpacing: 0.5,
          ),
        ),
        const SizedBox(height: 8),
        TextFormField(
          controller: controller,
          obscureText: obscure,
          validator: validator,
          onFieldSubmitted: onSubmit,
          style: const TextStyle(fontSize: 15, color: AppTheme.textPrimary),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: TextStyle(color: AppTheme.textSecondary.withOpacity(0.4)),
            prefixIcon: Icon(icon, size: 20, color: AppTheme.textSecondary),
            suffixIcon: suffixIcon,
            filled: true,
            fillColor: Colors.white.withOpacity(0.05),
            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: BorderSide(color: Colors.white.withOpacity(0.1)),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: BorderSide(color: Colors.white.withOpacity(0.1)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: const BorderSide(color: AppTheme.neonBlue, width: 1.5),
            ),
            errorBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: const BorderSide(color: AppTheme.error),
            ),
          ),
        ),
      ],
    );
  }
}
