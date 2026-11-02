import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/environment/environment_banner.dart';
import 'package:gmp_app_mobilidad/core/environment/environment_profile.dart';

void main() {
  test('parses only an explicitly verified server contract', () {
    final profile = EnvironmentProfile.fromResponse(<String, dynamic>{
      'success': true,
      'profile': <String, dynamic>{
        'profile': 'demo',
        'verified': true,
        'readSchema': 'DSEDAC',
        'writeSchema': 'JAVIER',
        'tableSet': 'isolated_test',
        'erpExportEnabled': false,
        'writesEnabled': true,
        'productionWritesEnabled': false,
      },
    });

    expect(profile.isVerified, isTrue);
    expect(profile.label, 'DEMO');
    expect(
      EnvironmentProfile.fromResponse(<String, dynamic>{
        'profile': <String, dynamic>{
          'profile': 'production',
          'verified': false,
        },
      }),
      EnvironmentProfile.unverified,
    );
  });

  testWidgets('shows demo mode from the server with accessible semantics',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: EnvironmentBanner(
          loader: () async => const EnvironmentProfile.verified(
            profile: EnvironmentKind.demo,
            readSchema: 'DSEDAC',
            writeSchema: 'JAVIER',
            tableSet: 'isolated_test',
            erpExportEnabled: false,
            writesEnabled: true,
            productionWritesEnabled: false,
          ),
          child: const Scaffold(body: Text('Contenido')),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('DEMO'), findsOneWidget);
    expect(
      find.bySemanticsLabel('Entorno verificado: DEMO'),
      findsOneWidget,
    );
  });

  testWidgets('fails visibly closed when the endpoint is unavailable',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: EnvironmentBanner(
          loader: () async => throw StateError('offline'),
          child: const Scaffold(body: Text('Contenido')),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Entorno sin verificar'), findsOneWidget);
    expect(
      find.bySemanticsLabel('Entorno sin verificar'),
      findsOneWidget,
    );
  });

  testWidgets('shows verified production explicitly as read-only',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: EnvironmentBanner(
          loader: () async => const EnvironmentProfile.verified(
            profile: EnvironmentKind.production,
            readSchema: 'DSEDAC',
            writeSchema: 'JAVIER',
            tableSet: 'production',
            erpExportEnabled: false,
            writesEnabled: false,
            productionWritesEnabled: false,
          ),
          child: const Scaffold(body: Text('Contenido')),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('PRODUCCIÓN · SOLO LECTURA'), findsOneWidget);
    expect(
      find.bySemanticsLabel(
        'Entorno verificado: PRODUCCIÓN · SOLO LECTURA',
      ),
      findsOneWidget,
    );
    expect(find.text('Entorno sin verificar'), findsNothing);
    expect(find.text('Contenido'), findsOneWidget);
  });
}
