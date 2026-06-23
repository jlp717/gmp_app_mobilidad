import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/order_status_badge.dart';

void main() {
  group('OrderStatusBadge Widget Tests', () {
    group('All known statuses render correctly', () {
      testWidgets('BORRADOR status displays correct label', (tester) async {
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(
              body: OrderStatusBadge(estado: 'BORRADOR'),
            ),
          ),
        );

        expect(find.text('Borrador'), findsOneWidget);
      });

      testWidgets('CONFIRMADO status displays correct label', (tester) async {
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(
              body: OrderStatusBadge(estado: 'CONFIRMADO'),
            ),
          ),
        );

        expect(find.text('Confirmado'), findsOneWidget);
      });

      testWidgets('ENVIADO status displays as Confirmado', (tester) async {
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(
              body: OrderStatusBadge(estado: 'ENVIADO'),
            ),
          ),
        );

        expect(find.text('Confirmado'), findsOneWidget);
      });

      testWidgets('FACTURADO status displays as Confirmado', (tester) async {
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(
              body: OrderStatusBadge(estado: 'FACTURADO'),
            ),
          ),
        );

        expect(find.text('Confirmado'), findsOneWidget);
      });

      testWidgets('CONFIRMANDO status displays as Borrador', (tester) async {
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(
              body: OrderStatusBadge(estado: 'CONFIRMANDO'),
            ),
          ),
        );

        expect(find.text('Borrador'), findsOneWidget);
      });

      testWidgets('ANULADO status displays as Borrador', (tester) async {
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(
              body: OrderStatusBadge(estado: 'ANULADO'),
            ),
          ),
        );

        expect(find.text('Borrador'), findsOneWidget);
      });

      testWidgets('Lowercase status is handled correctly', (tester) async {
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(
              body: OrderStatusBadge(estado: 'confirmado'),
            ),
          ),
        );

        expect(find.text('Confirmado'), findsOneWidget);
      });
    });

    group('Unknown status fallback', () {
      testWidgets('Unknown status maps to Borrador', (tester) async {
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(
              body: OrderStatusBadge(estado: 'INVALID_STATUS'),
            ),
          ),
        );

        expect(find.text('Borrador'), findsOneWidget);
      });

      testWidgets('Empty status maps to Borrador', (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: OrderStatusBadge(estado: ''),
            ),
          ),
        );

        expect(find.text('Borrador'), findsOneWidget);
      });
    });

    group('Icon visibility toggle', () {
      testWidgets('shows icon dot when showIcon is true (default)',
          (tester) async {
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(
              body: OrderStatusBadge(estado: 'CONFIRMADO'),
            ),
          ),
        );

        final row = tester.widget<Row>(
          find.descendant(
            of: find.byType(OrderStatusBadge),
            matching: find.byType(Row),
          ),
        );
        expect(row, isNotNull);
        // Row has 3 children when showIcon is true: Container (dot), SizedBox (spacing), Text
        expect(row.children.length, 3);
      });

      testWidgets('hides icon dot when showIcon is false', (tester) async {
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(
              body: OrderStatusBadge(estado: 'CONFIRMADO', showIcon: false),
            ),
          ),
        );

        final row = tester.widget<Row>(
          find.descendant(
            of: find.byType(OrderStatusBadge),
            matching: find.byType(Row),
          ),
        );
        expect(row, isNotNull);
        // Row has 1 child when showIcon is false: Text
        expect(row.children.length, 1);
      });
    });

    group('Font size customization', () {
      testWidgets('respects custom fontSize', (tester) async {
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(
              body: OrderStatusBadge(estado: 'CONFIRMADO', fontSize: 16),
            ),
          ),
        );

        final textWidget = tester.widget<Text>(
          find.descendant(
            of: find.byType(OrderStatusBadge),
            matching: find.byType(Text),
          ),
        );

        expect(textWidget.style?.fontSize, 16);
      });

      testWidgets('uses default fontSize of 11 when not specified',
          (tester) async {
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(
              body: OrderStatusBadge(estado: 'CONFIRMADO'),
            ),
          ),
        );

        final textWidget = tester.widget<Text>(
          find.descendant(
            of: find.byType(OrderStatusBadge),
            matching: find.byType(Text),
          ),
        );

        expect(textWidget.style?.fontSize, 11);
      });
    });

    group('Container decorations', () {
      testWidgets('has rounded border radius', (tester) async {
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(
              body: OrderStatusBadge(estado: 'CONFIRMADO'),
            ),
          ),
        );

        final container = tester.widget<Container>(
          find.byType(Container).first,
        );

        final decoration = container.decoration as BoxDecoration;
        expect(decoration.borderRadius, BorderRadius.circular(20));
      });

      testWidgets('has gradient background', (tester) async {
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(
              body: OrderStatusBadge(estado: 'CONFIRMADO'),
            ),
          ),
        );

        final container = tester.widget<Container>(
          find.byType(Container).first,
        );

        final decoration = container.decoration as BoxDecoration;
        expect(decoration.gradient, isA<LinearGradient>());
      });
    });
  });

  group('OrderStatusConfig Tests', () {
    test('getTheme returns correct theme for BORRADOR', () {
      final theme = OrderStatusConfig.getTheme('BORRADOR');
      expect(theme.label, 'Borrador');
    });

    test('getTheme returns correct theme for CONFIRMADO', () {
      final theme = OrderStatusConfig.getTheme('CONFIRMADO');
      expect(theme.label, 'Confirmado');
    });

    test('getTheme maps ENVIADO to Confirmado', () {
      final theme = OrderStatusConfig.getTheme('ENVIADO');
      expect(theme.label, 'Confirmado');
    });

    test('getTheme maps FACTURADO to Confirmado', () {
      final theme = OrderStatusConfig.getTheme('FACTURADO');
      expect(theme.label, 'Confirmado');
    });

    test('getTheme maps CONFIRMANDO to Borrador', () {
      final theme = OrderStatusConfig.getTheme('CONFIRMANDO');
      expect(theme.label, 'Borrador');
    });

    test('getTheme maps ANULADO to Borrador', () {
      final theme = OrderStatusConfig.getTheme('ANULADO');
      expect(theme.label, 'Borrador');
    });

    test('getTheme maps unknown status to Borrador', () {
      final theme = OrderStatusConfig.getTheme('INVALID');
      expect(theme.label, 'Borrador');
    });

    test('getColor returns correct color for each status', () {
      expect(OrderStatusConfig.getColor('BORRADOR'), const Color(0xFFF97316));
      expect(OrderStatusConfig.getColor('CONFIRMADO'), const Color(0xFF22C55E));
      expect(OrderStatusConfig.getColor('ENVIADO'), const Color(0xFF22C55E));
      expect(OrderStatusConfig.getColor('PENDIENTE_APROBACION'),
          const Color(0xFFF97316));
      expect(OrderStatusConfig.getColor('ANULADO'), const Color(0xFFF97316));
    });

    test('getIcon returns correct icon for each status', () {
      expect(OrderStatusConfig.getIcon('BORRADOR'), Icons.edit_note);
      expect(OrderStatusConfig.getIcon('CONFIRMADO'), Icons.check_circle);
      expect(OrderStatusConfig.getIcon('ENVIADO'), Icons.check_circle);
      expect(
          OrderStatusConfig.getIcon('PENDIENTE_APROBACION'), Icons.edit_note);
      expect(OrderStatusConfig.getIcon('ANULADO'), Icons.edit_note);
    });

    test('getLabel returns simplified commercial labels', () {
      expect(OrderStatusConfig.getLabel('BORRADOR'), 'Borrador');
      expect(OrderStatusConfig.getLabel('CONFIRMADO'), 'Confirmado');
      expect(OrderStatusConfig.getLabel('ENVIADO'), 'Confirmado');
      expect(OrderStatusConfig.getLabel('FACTURADO'), 'Confirmado');
      expect(OrderStatusConfig.getLabel('CONFIRMANDO'), 'Borrador');
      expect(OrderStatusConfig.getLabel('ANULADO'), 'Borrador');
    });
  });
}
