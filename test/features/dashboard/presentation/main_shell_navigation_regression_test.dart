import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/models/user_model.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/services/navigation_config_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  group('MainShell navigation regression contract', () {
    test('commercial navigation remains unchanged when repartidor work evolves',
        () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: true,
      );

      expect(
        items.map((item) => item.label),
        equals([
          'Clientes',
          'Ruta',
          'Objetivos',
          'Comisiones',
          'Facturas',
          'Pedidos',
          'Alertas',
          'Cobros',
          'Liquidación',
          'Bolsa',
          'Evolución',
          'Asistente',
        ]),
      );
    });

    test('warehouse navigation remains isolated from repartidor navigation',
        () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: true,
        isRepartidor: true,
        isJefeVentas: true,
        showCommissions: true,
      );

      expect(
        items.map((item) => item.label),
        equals([
          'Expediciones',
          'Vehículos',
          'Artículos',
          'Historial',
          'Personal',
        ]),
      );
    });

    test('ALMACEN is only a UI mode for an authenticated JEFE_VENTAS',
        () async {
      const manager = UserModel(
        id: 'V050',
        code: '050',
        name: 'Jefe',
        company: 'GMP',
        role: 'JEFE_VENTAS',
        vendedorCode: '050',
        isJefeVentas: true,
        tipoVendedor: '-',
        availableRoles: ['COMERCIAL', 'JEFE_VENTAS'],
        availableModes: ['COMERCIAL', 'ALMACEN'],
        vendedorCodes: ['050', '051'],
        claimsVersion: 1,
      );
      const commercial = UserModel(
        id: 'V060',
        code: '060',
        name: 'Comercial',
        company: 'GMP',
        role: 'COMERCIAL',
        vendedorCode: '060',
        tipoVendedor: '-',
        availableRoles: ['COMERCIAL'],
        availableModes: ['COMERCIAL'],
        vendedorCodes: ['060'],
        claimsVersion: 1,
      );
      SharedPreferences.setMockInitialValues({
        authActiveModePreferenceKey: 'ALMACEN',
      });
      final prefs = await SharedPreferences.getInstance();

      final restoredManagerMode = restoreAuthorizedActiveMode(prefs, manager);
      final restoredCommercialMode =
          restoreAuthorizedActiveMode(prefs, commercial);
      final managerState = AuthState(
        user: manager,
        activeMode: restoredManagerMode,
        isInitialized: true,
      );
      final commercialState = AuthState(
        user: commercial,
        activeMode: restoredCommercialMode,
        isInitialized: true,
      );

      expect(manager.role, 'JEFE_VENTAS');
      expect(managerState.activeMode, 'ALMACEN');
      expect(isWarehouseUiMode(managerState), isTrue);
      expect(commercialState.activeMode, 'COMERCIAL');
      expect(isWarehouseUiMode(commercialState), isFalse);

      Map<String, dynamic> managerResponse(String activeMode) => {
            'role': 'JEFE_VENTAS',
            'activeMode': activeMode,
            'availableRoles': ['COMERCIAL', 'JEFE_VENTAS'],
            'availableModes': ['COMERCIAL', 'ALMACEN'],
            'isJefeVentas': true,
            'isRepartidor': false,
            'codigoConductor': null,
            'matricula': null,
            'vendorCodes': ['050', '051'],
            'vendedorCodes': ['050', '051'],
            'tipoVendedor': '-',
            'showCommissions': true,
            'claimsVersion': 1,
            'user': {
              ...manager.toJson(),
              'role': 'JEFE_VENTAS',
              'activeMode': activeMode,
              'availableRoles': ['COMERCIAL', 'JEFE_VENTAS'],
              'availableModes': ['COMERCIAL', 'ALMACEN'],
              'isRepartidor': false,
              'vendorCodes': ['050', '051'],
              'vendedorCodes': ['050', '051'],
            },
          };

      final switched = projectAuthorizedModeSwitch(
        currentUser: manager,
        requestedMode: 'ALMACEN',
        response: managerResponse('ALMACEN'),
      );
      expect(switched.user.role, 'JEFE_VENTAS');
      expect(switched.user.isJefeVentas, isTrue);
      expect(switched.activeMode, 'ALMACEN');
      final switchedBackToSales = projectAuthorizedModeSwitch(
        currentUser: switched.user,
        requestedMode: 'JEFE_VENTAS',
        response: managerResponse('COMERCIAL'),
      );
      expect(switchedBackToSales.user.role, 'JEFE_VENTAS');
      expect(switchedBackToSales.user.isJefeVentas, isTrue);
      expect(switchedBackToSales.activeMode, 'COMERCIAL');
      expect(
        requireModeSwitchSession(const {
          'token': 'new-access-token',
          'refreshToken': 'new-refresh-token',
        }),
        (
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
        ),
      );
      expect(
        () => requireModeSwitchSession(const {
          'token': 'new-access-token',
        }),
        throwsStateError,
      );
      expect(
        () => projectAuthorizedModeSwitch(
          currentUser: switched.user,
          requestedMode: 'JEFE_VENTAS',
          response: managerResponse('ALMACEN'),
        ),
        throwsStateError,
      );
      expect(
        () => projectAuthorizedModeSwitch(
          currentUser: commercial,
          requestedMode: 'ALMACEN',
          response: {
            'role': 'COMERCIAL',
            'activeMode': 'ALMACEN',
            'availableRoles': ['COMERCIAL'],
            'availableModes': ['COMERCIAL'],
            'isJefeVentas': false,
            'isRepartidor': false,
            'codigoConductor': null,
            'matricula': null,
            'vendorCodes': ['060'],
            'vendedorCodes': ['060'],
            'tipoVendedor': '-',
            'showCommissions': true,
            'claimsVersion': 1,
            'user': {
              ...commercial.toJson(),
              'activeMode': 'ALMACEN',
              'availableRoles': ['COMERCIAL'],
              'availableModes': ['COMERCIAL'],
              'isRepartidor': false,
              'vendorCodes': ['060'],
              'vendedorCodes': ['060'],
            },
          },
        ),
        throwsStateError,
      );

      expect(
        NavigationConfigService.getNavItems(
          isAlmacen: isWarehouseUiMode(managerState),
          isRepartidor: false,
          isJefeVentas: manager.isJefeVentas,
          showCommissions: true,
        ).map((item) => item.label),
        contains('Expediciones'),
      );
      expect(
        NavigationConfigService.getNavItems(
          isAlmacen: isWarehouseUiMode(commercialState),
          isRepartidor: false,
          isJefeVentas: commercial.isJefeVentas,
          showCommissions: true,
        ).map((item) => item.label),
        isNot(contains('Expediciones')),
      );
    });
  });
}
