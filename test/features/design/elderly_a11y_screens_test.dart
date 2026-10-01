import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/design/gmp_feedback.dart';
import 'package:gmp_app_mobilidad/features/auth/presentation/widgets/login_error_dialog.dart';
import 'package:gmp_app_mobilidad/features/auth/presentation/widgets/role_selection_dialog.dart';
import 'package:gmp_app_mobilidad/features/cobros/data/models/cobros_models.dart';
import 'package:gmp_app_mobilidad/features/cobros/presentation/widgets/albaran_card.dart';
import 'package:gmp_app_mobilidad/features/cobros/presentation/widgets/cobro_confirm_dialog.dart';
import 'package:gmp_app_mobilidad/features/cobros/presentation/widgets/entrega_detail_sheet.dart';
import 'package:gmp_app_mobilidad/features/objectives/presentation/widgets/client_matrix_error_state.dart';

Widget _scaled(Widget child) {
  return MaterialApp(
    builder: (context, navigatorChild) {
      return MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: const TextScaler.linear(2),
        ),
        child: navigatorChild ?? const SizedBox.shrink(),
      );
    },
    home: Scaffold(body: child),
  );
}

void _usePhone(WidgetTester tester) {
  tester.view.physicalSize = const Size(360, 640);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Albaran _albaran() {
  return Albaran(
    id: 'a1',
    numeroAlbaran: 2296,
    codigoCliente: '430001',
    nombreCliente: 'Bar Central',
    direccion: 'Calle Larga 12',
    fecha: DateTime(2026, 3, 2),
    importeTotal: 128.4,
    esCTR: true,
  );
}

void main() {
  test('gmpWhatHappened no enseña excepciones y dice qué hacer', () {
    expect(
      gmpWhatHappened('DioException: SocketException'),
      'No hay conexión con el servidor.',
    );
    expect(
      gmpWhatToDo('SocketException'),
      'Comprueba la cobertura y pulsa Reintentar.',
    );
    expect(
      gmpWhatHappened('No se pudieron cargar los datos de Nestlé'),
      'No se pudieron cargar los datos de Nestlé',
    );
    expect(
      gmpWhatToDo('Demasiados intentos'),
      'Espera unos minutos y vuelve a intentarlo.',
    );
  });

  testWidgets('panel de error cabe a 360 y texto x2', (tester) async {
    _usePhone(tester);
    var retried = false;
    await tester.pumpWidget(
      _scaled(
        GmpErrorPanel(
          whatHappened: 'No hay conexión con el servidor.',
          whatToDo: 'Comprueba la cobertura y pulsa Reintentar.',
          onRetry: () => retried = true,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('No hay conexión con el servidor.'), findsOneWidget);
    expect(
      find.text('Comprueba la cobertura y pulsa Reintentar.'),
      findsOneWidget,
    );
    await tester.tap(find.text('Reintentar'));
    expect(retried, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('panel vacío cabe a 360 y texto x2', (tester) async {
    _usePhone(tester);
    var acted = false;
    await tester.pumpWidget(
      _scaled(
        GmpEmptyPanel(
          title: 'Elige un comercial',
          whatToDo: 'Abre el filtro de arriba y elige un vendedor.',
          actionLabel: 'Entendido',
          onAction: () => acted = true,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Elige un comercial'), findsOneWidget);
    await tester.tap(find.text('Entendido'));
    expect(acted, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('diálogo de rol marca Elegido sin depender del color', (
    tester,
  ) async {
    _usePhone(tester);
    await tester.pumpWidget(_scaled(const RoleSelectionDialog()));
    await tester.pumpAndSettle();

    expect(find.text('Elige cómo vas a trabajar'), findsOneWidget);
    expect(find.text('Elegido'), findsOneWidget);
    expect(find.text('Reparto'), findsOneWidget);

    await tester.ensureVisible(find.text('Reparto'));
    await tester.tap(find.text('Reparto'));
    await tester.pumpAndSettle();
    expect(find.text('Elegido'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('error de acceso dice qué pasó y qué hacer', (tester) async {
    _usePhone(tester);
    await tester.pumpWidget(
      _scaled(
        const LoginAccessErrorDialog(
          message: 'El usuario o la contraseña no son correctos.',
          whatToDo:
              'Revisa usuario y contraseña y pulsa Iniciar sesión otra vez.',
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('No se pudo entrar'), findsOneWidget);
    expect(find.text('Entendido'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('error de matriz dice qué hacer y reintenta', (tester) async {
    _usePhone(tester);
    var retried = false;
    await tester.pumpWidget(
      _scaled(
        ClientMatrixErrorState(
          message: 'El servicio no pudo cargar la evolución ahora.',
          onRetry: () => retried = true,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.text('El servicio no pudo cargar la evolución ahora.'),
      findsOneWidget,
    );
    expect(find.textContaining('Pulsa Reintentar'), findsOneWidget);
    await tester.ensureVisible(find.text('Reintentar'));
    await tester.tap(find.text('Reintentar'));
    expect(retried, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('confirmar cobro exige observación y no desborda', (
    tester,
  ) async {
    _usePhone(tester);
    String? saved;
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) {
          return MediaQuery(
            data: MediaQuery.of(context).copyWith(
              textScaler: const TextScaler.linear(2),
            ),
            child: child ?? const SizedBox.shrink(),
          );
        },
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async {
                saved = await showDialog<String>(
                  context: context,
                  builder: (_) => const CobroConfirmDialog(
                    cliente: 'Bar Central',
                    importeLabel: '128,40 €',
                    formaPago: 'Efectivo',
                  ),
                );
              },
              child: const Text('Abrir'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Abrir'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Vas a cobrar'), findsOneWidget);
    await tester
        .ensureVisible(find.widgetWithText(FilledButton, 'Confirmar cobro'));
    await tester.tap(find.widgetWithText(FilledButton, 'Confirmar cobro'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Escribe una observación'), findsOneWidget);
    expect(saved, isNull);

    await tester.enterText(find.byType(TextFormField), 'Cobrado en caja');
    await tester
        .ensureVisible(find.widgetWithText(FilledButton, 'Confirmar cobro'));
    await tester.tap(find.widgetWithText(FilledButton, 'Confirmar cobro'));
    await tester.pumpAndSettle();
    expect(saved, 'Cobrado en caja');
    expect(tester.takeException(), isNull);
  });

  testWidgets('albarán dice Cobrar y cabe a 360 con texto x2', (tester) async {
    _usePhone(tester);
    await tester.pumpWidget(
      _scaled(
        SingleChildScrollView(child: AlbaranCard(albaran: _albaran())),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Cobrar'), findsOneWidget);
    expect(find.text('CTR'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('detalle de entrega no tiene botones mudos y cabe a 360', (
    tester,
  ) async {
    _usePhone(tester);
    var completed = false;
    await tester.pumpWidget(
      _scaled(
        EntregaDetailSheet(
          albaran: _albaran(),
          onComplete: () => completed = true,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Hay que cobrar'), findsOneWidget);
    expect(find.text('Foto'), findsNothing);
    expect(find.text('Firma'), findsNothing);
    await tester.ensureVisible(find.text('Completar entrega'));
    await tester.tap(find.text('Completar entrega'));
    expect(completed, isTrue);
    expect(tester.takeException(), isNull);
  });
}
