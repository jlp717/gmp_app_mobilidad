import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('modal has no unimplemented signer or remote receipt routes', () {
    final modal = File(
      'lib/features/repartidor/presentation/widgets/rutero_detail_modal.dart',
    ).readAsStringSync();

    expect(modal, isNot(contains('/entregas/signers/')));
    expect(modal, isNot(contains('/whatsapp')));
    expect(modal, isNot(contains('/email')));
    expect(modal, isNot(contains('WhatsAppFormModal')));
    expect(modal, isNot(contains('EmailFormModal')));
    expect(modal, contains('Compartir PDF (acción local)'));
    expect(modal, contains('Email no disponible'));
  });

  test('line state, evidence and lifecycle contracts remain fail closed', () {
    final modal = File(
      'lib/features/repartidor/presentation/widgets/rutero_detail_modal.dart',
    ).readAsStringSync();
    final products = File(
      'lib/features/repartidor/presentation/widgets/rutero_detail_products.dart',
    ).readAsStringSync();

    for (final source in <String>[modal, products]) {
      expect(source, isNot(contains('[item.codigoArticulo]')));
      expect(source, isNot(contains('item.itemId.isNotEmpty ?')));
    }
    expect(modal, contains('finalObs.length > 1000'));
    expect(modal, contains('repartoEvidenceErrorMessage'));
    expect(modal, contains('PopScope'));
    expect(modal, contains('minimumSize: const Size(48, 48)'));
    expect(products, contains('validateRuteroLineIdentities'));
    expect(modal, contains('validateRuteroLoadedDeliveryLines'));
    expect(modal, contains('_items = filtered;'));
  });

  test('iOS declares camera and photo-library usage', () {
    final plist = File('ios/Runner/Info.plist').readAsStringSync();

    expect(plist, contains('<key>NSCameraUsageDescription</key>'));
    expect(plist, contains('<key>NSPhotoLibraryUsageDescription</key>'));
  });
}
