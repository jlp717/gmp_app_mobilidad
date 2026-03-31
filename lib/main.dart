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

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Global error handling
  FlutterError.onError = (FlutterErrorDetails details) {
    FlutterError.presentError(details);
    debugPrint('[FLUTTER_ERROR] ${details.exceptionAsString()}');
  };

  // Custom error widget for release builds
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
                Text('Error: ${details.exceptionAsString()}', 
                    style: const TextStyle(color: Colors.white70, fontSize: 12)),
                const SizedBox(height: 8),
                const Text('Vuelve atrás o reinicia la app', style: TextStyle(color: Colors.white70, fontSize: 13)),
              ],
            ),
          ),
        ),
      );
    };
  }

  try {
    // Initialize Hive cache
    await CacheService.init();
    debugPrint('[MAIN] ✅ Cache initialized');

    // Initialize API client - FORCE PRODUCTION MODE
    await ApiClient.initialize();
    debugPrint('[MAIN] ✅ API initialized: ${ApiClient.dio.options.baseUrl}');
  } catch (e, stack) {
    // Log the error but continue - app can still work
    debugPrint('[MAIN] ❌ Initialization error: $e');
    debugPrint('[MAIN] Stack: $stack');
  }

  // Initialize date formatting for Spanish
  await initializeDateFormatting('es', null);

  // Allow all orientations
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // Catch unhandled async errors
  runZonedGuarded(
    () => runApp(
      MultiProvider(
        providers: [
          ChangeNotifierProvider(create: (_) => AuthProvider()),
          // Add other providers here as needed
        ],
        child: GMPSalesAnalyticsApp(),
      ),
    ),
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
  late final GoRouter _router;

  @override
  void initState() {
    super.initState();
    _router = _createRouter();
  }

  @override
  void dispose() {
    _router.dispose();
    super.dispose();
  }

  GoRouter _createRouter() {
    return GoRouter(
      initialLocation: '/dashboard',
      routes: [
        GoRoute(
          path: '/login',
          name: 'login',
          pageBuilder: (context, state) => MaterialPage(
            key: state.pageKey,
            child: LoginPage(),
          ),
        ),
        GoRoute(
          path: '/dashboard',
          name: 'dashboard',
          pageBuilder: (context, state) => MaterialPage(
            key: state.pageKey,
            child: MainShell(),
          ),
        ),
      ],
      redirect: (context, state) {
        final auth = Provider.of<AuthProvider>(context, listen: false);
        final isLoggedIn = auth.isAuthenticated;
        final isLoggingIn = state.matchedLocation == '/login';

        if (!isLoggedIn && !isLoggingIn) {
          return '/login';
        }

        if (isLoggedIn && isLoggingIn) {
          return '/dashboard';
        }

        return null;
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'GMP App Movilidad',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: ThemeMode.dark,
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
      routerConfig: _router,
    );
  }
}
