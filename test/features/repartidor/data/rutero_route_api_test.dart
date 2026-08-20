import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/rutero_route_api.dart';

void main() {
  group('RuteroOrderState', () {
    test('parsea revision y documentos desde filas o identificadores', () {
      final state = RuteroOrderState.fromJson({
        'routeRevision': 42,
        'items': [
          {'documentId': ' E-35-19 '},
          ' E-35-20 ',
          {'documentId': ''},
          null,
        ],
      });

      expect(state.revision, '42');
      expect(state.orden, ['E-35-19', 'E-35-20']);
    });

    test('usa una orden vacia si la respuesta no contiene una lista', () {
      final state = RuteroOrderState.fromJson({
        'version': 'rev-1',
        'orden': {'documentId': 'E-35-19'},
      });

      expect(state.revision, 'rev-1');
      expect(state.orden, isEmpty);
    });
  });

  group('isCompleteDocumentPermutation', () {
    const current = ['E-35-19', 'E-35-20', 'E-35-21'];

    test('rechaza propuestas vacias o parciales', () {
      expect(
        isCompleteDocumentPermutation(
          currentIds: current,
          proposedIds: const [],
        ),
        isFalse,
      );
      expect(
        isCompleteDocumentPermutation(
          currentIds: current,
          proposedIds: const ['E-35-19', 'E-35-20'],
        ),
        isFalse,
      );
    });

    test('rechaza documentos duplicados o vacios', () {
      expect(
        isCompleteDocumentPermutation(
          currentIds: current,
          proposedIds: const ['E-35-19', 'E-35-19', 'E-35-21'],
        ),
        isFalse,
      );
      expect(
        isCompleteDocumentPermutation(
          currentIds: current,
          proposedIds: const ['E-35-19', ' ', 'E-35-21'],
        ),
        isFalse,
      );
    });

    test('acepta una permutacion completa, tambien con espacios externos', () {
      expect(
        isCompleteDocumentPermutation(
          currentIds: current,
          proposedIds: const [' E-35-21 ', 'E-35-19', 'E-35-20'],
        ),
        isTrue,
      );
    });
  });
}
