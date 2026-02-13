import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'core/theme/app_theme.dart';
import 'core/providers/auth_provider.dart';
import 'core/cache/cache_service.dart';
import 'core/api/api_client.dart';
import 'features/auth/presentation/pages/login_page.dart';
import 'features/dashboard/presentation/pages/main_shell.dart';
import 'features/sales_history/providers/sales_history_provider.dart';
import 'features/sales_history/presentation/pages/product_history_page.dart';
import 'core/providers/filter_provider.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Global error handling — catch unhandled Flutter framework errors
  FlutterError.onError = (FlutterErrorDetails details) {
    FlutterError.presentError(details);
    debugPrint('[FLUTTER_ERROR] ${details.exceptionAsString()}');
  };

  // Custom error widget for release builds (user-friendly instead of red screen)
  if (kReleaseMode) {
    ErrorWidget.builder = (FlutterErrorDetails details) {
      return Material(
        color: const Color(0xFF1E1F25),
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.warning_amber_rounded, size: 48, color: Colors.orange.shade300),
                const SizedBox(height: 16),
                const Text('Se ha producido un error', style: TextStyle(color: Colors.white, fontSize: 16)),
                const SizedBox(height: 8),
                const Text('Vuelve atrás o reinicia la app', style: TextStyle(color: Colors.white70, fontSize: 13)),
              ],
            ),
          ),
        ),
      );
    };
  }

  // Initialize Hive cache before anything else
  await CacheService.init();

  // Initialize API client with automatic server detection
  // Supports: Production, LAN, Emulator, WSA (Windows Subsystem for Android)
  await ApiClient.initialize();

  // Initialize date formatting for Spanish
  await initializeDateFormatting('es', null);

  // Force landscape orientation for tablet
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);

  // Catch unhandled async errors (Dart zone)
  runZonedGuarded(
    () => runApp(const GMPSalesAnalyticsApp()),
    (error, stackTrace) {
      debugPrint('[ZONE_ERROR] $error\n$stackTrace');
    },
  );
}

class GMPSalesAnalyticsApp extends StatefulWidget {
  const GMPSalesAnalyticsApp({super.key});

  @override
  State<GMPSalesAnalyticsApp> createState() => _GMPSalesAnalyticsAppState();
}

class _GMPSalesAnalyticsAppState extends State<GMPSalesAnalyticsApp> {
  late final AuthProvider _authProvider;
  late final GoRouter _router;

  @override
  void initState() {
    super.initState();
    _authProvider = AuthProvider();
    _router = _createRouter(_authProvider);
  }

  @override
  void dispose() {
    _authProvider.dispose();
    _router.dispose();
    super.dispose();
  }

  GoRouter _createRouter(AuthProvider authProvider) {
    return GoRouter(
      refreshListenable: authProvider,
      initialLocation: '/login',
      redirect: (context, state) {
        final isLoggedIn = authProvider.isAuthenticated;
        final isLoggingIn = state.matchedLocation == '/login';

        if (!isLoggedIn && !isLoggingIn) {
          return '/login';
        }
        if (isLoggedIn && isLoggingIn) {
          // CRITICAL: Check if user is Jefe to allow Role Selection Dialog
          // If Jefe, do NOT auto-redirect yet. Logic in LoginPage will handle navigation after dialog.
          if (authProvider.currentUser?.isJefeVentas == true || 
              authProvider.currentUser?.role == 'JEFE_VENTAS' ||
              authProvider.currentUser?.role == 'JEFE') {
             return null; // Stay on /login
          }
          return '/home';
        }
        return null;
      },
      routes: [
        GoRoute(
          path: '/login',
          builder: (context, state) => const LoginPage(),
        ),
        GoRoute(
          path: '/home',
          builder: (context, state) => MainShell(),
        ),
        GoRoute(
          path: '/dashboard', // Alias for /home to support legacy calls
          redirect: (_, __) => '/home', 
        ),
        GoRoute(
          path: '/sales-history',
          builder: (context, state) {
            final clientCode = state.extra as String?;
            return ProductHistoryPage(initialClientCode: clientCode);
          },
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: _authProvider),
        ChangeNotifierProvider(create: (_) => SalesHistoryProvider()),
        ChangeNotifierProvider(create: (_) => FilterProvider()),
      ],
      child: MaterialApp.router(
        title: 'GMP Sales Analytics',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.darkTheme,
        routerConfig: _router,
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: const [
          Locale('es', 'ES'),
          Locale('en', 'US'),
        ],
        locale: const Locale('es', 'ES'),
      ),
    );
  }
}