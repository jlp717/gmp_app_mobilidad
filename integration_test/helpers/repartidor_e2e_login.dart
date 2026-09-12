import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/dashboard/presentation/pages/main_shell.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/smart_delivery_card.dart';
import 'package:gmp_app_mobilidad/main.dart' as app;

/// Same login path as [integration_test/app_flow_test.dart].
({String user, String pass}) requireIntegrationCredentials() {
  const definedUser = String.fromEnvironment('INTEGRATION_USER');
  const definedPass = String.fromEnvironment('INTEGRATION_PASS');
  final user = definedUser.isNotEmpty
      ? definedUser
      : (Platform.environment['INTEGRATION_USER'] ?? '');
  final pass = definedPass.isNotEmpty
      ? definedPass
      : (Platform.environment['INTEGRATION_PASS'] ?? '');
  if (user.isEmpty || pass.isEmpty) {
    fail(
      'INTEGRATION_USER/INTEGRATION_PASS no definidas: '
      'este test requiere staging real.',
    );
  }
  return (user: user, pass: pass);
}

Future<void> pumpQuiet(WidgetTester tester, Duration duration) async {
  final end = DateTime.now().add(duration);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 250));
  }
}

Future<void> tapFirst(WidgetTester tester, Finder finder) async {
  expect(finder, findsWidgets);
  await tester.tap(finder.first, warnIfMissed: false);
  await tester.pump(const Duration(milliseconds: 400));
}

Future<bool> tapIfPresent(WidgetTester tester, Finder finder) async {
  if (finder.evaluate().isEmpty) return false;
  await tester.tap(finder.first);
  await tester.pump(const Duration(milliseconds: 400));
  return true;
}

Future<void> waitFor(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 25),
  String? label,
}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 300));
    await _dismissSystemDialogs(tester);
    if (finder.evaluate().isNotEmpty) return;
  }
  fail(
    'Timeout esperando ${label ?? finder.toString()}. '
    'Textos visibles: ${_visibleTexts()}',
  );
}

String _visibleTexts() {
  final texts = <String>[];
  for (final element in find.byType(Text).evaluate()) {
    final widget = element.widget;
    if (widget is Text &&
        widget.data != null &&
        widget.data!.trim().isNotEmpty) {
      texts.add(widget.data!.trim());
      if (texts.length >= 40) break;
    }
  }
  return texts.join(' | ');
}

Future<void> _dismissSystemDialogs(WidgetTester tester) async {
  for (final label in [
    'Allow',
    'Permitir',
    'While using the app',
    'OK',
    'Aceptar'
  ]) {
    final finder = find.text(label);
    if (finder.evaluate().isNotEmpty) {
      await tester.tap(finder.first);
      await tester.pump(const Duration(milliseconds: 300));
    }
  }
}

/// Login identical to the existing critical-flow integration test.
Future<void> loginWithIntegrationFixture(WidgetTester tester) async {
  final creds = requireIntegrationCredentials();
  app.main();
  await waitFor(
    tester,
    find.text('Iniciar Sesión'),
    timeout: const Duration(seconds: 25),
    label: 'botón Iniciar Sesión',
  );
  await _dismissSystemDialogs(tester);

  await tester.enterText(
    find.widgetWithText(TextFormField, 'Tu código de acceso'),
    creds.user,
  );
  await tester.pump();
  await tester.enterText(
    find.widgetWithText(TextFormField, '••••••••'),
    creds.pass,
  );
  await tester.pump();
  await tester.tap(find.text('Iniciar Sesión'));
  await waitFor(
    tester,
    find.byType(MainShell),
    timeout: const Duration(seconds: 40),
    label: 'MainShell tras login',
  );
  await pumpQuiet(tester, const Duration(seconds: 2));
  await _dismissSystemDialogs(tester);
  debugPrint('[e2e-cierre] login OK');
}

Future<void> closeDrawerIfOpen(WidgetTester tester) async {
  final scaffoldFinder = find.byType(Scaffold);
  if (scaffoldFinder.evaluate().isEmpty) return;
  try {
    final state = tester.state<ScaffoldState>(scaffoldFinder.first);
    if (state.isDrawerOpen) {
      state.closeDrawer();
      await pumpQuiet(tester, const Duration(milliseconds: 600));
    }
  } catch (_) {
    // El primer Scaffold del árbol puede no ser el del MainShell.
  }
}

bool alreadyInPerfilReparto() {
  return find.text('Rutero').evaluate().isNotEmpty &&
      (find.text('Reparto').evaluate().isNotEmpty ||
          find.text('Panel').evaluate().isNotEmpty);
}

Future<void> switchToPerfilReparto(WidgetTester tester) async {
  if (alreadyInPerfilReparto()) {
    debugPrint('[e2e-cierre] ya en perfil reparto');
    return;
  }

  // En teléfono el switcher vive en el drawer (avatar + Icons.menu).
  final menu = find.byIcon(Icons.menu);
  if (menu.evaluate().isNotEmpty) {
    await tester.tap(menu.first);
    await pumpQuiet(tester, const Duration(milliseconds: 800));
  }

  final switcher = find.byKey(const ValueKey('main-shell-mode-switch'));
  if (switcher.evaluate().isNotEmpty) {
    await tester.tap(switcher.first);
    await pumpQuiet(tester, const Duration(milliseconds: 800));
  } else {
    await tapIfPresent(tester, find.text('Ventas'));
    await tapIfPresent(tester, find.byIcon(Icons.store));
    await pumpQuiet(tester, const Duration(milliseconds: 600));
  }

  await waitFor(
    tester,
    find.text('Perfil Reparto'),
    timeout: const Duration(seconds: 12),
    label: 'item Perfil Reparto del switcher',
  );
  await tester.tap(find.text('Perfil Reparto').first);
  await pumpQuiet(tester, const Duration(seconds: 2));
  await closeDrawerIfOpen(tester);
  await waitFor(
    tester,
    find.text('Rutero'),
    timeout: const Duration(seconds: 25),
    label: 'tab Rutero en perfil reparto',
  );
  await pumpQuiet(tester, const Duration(seconds: 2));
  debugPrint('[e2e-cierre] switch Perfil Reparto OK');
}

Future<void> openRuteroTab(WidgetTester tester) async {
  final ruteroTab = find.textContaining('Rutero');
  expect(ruteroTab, findsWidgets);
  await tester.tap(ruteroTab.first);
  await pumpQuiet(tester, const Duration(seconds: 2));
  await waitFor(
    tester,
    find.byType(SmartDeliveryCard),
    timeout: const Duration(seconds: 45),
    label: 'tarjetas del rutero',
  );
  debugPrint('[e2e-cierre] tab Rutero con tarjetas');
}
