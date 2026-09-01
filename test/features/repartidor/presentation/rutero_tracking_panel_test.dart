import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:gmp_app_mobilidad/features/repartidor/application/rutero_tracking_notifier.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_tracking.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/futuristic_week_navigator.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_tracking_panel.dart';

class _StubTrackingNotifier extends RuteroTrackingNotifier {
  @override
  RuteroTrackingState build() => const RuteroTrackingState(
        status: RuteroTrackingStatus.active,
        repartidorId: '10',
        routeDate: '2026-08-29',
        sessionId: 'session-1234567890',
      );
}

Finder _toggleSemantics(String label) => find.byWidgetPredicate(
      (widget) => widget is Semantics && widget.properties.label == label,
    );

Future<void> _pumpPanel(
  WidgetTester tester, {
  Size mediaQuerySize = const Size(800, 600),
}) {
  return tester.pumpWidget(
    ProviderScope(
      overrides: [
        ruteroTrackingProvider.overrideWith(_StubTrackingNotifier.new),
      ],
      child: MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(size: mediaQuerySize),
          child: Align(
            alignment: Alignment.topLeft,
            child: SizedBox(
              width: mediaQuerySize.width,
              child: const Scaffold(
                body: SingleChildScrollView(
                  child: RuteroTrackingPanel(
                    repartidorId: '10',
                    routeDate: '2026-08-29',
                    stops: [
                      RuteroTrackingStop(id: 'A-1', name: 'Cliente A'),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

void main() {
  setUpAll(() async {
    await initializeDateFormatting('es_ES');
  });
  testWidgets('phone starts collapsed and keeps the tracking header visible',
      (tester) async {
    await _pumpPanel(
      tester,
      mediaQuerySize: const Size(360, 800),
    );

    expect(find.text('Seguimiento activo'), findsOneWidget);
    expect(find.text('EN MARCHA'), findsOneWidget);
    expect(find.text('Parar seguimiento'), findsNothing);
    expect(find.byType(Switch), findsNothing);
    expect(
      _toggleSemantics('Seguimiento activo. Desplegar panel de seguimiento'),
      findsOneWidget,
    );
    final collapsed = tester.widget<Semantics>(
      _toggleSemantics('Seguimiento activo. Desplegar panel de seguimiento'),
    );
    expect(collapsed.properties.expanded, isFalse);
    expect(collapsed.properties.onTap, isNotNull);
  });

  testWidgets('collapse toggle hides panel body but keeps header',
      (tester) async {
    await _pumpPanel(tester);

    expect(
      find.byKey(const ValueKey('rutero-tracking-collapse')),
      findsOneWidget,
    );
    expect(find.text('Seguimiento activo'), findsOneWidget);
    expect(find.text('EN MARCHA'), findsOneWidget);
    expect(find.text('Parar seguimiento'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('rutero-tracking-collapse')));
    await tester.pumpAndSettle();

    expect(find.text('Seguimiento activo'), findsOneWidget);
    expect(find.text('EN MARCHA'), findsOneWidget);
    expect(find.text('Parar seguimiento'), findsNothing);
    expect(find.byType(Switch), findsNothing);
    expect(
      _toggleSemantics('Seguimiento activo. Desplegar panel de seguimiento'),
      findsOneWidget,
    );
    final collapsed = tester.widget<Semantics>(
      _toggleSemantics('Seguimiento activo. Desplegar panel de seguimiento'),
    );
    expect(collapsed.properties.expanded, isFalse);
    expect(collapsed.properties.onTap, isNotNull);
  });

  testWidgets('collapse toggle expands the body back', (tester) async {
    await _pumpPanel(tester);

    await tester.tap(find.byKey(const ValueKey('rutero-tracking-collapse')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('rutero-tracking-collapse')));
    await tester.pumpAndSettle();

    expect(find.text('Parar seguimiento'), findsOneWidget);
    expect(find.byType(Switch), findsOneWidget);
    expect(
      _toggleSemantics('Seguimiento activo. Contraer panel de seguimiento'),
      findsOneWidget,
    );
    final expanded = tester.widget<Semantics>(
      _toggleSemantics('Seguimiento activo. Contraer panel de seguimiento'),
    );
    expect(expanded.properties.expanded, isTrue);
  });

  testWidgets('the whole tracking header is touch-safe and toggles the body',
      (tester) async {
    await _pumpPanel(
      tester,
      mediaQuerySize: const Size(360, 800),
    );

    final header = find.byKey(const ValueKey('rutero-tracking-collapse'));
    expect(tester.getSize(header).height, greaterThanOrEqualTo(44));
    expect(find.text('Parar seguimiento'), findsNothing);

    await tester.tap(find.text('Seguimiento activo'));
    await tester.pumpAndSettle();

    expect(find.text('Parar seguimiento'), findsOneWidget);
    final expanded = tester.widget<Semantics>(
      _toggleSemantics('Seguimiento activo. Contraer panel de seguimiento'),
    );
    expect(expanded.properties.expanded, isTrue);
    expect(expanded.properties.onTap, isNotNull);
  });

  testWidgets('compact week strip fits a phone when today has deliveries',
      (tester) async {
    final today = DateTime.now();
    final monday = today.subtract(Duration(days: today.weekday - 1));
    final weekDays = List.generate(7, (index) {
      final date = monday.add(Duration(days: index));
      return <String, dynamic>{
        'date': date.toIso8601String(),
        'clients': 1,
        'completed': 0,
        'status': 'none',
      };
    });

    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(size: Size(360, 800)),
          child: Align(
            alignment: Alignment.topLeft,
            child: SizedBox(
              width: 360,
              child: FuturisticWeekNavigator(
                selectedDate: today,
                weekDays: weekDays,
                onDaySelected: (_) {},
                onWeekChange: (_) {},
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(tester.takeException(), isNull);
  });
}
