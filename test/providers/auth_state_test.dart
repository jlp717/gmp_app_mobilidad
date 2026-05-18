// GMP Auth State Tests
import 'package:flutter_test/flutter_test.dart';

class AuthState {
  final String? userId;
  final String? role;
  final bool isJefeVentas;
  final bool showCommissions;
  final bool isAuthenticated;

  AuthState({
    this.userId,
    this.role,
    this.isJefeVentas = false,
    this.showCommissions = false,
    this.isAuthenticated = false,
  });

  AuthState copyWith({
    String? userId,
    String? role,
    bool? isJefeVentas,
    bool? showCommissions,
    bool? isAuthenticated,
  }) {
    return AuthState(
      userId: userId ?? this.userId,
      role: role ?? this.role,
      isJefeVentas: isJefeVentas ?? this.isJefeVentas,
      showCommissions: showCommissions ?? this.showCommissions,
      isAuthenticated: isAuthenticated ?? this.isAuthenticated,
    );
  }

  static AuthState unauthenticated() {
    return AuthState(isAuthenticated: false);
  }

  static AuthState authenticated({
    required String userId,
    required String role,
    bool isJefeVentas = false,
    bool showCommissions = false,
  }) {
    return AuthState(
      userId: userId,
      role: role,
      isJefeVentas: isJefeVentas,
      showCommissions: showCommissions,
      isAuthenticated: true,
    );
  }
}

void main() {
  group('AuthState Tests', () {
    test('creates unauthenticated state', () {
      final auth = AuthState.unauthenticated();
      expect(auth.isAuthenticated, false);
      expect(auth.userId, isNull);
    });

    test('creates authenticated state', () {
      final auth = AuthState.authenticated(
        userId: '1',
        role: 'JEFE_VENTAS',
        isJefeVentas: true,
        showCommissions: true,
      );

      expect(auth.isAuthenticated, true);
      expect(auth.userId, '1');
      expect(auth.role, 'JEFE_VENTAS');
      expect(auth.isJefeVentas, true);
      expect(auth.showCommissions, true);
    });

    test('default values are correct', () {
      final auth = AuthState();
      expect(auth.isJefeVentas, false);
      expect(auth.showCommissions, false);
      expect(auth.isAuthenticated, false);
    });

    test('copyWith preserves values', () {
      final auth = AuthState.authenticated(
        userId: '1',
        role: 'COMERCIAL',
      );

      final updated = auth.copyWith(isJefeVentas: true);

      expect(updated.userId, '1');
      expect(updated.role, 'COMERCIAL');
      expect(updated.isJefeVentas, true);
    });
  });

  group('Auth Role Tests', () {
    test('JEFE_VENTAS role is identified', () {
      final auth = AuthState.authenticated(
        userId: '1',
        role: 'JEFE_VENTAS',
        isJefeVentas: true,
      );

      expect(auth.role, 'JEFE_VENTAS');
      expect(auth.isJefeVentas, true);
    });

    test('COMERCIAL role is not jefe', () {
      final auth = AuthState.authenticated(
        userId: '2',
        role: 'COMERCIAL',
        isJefeVentas: false,
      );

      expect(auth.role, 'COMERCIAL');
      expect(auth.isJefeVentas, false);
    });

    test('REPARTIDOR role is identified', () {
      final auth = AuthState.authenticated(
        userId: '3',
        role: 'REPARTIDOR',
      );

      expect(auth.role, 'REPARTIDOR');
    });

    test('ALMACEN role is identified', () {
      final auth = AuthState.authenticated(
        userId: '4',
        role: 'ALMACEN',
      );

      expect(auth.role, 'ALMACEN');
    });
  });
}
