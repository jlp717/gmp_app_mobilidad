import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:gmp_app_mobilidad/features/auth/presentation/pages/login_page.dart';
import 'package:gmp_app_mobilidad/features/real_dashboard/real_dashboard_page.dart';

final GlobalKey<NavigatorState> rootNavigatorKey = GlobalKey<NavigatorState>();

class AppRouter {
  static final GoRouter router = GoRouter(
    navigatorKey: rootNavigatorKey,
    initialLocation: '/login',
    routes: [
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginPage(),
      ),
      GoRoute(
        path: '/',
        builder: (context, state) => const RealDashboardPage(),
      ),
    ],
  );
}
