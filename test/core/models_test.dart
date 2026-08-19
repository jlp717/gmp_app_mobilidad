// GMP App Tests - Core Models
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/models/user_model.dart';
import 'package:gmp_app_mobilidad/core/models/estado_entrega.dart';

void main() {
  group('UserModel Tests', () {
    test('UserModel creates with required fields', () {
      final user = UserModel(
        id: '1',
        code: '01',
        name: 'Test User',
        company: 'GMP',
        role: 'JEFE_VENTAS',
      );

      expect(user.id, '1');
      expect(user.code, '01');
      expect(user.name, 'Test User');
      expect(user.company, 'GMP');
      expect(user.role, 'JEFE_VENTAS');
    });

    test('UserModel with optional fields', () {
      final user = UserModel(
        id: '1',
        code: '01',
        name: 'Test User',
        company: 'GMP',
        role: 'COMERCIAL',
        isJefeVentas: false,
        showCommissions: true,
        vendedorCode: 'V01',
      );

      expect(user.isJefeVentas, false);
      expect(user.showCommissions, true);
      expect(user.vendedorCode, 'V01');
    });

    test('UserModel isJefeVentas defaults to false', () {
      final user = UserModel(
        id: '1',
        code: '01',
        name: 'Test',
        company: 'GMP',
        role: 'COMERCIAL',
      );

      expect(user.isJefeVentas, false);
    });

    test('UserModel showCommissions can be set to true', () {
      final user = UserModel(
        id: '1',
        code: '01',
        name: 'Test',
        company: 'GMP',
        role: 'COMERCIAL',
        showCommissions: true,
      );

      expect(user.showCommissions, true);
    });

    test('UserModel roles are defined correctly', () {
      expect(UserRole.values.length, 3);
    });

    test('UserModel repartidor code works', () {
      final user = UserModel(
        id: '1',
        code: '01',
        name: 'Test',
        company: 'GMP',
        role: 'REPARTIDOR',
        codigoConductor: 'R01',
      );

      expect(user.codigoConductor, 'R01');
    });

    test('UserModel tipoVendedor works', () {
      final user = UserModel(
        id: '1',
        code: '01',
        name: 'Test',
        company: 'GMP',
        role: 'COMERCIAL',
        tipoVendedor: 'ESPECIAL',
      );

      expect(user.tipoVendedor, 'ESPECIAL');
    });

    test('UserModel delegation works', () {
      final user = UserModel(
        id: '1',
        code: '01',
        name: 'Test',
        company: 'GMP',
        role: 'JEFE_VENTAS',
        delegation: 'SUR',
      );

      expect(user.delegation, 'SUR');
    });
  });

  group('EstadoEntrega Tests', () {
    test('EstadoEntrega has correct values', () {
      expect(EstadoEntrega.values.length, greaterThanOrEqualTo(5));
    });

    test('EstadoEntrega toString returns label', () {
      expect(EstadoEntrega.pendiente.toString(), isNotEmpty);
    });

    test('EstadoEntrega has pendiente', () {
      expect(EstadoEntrega.pendiente, isNotNull);
    });

    test('EstadoEntrega has entregado', () {
      expect(EstadoEntrega.entregado, isNotNull);
    });

    test('EstadoEntrega marks a non-delivery as an operational warning', () {
      expect(EstadoEntrega.noEntregado.color, EstadoEntrega.pendiente.color);
      expect(EstadoEntrega.noEntregado.color,
          isNot(EstadoEntrega.entregado.color));
    });
  });
}
