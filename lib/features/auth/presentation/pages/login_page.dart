import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/auth/presentation/widgets/role_selection_dialog.dart';
import 'package:go_router/go_router.dart';

/// Login page V2 — Premium glassmorphism with fluid animations and micro-interactions.
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
  bool _isButtonHovered = false;

  late AnimationController _logoController;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _tryAutoLogin();
    });

    _logoController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 3),
    )..repeat(reverse: true);

    _usernameFocus.addListener(
        () => setState(() => _isUsernameFocused = _usernameFocus.hasFocus));
    _passwordFocus.addListener(
        () => setState(() => _isPasswordFocused = _passwordFocus.hasFocus));
  }

  @override
  void dispose() {
    _usernameController.dispose();
    _passwordController.dispose();
    _usernameFocus.dispose();
    _passwordFocus.dispose();
    _logoController.dispose();
    super.dispose();
  }

  Future<void> _tryAutoLogin() async {
    final authState =
        ProviderScope.containerOf(context).read(authProvider).value;
    if (authState?.isAuthenticated ?? false) {
      if (mounted) context.go('/dashboard');
    }
  }

  void _clearError() {
    if (_hasError) {
      setState(() {
        _hasError = false;
        _errorMessage = null;
      });
    }
  }

  Future<void> _handleLogin() async {
    _clearError();

    if (!_formKey.currentState!.validate()) return;

    final ref = ProviderScope.containerOf(context);

    final success = await ref.read(authProvider.notifier).login(
          _usernameController.text.trim(),
          _passwordController.text,
        );

    if (!mounted) return;

    if (success) {
      final user = ref.read(authProvider).value?.user;

      final isJefe = user?.isJefeVentas ??
          false || user?.role == 'JEFE_VENTAS' || user?.role == 'JEFE';

      if (isJefe) {
        if (!mounted) return;

        Future.microtask(() async {
          if (!mounted) return;
          await showDialog(
              context: context,
              barrierDismissible: false,
              builder: (ctx) => const RoleSelectionDialog());
        });
      } else {
        context.go('/dashboard');
      }
    } else {
      setState(() {
        _hasError = true;
        final rawError =
            ref.read(authProvider).value?.error ?? 'Credenciales incorrectas';

        if (rawError.contains('Demasiados intentos') ||
            rawError.contains('429')) {
          _errorMessage =
              'Demasiados intentos. Espera unos minutos antes de intentar de nuevo.';
        } else if (rawError.contains('ROLE_SELECTION')) {
          _errorMessage = rawError;
        } else {
          _errorMessage = rawError;
        }
      });

      await showDialog(
        context: context,
        builder: (context) => AlertDialog(
          backgroundColor: AppTheme.raisedSurface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusLg),
            side: BorderSide(color: AppTheme.error.withValues(alpha: 0.2)),
          ),
          title: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppTheme.error.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(Icons.error_outline,
                    color: AppTheme.error, size: 20),
              ),
              const SizedBox(width: 12),
              const Text('Error de acceso',
                  style: TextStyle(color: AppTheme.error)),
            ],
          ),
          content: Text(
            _errorMessage ??
                'Credenciales incorrectas. Por favor, inténtalo de nuevo.',
            style: const TextStyle(color: Colors.white),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              style: TextButton.styleFrom(
                padding:
                    const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
              child: const Text('Entendido',
                  style: TextStyle(color: AppTheme.info)),
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
          _buildAnimatedBackground(),
          _buildGridOverlay(),
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
    return const ColoredBox(
      color: AppTheme.inkSurface,
      child: SizedBox.expand(),
    );
  }

  /// Subtle grid overlay for depth
  Widget _buildGridOverlay() {
    return CustomPaint(
      size: Size.infinite,
      painter: _GridPainter(),
    );
  }

  Widget _buildWideLayout() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Expanded(
          child: _buildBranding()
              .animate()
              .fadeIn(duration: 800.ms, curve: Curves.easeOutCubic)
              .slideX(begin: -0.15, curve: Curves.easeOutCubic),
        ),
        SizedBox(width: Responsive.value(context, phone: 32, desktop: 80)),
        _buildLoginCard()
            .animate()
            .fadeIn(delay: 200.ms, duration: 800.ms, curve: Curves.easeOutCubic)
            .slideY(begin: 0.1, curve: Curves.easeOutCubic),
      ],
    );
  }

  Widget _buildMobileLayout() {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        _buildCompactBranding()
            .animate()
            .fadeIn(duration: 600.ms, curve: Curves.easeOutCubic),
        const SizedBox(height: 40),
        _buildLoginCard()
            .animate()
            .fadeIn(delay: 300.ms, duration: 600.ms, curve: Curves.easeOutCubic)
            .slideY(begin: 0.12, curve: Curves.easeOutCubic),
      ],
    );
  }

  Widget _buildBranding() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        _buildLogo(size: 80),
        const SizedBox(height: 40),
        const Text(
          'GMP\nMobilidad',
          style: TextStyle(
            fontSize: 56,
            fontWeight: FontWeight.w800,
            height: 0.95,
            color: AppTheme.textPrimary,
            letterSpacing: 0,
          ),
        ),
        const SizedBox(height: 20),
        Text(
          'Ventas, reparto y almacén coordinados\npara trabajar con precisión en ruta',
          style: TextStyle(
            fontSize: 16,
            color: AppTheme.textSecondary,
            height: 1.6,
            letterSpacing: 0,
          ),
        ),
        const SizedBox(height: 32),
        Wrap(
          spacing: 10,
          runSpacing: 8,
          children: [
            _buildFeatureChip(Icons.route_rounded, 'Ruta'),
            _buildFeatureChip(Icons.insights_rounded, 'Métricas'),
            _buildFeatureChip(Icons.security_rounded, 'Seguro'),
          ],
        ),
      ],
    );
  }

  Widget _buildCompactBranding() {
    return Column(
      children: [
        _buildLogo(size: 64),
        const SizedBox(height: 20),
        const Text(
          'GMP Movilidad',
          style: TextStyle(
            fontSize: 28,
            fontWeight: FontWeight.w700,
            color: AppTheme.textPrimary,
            letterSpacing: 0,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          'Ventas, reparto y almacén',
          style: TextStyle(
            fontSize: 13,
            color: AppTheme.textSecondary,
          ),
        ),
      ],
    );
  }

  Widget _buildLogo({required double size}) {
    return AnimatedBuilder(
      animation: _logoController,
      builder: (context, _) {
        final scale =
            1.0 + math.sin(_logoController.value * 2 * math.pi) * 0.03;
        return Transform.scale(
          scale: scale,
          child: Container(
            width: size,
            height: size,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(size * 0.3),
              color: AppTheme.info,
              boxShadow: [
                BoxShadow(
                  color: AppTheme.info
                      .withValues(alpha: 0.25 + _logoController.value * 0.15),
                  blurRadius: 16 + _logoController.value * 8,
                  spreadRadius: 1,
                ),
              ],
            ),
            child: Center(
              child: Icon(
                Icons.analytics_rounded,
                size: size * 0.45,
                color: Colors.white,
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildFeatureChip(IconData icon, String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppTheme.radiusFull),
        color: Colors.white.withValues(alpha: 0.04),
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: AppTheme.info),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: Colors.white.withValues(alpha: 0.6),
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLoginCard() {
    return Container(
      width: Responsive.clampWidth(context, 400),
      padding: EdgeInsets.all(Responsive.isSmall(context) ? 28 : 36),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppTheme.radiusXl),
        color: AppTheme.raisedSurface,
        border: Border.all(
          color: _hasError
              ? AppTheme.error.withValues(alpha: 0.3)
              : Colors.white.withValues(alpha: 0.06),
          width: 1,
        ),
        boxShadow: [
          BoxShadow(
            color: _hasError
                ? AppTheme.error.withValues(alpha: 0.08)
                : Colors.black.withValues(alpha: 0.22),
            blurRadius: 24,
            offset: const Offset(0, 14),
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
                fontSize: 26,
                fontWeight: FontWeight.w700,
                color: Colors.white,
                letterSpacing: 0,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Inicia sesión para continuar',
              style: TextStyle(
                fontSize: 14,
                color: Colors.white.withValues(alpha: 0.4),
              ),
            ),

            const SizedBox(height: 32),

            // Error banner
            if (_hasError)
              Container(
                margin: const EdgeInsets.only(bottom: 20),
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                  color: AppTheme.error.withValues(alpha: 0.08),
                  border:
                      Border.all(color: AppTheme.error.withValues(alpha: 0.2)),
                ),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: AppTheme.error.withValues(alpha: 0.15),
                      ),
                      child: const Icon(Icons.error_outline,
                          color: AppTheme.error, size: 18),
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
                              color: AppTheme.error.withValues(alpha: 0.7),
                            ),
                          ),
                        ],
                      ),
                    ),
                    InkWell(
                      onTap: _clearError,
                      borderRadius: BorderRadius.circular(8),
                      child: const Padding(
                        padding: EdgeInsets.all(4),
                        child:
                            Icon(Icons.close, size: 16, color: AppTheme.error),
                      ),
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
              validator: (v) =>
                  (v?.trim().isEmpty ?? false) ? 'Ingresa tu usuario' : null,
            ),

            const SizedBox(height: 16),

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
              validator: (v) =>
                  (v?.isEmpty ?? false) ? 'Ingresa tu contraseña' : null,
              suffix: InkWell(
                onTap: () =>
                    setState(() => _obscurePassword = !_obscurePassword),
                borderRadius: BorderRadius.circular(8),
                child: Padding(
                  padding: const EdgeInsets.all(8),
                  child: Icon(
                    _obscurePassword
                        ? Icons.visibility_off_rounded
                        : Icons.visibility_rounded,
                    size: 18,
                    color: Colors.white.withValues(alpha: 0.3),
                  ),
                ),
              ),
            ),

            const SizedBox(height: 28),

            // Login button
            Consumer(
              builder: (context, ref, _) {
                final authState = ref.watch(authProvider);
                final isLoading = authState.isLoading;
                return MouseRegion(
                  onEnter: (_) => setState(() => _isButtonHovered = true),
                  onExit: (_) => setState(() => _isButtonHovered = false),
                  child: GestureDetector(
                    onTap: isLoading ? null : _handleLogin,
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      height: 54,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                        color: isLoading
                            ? Colors.white.withValues(alpha: 0.08)
                            : AppTheme.info,
                        boxShadow: isLoading
                            ? []
                            : [
                                BoxShadow(
                                  color: AppTheme.info.withValues(
                                      alpha: _isButtonHovered ? 0.4 : 0.25),
                                  blurRadius: _isButtonHovered ? 18 : 12,
                                  offset: Offset(0, _isButtonHovered ? 9 : 6),
                                ),
                              ],
                      ),
                      child: Center(
                        child: isLoading
                            ? SizedBox(
                                width: 22,
                                height: 22,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2.5,
                                  valueColor: AlwaysStoppedAnimation(
                                    Colors.white.withValues(alpha: 0.8),
                                  ),
                                ),
                              )
                            : Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  const Text(
                                    'Iniciar Sesión',
                                    style: TextStyle(
                                      fontSize: 15,
                                      fontWeight: FontWeight.w600,
                                      color: Colors.white,
                                      letterSpacing: 0,
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  AnimatedPadding(
                                    duration: const Duration(milliseconds: 200),
                                    padding: EdgeInsets.only(
                                      left: _isButtonHovered ? 4 : 0,
                                    ),
                                    child: const Icon(
                                      Icons.arrow_forward_rounded,
                                      color: Colors.white,
                                      size: 18,
                                    ),
                                  ),
                                ],
                              ),
                      ),
                    ),
                  ),
                );
              },
            ),

            const SizedBox(height: 24),

            // Footer
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width: 6,
                  height: 6,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppTheme.success.withValues(alpha: 0.8),
                    boxShadow: [
                      BoxShadow(
                        color: AppTheme.success.withValues(alpha: 0.3),
                        blurRadius: 8,
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  'Conexión segura • GMP 2026',
                  style: TextStyle(
                    fontSize: 11,
                    color: Colors.white.withValues(alpha: 0.3),
                    letterSpacing: 0,
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
        AnimatedDefaultTextStyle(
          duration: const Duration(milliseconds: 200),
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w500,
            color:
                isFocused ? AppTheme.info : Colors.white.withValues(alpha: 0.4),
            letterSpacing: 0,
          ),
          child: Text(label),
        ),
        const SizedBox(height: 8),
        AnimatedContainer(
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeInOut,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppTheme.radiusMd),
            border: Border.all(
              color: isFocused
                  ? AppTheme.info.withValues(alpha: 0.5)
                  : Colors.white.withValues(alpha: 0.06),
              width: isFocused ? 1.5 : 1,
            ),
            color: Colors.white.withValues(alpha: isFocused ? 0.06 : 0.03),
            boxShadow: isFocused
                ? [
                    BoxShadow(
                      color: AppTheme.info.withValues(alpha: 0.08),
                      blurRadius: 12,
                    ),
                  ]
                : [],
          ),
          child: TextFormField(
            controller: controller,
            focusNode: focusNode,
            obscureText: obscure,
            textInputAction: textInputAction,
            onChanged: onChanged,
            onFieldSubmitted: onSubmit,
            validator: validator,
            style: const TextStyle(fontSize: 14, color: Colors.white),
            decoration: InputDecoration(
              hintText: hint,
              hintStyle: TextStyle(color: Colors.white.withValues(alpha: 0.2)),
              prefixIcon: Icon(
                icon,
                size: 18,
                color: isFocused
                    ? AppTheme.info
                    : Colors.white.withValues(alpha: 0.3),
              ),
              suffixIcon: suffix,
              filled: false,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
              border: InputBorder.none,
              errorStyle: const TextStyle(fontSize: 11, height: 0.8),
            ),
          ),
        ),
      ],
    );
  }
}

/// Subtle grid pattern painter for background depth
class _GridPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white.withValues(alpha: 0.015)
      ..strokeWidth = 0.5;

    const spacing = 60.0;
    for (var x = 0.0; x < size.width; x += spacing) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }
    for (var y = 0.0; y < size.height; y += spacing) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
