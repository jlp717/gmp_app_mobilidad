import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'dart:math' as math;

import '../../../../core/theme/app_theme.dart';
import '../../../../core/providers/auth_provider.dart';
import '../widgets/role_selection_dialog.dart';

/// Página de login espectacular con diseño glassmorphism y feedback intuitivo
class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> with TickerProviderStateMixin {
  final _formKey = GlobalKey<FormState>();
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();
  final _usernameFocus = FocusNode();
  final _passwordFocus = FocusNode();
  
  bool _obscurePassword = true;
  bool _hasError = false;
  String? _errorMessage;
  bool _isUsernameFocused = false;
  bool _isPasswordFocused = false;
  
  late AnimationController _bgController;
  late AnimationController _logoController;

  @override
  void initState() {
    super.initState();
    _bgController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 8),
    )..repeat();
    
    // Attempt Auto-Login
    WidgetsBinding.instance.addPostFrameCallback((_) {
       _tryAutoLogin();
    });

    
    _logoController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat(reverse: true);
    
    _usernameFocus.addListener(() => setState(() => _isUsernameFocused = _usernameFocus.hasFocus));
    _passwordFocus.addListener(() => setState(() => _isPasswordFocused = _passwordFocus.hasFocus));
  }

  @override
  void dispose() {
    _usernameController.dispose();
    _passwordController.dispose();
    _usernameFocus.dispose();
    _passwordFocus.dispose();
    _bgController.dispose();
    _logoController.dispose();
    super.dispose();
  }

  Future<void> _tryAutoLogin() async {
    final auth = context.read<AuthProvider>();
    if (await auth.tryAutoLogin()) {
      if (mounted) context.go('/dashboard');
    }
  }

  void _clearError() {
    if (_hasError) setState(() { _hasError = false; _errorMessage = null; });
  }

  Future<void> _handleLogin() async {
    _clearError();
    
    if (!_formKey.currentState!.validate()) return;
    
    final auth = context.read<AuthProvider>();
    debugPrint('[LoginPage] Attempting login for: ${_usernameController.text}');
    
    final success = await auth.login(
      _usernameController.text.trim(),
      _passwordController.text,
    );

    if (!mounted) return;

    if (success) {
      debugPrint('[LoginPage] Login Success. Role: ${auth.currentUser?.role}, IsJefe: ${auth.currentUser?.isJefeVentas}');
      
      if (auth.currentUser?.isJefeVentas == true) {
         debugPrint('[LoginPage] User is Jefe. Showing Role Selection Dialog...');
         // Show Role Selection Dialog
         await showDialog(
           context: context, 
           barrierDismissible: false,
           builder: (ctx) => const RoleSelectionDialog()
         );
         // If dialog passes (or is dismissed via back button on Android), we might need to force navigation
         // The dialog internally handles navigation on "Confirm", but if they "Cancel" it pops.
         if (mounted) {
            // Safety check: if we are still here, user might have cancelled or dialog closed.
            // Check if we are already at dashboard? No, we are at login.
            // Go to dashboard as fallback (default role)
            context.go('/dashboard');
         }
      } else {
         debugPrint('[LoginPage] Regular user. Navigating to Dashboard...');
         context.go('/dashboard');
      }
    } else {
      setState(() {
        _hasError = true;
        _errorMessage = auth.error ?? 'Credenciales incorrectas';
      });
      
      debugPrint('[LoginPage] Login Failed. Showing Dialog. Error: $_errorMessage');
      
      // Force ensure dialog shows
      await showDialog(
        context: context,
        builder: (context) => AlertDialog(
          backgroundColor: AppTheme.darkCard,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Row(
            children: [
              Icon(Icons.error_outline, color: AppTheme.error),
              SizedBox(width: 8),
              Text('Error de acceso', style: TextStyle(color: AppTheme.error)),
            ],
          ),
          content: Text(
            _errorMessage ?? 'Credenciales incorrectas. Por favor, inténtalo de nuevo.', 
            style: const TextStyle(color: Colors.white),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Entendido', style: TextStyle(color: AppTheme.neonBlue)),
            ),
          ],
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    final isWide = size.width > 900;
    
    return Scaffold(
      body: Stack(
        children: [
          // Animated background
          _buildAnimatedBackground(),
          
          // Floating orbs
          _buildFloatingOrbs(),
          
          // Main content
          SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: EdgeInsets.symmetric(
                  horizontal: isWide ? 64 : 24,
                  vertical: 32,
                ),
                child: isWide ? _buildWideLayout() : _buildMobileLayout(),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAnimatedBackground() {
    return AnimatedBuilder(
      animation: _bgController,
      builder: (context, _) {
        final angle = _bgController.value * 2 * math.pi;
        return Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment(math.cos(angle) * 0.5, math.sin(angle) * 0.5),
              end: Alignment(math.cos(angle + math.pi) * 0.5, math.sin(angle + math.pi) * 0.5),
              colors: const [
                Color(0xFF0D0D1A),
                Color(0xFF1A1A2E),
                Color(0xFF16213E),
                Color(0xFF0F0F23),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildFloatingOrbs() {
    return Stack(
      children: [
        // Top-right orb
        Positioned(
          top: -100,
          right: -100,
          child: _buildOrb(280, AppTheme.neonBlue.withOpacity(0.15)),
        ),
        // Bottom-left orb
        Positioned(
          bottom: -150,
          left: -150,
          child: _buildOrb(350, AppTheme.neonPurple.withOpacity(0.12)),
        ),
        // Center accent
        Positioned(
          top: MediaQuery.of(context).size.height * 0.3,
          right: MediaQuery.of(context).size.width * 0.1,
          child: _buildOrb(100, AppTheme.neonPink.withOpacity(0.08)),
        ),
      ],
    );
  }

  Widget _buildOrb(double size, Color color) {
    return AnimatedBuilder(
      animation: _logoController,
      builder: (context, _) => Container(
        width: size + _logoController.value * 20,
        height: size + _logoController.value * 20,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(
            colors: [color, Colors.transparent],
          ),
        ),
      ),
    );
  }

  Widget _buildWideLayout() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        // Left: Branding
        Expanded(
          child: _buildBranding().animate().fadeIn(duration: 800.ms).slideX(begin: -0.2),
        ),
        const SizedBox(width: 80),
        // Right: Login card
        _buildLoginCard().animate().fadeIn(delay: 200.ms, duration: 800.ms).slideY(begin: 0.1),
      ],
    );
  }

  Widget _buildMobileLayout() {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        _buildCompactBranding().animate().fadeIn(duration: 600.ms),
        const SizedBox(height: 48),
        _buildLoginCard().animate().fadeIn(delay: 300.ms, duration: 600.ms).slideY(begin: 0.15),
      ],
    );
  }

  Widget _buildBranding() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        // Logo
        _buildLogo(size: 90),
        const SizedBox(height: 48),
        // Title
        ShaderMask(
          shaderCallback: (bounds) => const LinearGradient(
            colors: [Color(0xFF00D9FF), Color(0xFFBF5AF2), Color(0xFFFF6B9D)],
          ).createShader(bounds),
          child: const Text(
            'GMP\nMobilidad',
            style: TextStyle(
              fontSize: 64,
              fontWeight: FontWeight.w800,
              height: 0.95,
              color: Colors.white,
              letterSpacing: -3,
            ),
          ),
        ),
        const SizedBox(height: 24),
        // Subtitle
        Text(
          'Plataforma inteligente de ventas\nDatos en tiempo real para tu equipo comercial',
          style: TextStyle(
            fontSize: 17,
            color: Colors.white.withOpacity(0.6),
            height: 1.6,
            letterSpacing: 0.3,
          ),
        ),
        const SizedBox(height: 40),
        // Features
        Row(
          children: [
            _buildFeatureChip(Icons.bolt_rounded, 'Tiempo Real'),
            const SizedBox(width: 12),
            _buildFeatureChip(Icons.insights_rounded, 'Analytics'),
            const SizedBox(width: 12),
            _buildFeatureChip(Icons.security_rounded, 'Seguro'),
          ],
        ),
      ],
    );
  }

  Widget _buildCompactBranding() {
    return Column(
      children: [
        _buildLogo(size: 70),
        const SizedBox(height: 24),
        ShaderMask(
          shaderCallback: (bounds) => const LinearGradient(
            colors: [Color(0xFF00D9FF), Color(0xFFBF5AF2)],
          ).createShader(bounds),
          child: const Text(
            'GMP Mobilidad',
            style: TextStyle(
              fontSize: 32,
              fontWeight: FontWeight.w700,
              color: Colors.white,
              letterSpacing: -1,
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          'Plataforma de Ventas Inteligente',
          style: TextStyle(
            fontSize: 14,
            color: Colors.white.withOpacity(0.5),
          ),
        ),
      ],
    );
  }

  Widget _buildLogo({required double size}) {
    return AnimatedBuilder(
      animation: _logoController,
      builder: (context, _) {
        return Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(size * 0.28),
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [Color(0xFF00D9FF), Color(0xFF7B61FF), Color(0xFFBF5AF2)],
            ),
            boxShadow: [
              BoxShadow(
                color: const Color(0xFF00D9FF).withOpacity(0.3 + _logoController.value * 0.2),
                blurRadius: 30 + _logoController.value * 15,
                spreadRadius: 2,
              ),
            ],
          ),
          child: Icon(
            Icons.analytics_rounded,
            size: size * 0.5,
            color: Colors.white,
          ),
        );
      },
    );
  }

  Widget _buildFeatureChip(IconData icon, String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
        color: Colors.white.withOpacity(0.05),
        border: Border.all(color: Colors.white.withOpacity(0.1)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: AppTheme.neonBlue),
          const SizedBox(width: 6),
          Text(label, style: TextStyle(fontSize: 13, color: Colors.white.withOpacity(0.7))),
        ],
      ),
    );
  }

  Widget _buildLoginCard() {
    return Container(
      width: 400,
      padding: const EdgeInsets.all(36),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(28),
        color: Colors.white.withOpacity(0.03),
        border: Border.all(
          color: _hasError 
              ? AppTheme.error.withOpacity(0.5) 
              : Colors.white.withOpacity(0.08),
          width: 1.5,
        ),
        boxShadow: [
          BoxShadow(
            color: _hasError 
                ? AppTheme.error.withOpacity(0.1)
                : Colors.black.withOpacity(0.4),
            blurRadius: 50,
            offset: const Offset(0, 25),
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
            const Text(
              'Bienvenido',
              style: TextStyle(
                fontSize: 28,
                fontWeight: FontWeight.w700,
                color: Colors.white,
                letterSpacing: -0.5,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Inicia sesión para continuar',
              style: TextStyle(
                fontSize: 15,
                color: Colors.white.withOpacity(0.5),
              ),
            ),
            
            const SizedBox(height: 36),
            
            // Error banner (inline, not modal)
            if (_hasError)
              Container(
                margin: const EdgeInsets.only(bottom: 20),
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(14),
                  color: AppTheme.error.withOpacity(0.1),
                  border: Border.all(color: AppTheme.error.withOpacity(0.3)),
                ),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                      shape: BoxShape.circle,
                        color: AppTheme.error.withOpacity(0.2),
                      ),
                      child: const Icon(Icons.error_outline, color: AppTheme.error, size: 20),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Error de acceso',
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: AppTheme.error,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            _errorMessage ?? 'Verifica tus credenciales',
                            style: TextStyle(
                              fontSize: 12,
                              color: AppTheme.error.withOpacity(0.8),
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, size: 18, color: AppTheme.error),
                      onPressed: _clearError,
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(),
                    ),
                  ],
                ),
              ).animate().shake(duration: 400.ms).fadeIn(),
            
            // Username field
            _buildInputField(
              controller: _usernameController,
              focusNode: _usernameFocus,
              isFocused: _isUsernameFocused,
              label: 'Usuario',
              hint: 'Tu código de acceso',
              icon: Icons.person_rounded,
              textInputAction: TextInputAction.next,
              onChanged: (_) => _clearError(),
              validator: (v) => v?.trim().isEmpty == true ? 'Ingresa tu usuario' : null,
            ),
            
            const SizedBox(height: 18),
            
            // Password field
            _buildInputField(
              controller: _passwordController,
              focusNode: _passwordFocus,
              isFocused: _isPasswordFocused,
              label: 'Contraseña',
              hint: '••••••••',
              icon: Icons.lock_rounded,
              obscure: _obscurePassword,
              textInputAction: TextInputAction.done,
              onChanged: (_) => _clearError(),
              onSubmit: (_) => _handleLogin(),
              validator: (v) => v?.isEmpty == true ? 'Ingresa tu contraseña' : null,
              suffix: IconButton(
                icon: Icon(
                  _obscurePassword ? Icons.visibility_off_rounded : Icons.visibility_rounded,
                  size: 20,
                  color: Colors.white.withOpacity(0.4),
                ),
                onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
              ),
            ),
            
            const SizedBox(height: 32),
            
            // Login button
            Consumer<AuthProvider>(
              builder: (context, auth, _) {
                return GestureDetector(
                  onTap: auth.isLoading ? null : _handleLogin,
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    height: 56,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(16),
                      gradient: auth.isLoading ? null : const LinearGradient(
                        colors: [Color(0xFF00D9FF), Color(0xFF7B61FF)],
                      ),
                      color: auth.isLoading ? Colors.white.withOpacity(0.1) : null,
                      boxShadow: auth.isLoading ? [] : [
                        BoxShadow(
                          color: const Color(0xFF00D9FF).withOpacity(0.35),
                          blurRadius: 25,
                          offset: const Offset(0, 10),
                        ),
                      ],
                    ),
                    child: Center(
                      child: auth.isLoading
                          ? SizedBox(
                              width: 24,
                              height: 24,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.5,
                                valueColor: AlwaysStoppedAnimation(Colors.white.withOpacity(0.8)),
                              ),
                            )
                          : const Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Text(
                                  'Iniciar Sesión',
                                  style: TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w600,
                                    color: Colors.white,
                                    letterSpacing: 0.5,
                                  ),
                                ),
                                SizedBox(width: 10),
                                Icon(Icons.arrow_forward_rounded, color: Colors.white, size: 20),
                              ],
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
                  width: 8,
                  height: 8,
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppTheme.neonGreen,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  'Conexión segura • GMP 2026',
                  style: TextStyle(
                    fontSize: 12,
                    color: Colors.white.withOpacity(0.35),
                    letterSpacing: 0.3,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInputField({
    required TextEditingController controller,
    required FocusNode focusNode,
    required bool isFocused,
    required String label,
    required String hint,
    required IconData icon,
    bool obscure = false,
    Widget? suffix,
    TextInputAction? textInputAction,
    void Function(String)? onChanged,
    void Function(String)? onSubmit,
    String? Function(String?)? validator,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w500,
            color: isFocused ? AppTheme.neonBlue : Colors.white.withOpacity(0.5),
            letterSpacing: 0.3,
          ),
        ),
        const SizedBox(height: 8),
        AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: isFocused 
                  ? AppTheme.neonBlue 
                  : Colors.white.withOpacity(0.1),
              width: isFocused ? 1.5 : 1,
            ),
            color: Colors.white.withOpacity(isFocused ? 0.08 : 0.04),
            boxShadow: isFocused ? [
              BoxShadow(
                color: AppTheme.neonBlue.withOpacity(0.1),
                blurRadius: 15,
                spreadRadius: 0,
              ),
            ] : [],
          ),
          child: TextFormField(
            controller: controller,
            focusNode: focusNode,
            obscureText: obscure,
            textInputAction: textInputAction,
            onChanged: onChanged,
            onFieldSubmitted: onSubmit,
            validator: validator,
            style: const TextStyle(fontSize: 15, color: Colors.white),
            decoration: InputDecoration(
              hintText: hint,
              hintStyle: TextStyle(color: Colors.white.withOpacity(0.25)),
              prefixIcon: Icon(icon, size: 20, color: isFocused ? AppTheme.neonBlue : Colors.white.withOpacity(0.4)),
              suffixIcon: suffix,
              filled: false,
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
              border: InputBorder.none,
              errorStyle: const TextStyle(fontSize: 11, height: 0.8),
            ),
          ),
        ),
      ],
    );
  }
}
