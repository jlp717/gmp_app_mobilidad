import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/models/user_model.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/widgets/shimmer_skeleton.dart';
import 'package:gmp_app_mobilidad/features/commissions/presentation/pages/commissions_page.dart';

/// ponytail: solo estados loading/error; exito requiere payload acoplado a la
/// tabla de 4k lineas de CommissionsPage. upgrade: refactor a ViewModel
/// inyectable cuando se toque esa pantalla.
class _HangingAdapter implements HttpClientAdapter {
  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) {
    return Completer<ResponseBody>().future;
  }
}

class _FailingAdapter implements HttpClientAdapter {
  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    throw DioException.connectionError(
      requestOptions: options,
      reason: 'backend down',
    );
  }
}

class _FakeAuthNotifier extends AuthNotifier {
  @override
  Future<AuthState> build() async {
    return const AuthState(
      user: UserModel(
        id: '57',
        code: '57',
        name: 'Comercial Prueba',
        company: 'GMP',
        role: 'COMERCIAL',
      ),
      isInitialized: true,
    );
  }
}

void main() {
  HttpClientAdapter? original;

  setUp(() {
    original = ApiClient.dio.httpClientAdapter;
  });

  tearDown(() {
    if (original != null) {
      ApiClient.dio.httpClientAdapter = original!;
    }
  });

  Widget wrap(Widget child) {
    return ProviderScope(
      overrides: [
        authProvider.overrideWith(_FakeAuthNotifier.new),
      ],
      child: MaterialApp(home: Scaffold(body: child)),
    );
  }

  testWidgets('estado loading muestra skeletons mientras consulta',
      (tester) async {
    ApiClient.dio.httpClientAdapter = _HangingAdapter();
    await tester.pumpWidget(
      wrap(const CommissionsPage(employeeCode: '57')),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(find.byType(SkeletonList), findsOneWidget);
  });

  testWidgets('estado error muestra mensaje sin crash', (tester) async {
    ApiClient.dio.httpClientAdapter = _FailingAdapter();
    await tester.pumpWidget(
      wrap(const CommissionsPage(employeeCode: '58')),
    );
    await tester.pump();
    await tester.pumpAndSettle();

    expect(find.textContaining('Error:'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
