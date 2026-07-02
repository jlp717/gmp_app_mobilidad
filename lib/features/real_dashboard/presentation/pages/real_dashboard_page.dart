import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/features/dashboard/presentation/pages/main_shell.dart';

/// Entry point widget for the main dashboard route.
/// Delegates to MainShell which contains the full navigation structure.
class RealDashboardPage extends StatelessWidget {
  const RealDashboardPage({super.key});

  @override
  Widget build(BuildContext context) {
    return const MainShell();
  }
}
