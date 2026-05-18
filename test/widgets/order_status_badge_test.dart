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

      testWidgets('ENVIADO status displays correct label', (tester) async {
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(
              body: OrderStatusBadge(estado: 'ENVIADO'),
            ),
          ),
        );

        expect(find.text('Enviado'), findsOneWidget);
      });

      testWidgets('FACTURADO status displays correct label', (tester) async {
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(
              body: OrderStatusBadge(estado: 'FACTURADO'),
            ),
          ),
        );

        expect(find.text('Facturado'), findsOneWidget);
      });

      testWidgets('ANULADO status displays correct label', (tester) async {
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(
              body: OrderStatusBadge(estado: 'ANULADO'),
            ),
          ),
        );

        expect(find.text('Anulado'), findsOneWidget);
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
      testWidgets('Unknown status displays Desconocido', (tester) async {
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(
              body: OrderStatusBadge(estado: 'INVALID_STATUS'),
            ),
          ),
        );

        expect(find.text('Desconocido'), findsOneWidget);
      });

      testWidgets('Null status displays Desconocido', (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: OrderStatusBadge(estado: ''),
            ),
          ),
        );

        expect(find.text('Desconocido'), findsOneWidget);
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

    test('getTheme returns correct theme for ENVIADO', () {
      final theme = OrderStatusConfig.getTheme('ENVIADO');
      expect(theme.label, 'Enviado');
    });

    test('getTheme returns correct theme for FACTURADO', () {
      final theme = OrderStatusConfig.getTheme('FACTURADO');
      expect(theme.label, 'Facturado');
    });

    test('getTheme returns correct theme for ANULADO', () {
      final theme = OrderStatusConfig.getTheme('ANULADO');
      expect(theme.label, 'Anulado');
    });

    test('getTheme returns Desconocido for unknown status', () {
      final theme = OrderStatusConfig.getTheme('INVALID');
      expect(theme.label, 'Desconocido');
    });

    test('getColor returns correct color for each status', () {
      expect(OrderStatusConfig.getColor('BORRADOR'), const Color(0xFFF97316));
      expect(OrderStatusConfig.getColor('CONFIRMADO'), const Color(0xFF3B82F6));
      expect(OrderStatusConfig.getColor('ENVIADO'), const Color(0xFF22C55E));
      expect(OrderStatusConfig.getColor('FACTURADO'), const Color(0xFFA855F7));
      expect(OrderStatusConfig.getColor('ANULADO'), const Color(0xFFEF4444));
    });

    test('getIcon returns correct icon for each status', () {
      expect(OrderStatusConfig.getIcon('BORRADOR'), Icons.edit_note);
      expect(OrderStatusConfig.getIcon('CONFIRMADO'), Icons.check_circle);
      expect(OrderStatusConfig.getIcon('ENVIADO'), Icons.local_shipping);
      expect(OrderStatusConfig.getIcon('FACTURADO'), Icons.receipt_long);
      expect(OrderStatusConfig.getIcon('ANULADO'), Icons.cancel);
    });

    test('getLabel returns correct label for each status', () {
      expect(OrderStatusConfig.getLabel('BORRADOR'), 'Borrador');
      expect(OrderStatusConfig.getLabel('CONFIRMADO'), 'Confirmado');
      expect(OrderStatusConfig.getLabel('ENVIADO'), 'Enviado');
      expect(OrderStatusConfig.getLabel('FACTURADO'), 'Facturado');
      expect(OrderStatusConfig.getLabel('ANULADO'), 'Anulado');
    });
  });
}
