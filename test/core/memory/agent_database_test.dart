import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/memory/memory.dart';

void main() {
  group('HNSWVectorStore Tests', () {
    late HNSWVectorStore vectorStore;

    setUp(() {
      vectorStore = HNSWVectorStore(
        maxConnections: 8,
        maxLayers: 4,
        expansionFactor: 100.0,
      );
    });

    test('should insert vector and return search results', () {
      // Arrange
      final vector1 = [1.0, 0.0, 0.0, 0.0];
      final vector2 = [0.9, 0.1, 0.0, 0.0];
      final vector3 = [0.0, 1.0, 0.0, 0.0];

      // Act
      vectorStore.insert(
        id: 'item1',
        vector: vector1,
        metadata: {'name': 'Item 1', 'category': 'A'},
      );
      vectorStore.insert(
        id: 'item2',
        vector: vector2,
        metadata: {'name': 'Item 2', 'category': 'A'},
      );
      vectorStore.insert(
        id: 'item3',
        vector: vector3,
        metadata: {'name': 'Item 3', 'category': 'B'},
      );

      // Assert
      expect(vectorStore.size, 3);
      expect(vectorStore.getMetadata('item1'), isNotNull);
      expect(vectorStore.getMetadata('item1')?['name'], 'Item 1');
    });

    test('should find similar vectors', () {
      // Arrange
      final queryVector = [0.95, 0.05, 0.0, 0.0];
      
      vectorStore.insert(
        id: 'similar1',
        vector: [1.0, 0.0, 0.0, 0.0],
        metadata: {'label': 'very_similar'},
      );
      vectorStore.insert(
        id: 'similar2',
        vector: [0.9, 0.1, 0.0, 0.0],
        metadata: {'label': 'similar'},
      );
      vectorStore.insert(
        id: 'different',
        vector: [0.0, 1.0, 0.0, 0.0],
        metadata: {'label': 'different'},
      );

      // Act
      final results = vectorStore.search(
        queryVector: queryVector,
        k: 2,
        threshold: 0.5,
      );

      // Assert
      expect(results.length, greaterThanOrEqualTo(1));
      expect(results.first.id, isIn(['similar1', 'similar2']));
    });

    test('should remove vector', () {
      // Arrange
      vectorStore.insert(
        id: 'to_remove',
        vector: [1.0, 0.0, 0.0],
        metadata: {'temp': true},
      );
      
      expect(vectorStore.size, 1);

      // Act
      final removed = vectorStore.remove('to_remove');

      // Assert
      expect(removed, isTrue);
      expect(vectorStore.size, 0);
      expect(vectorStore.getMetadata('to_remove'), isNull);
    });

    test('should clear all vectors', () {
      // Arrange
      vectorStore.insert(id: 'item1', vector: [1.0, 0.0]);
      vectorStore.insert(id: 'item2', vector: [0.0, 1.0]);
      
      expect(vectorStore.size, 2);

      // Act
      vectorStore.clear();

      // Assert
      expect(vectorStore.size, 0);
    });
  });

  group('MemoryEntry Tests', () {
    test('should serialize and deserialize correctly', () {
      // Arrange
      final entry = MemoryEntry(
        key: 'test_key',
        value: {'data': 'test_value', 'number': 42},
        type: MemoryType.general,
        createdAt: DateTime(2024, 1, 1, 12, 0),
        updatedAt: DateTime(2024, 1, 1, 14, 0),
        expiresAt: 1704117600000, // 2024-01-01 15:00:00 UTC
      );

      // Act
      final json = entry.toJson();
      final deserialized = MemoryEntry.fromJson(json);

      // Assert
      expect(deserialized.key, entry.key);
      expect(deserialized.value, equals(entry.value));
      expect(deserialized.type, entry.type);
      expect(deserialized.expiresAt, entry.expiresAt);
    });

    test('should handle null expiresAt', () {
      // Arrange
      final entry = MemoryEntry(
        key: 'test_key',
        value: 'test_value',
        type: MemoryType.state,
        createdAt: DateTime.now(),
        updatedAt: DateTime.now(),
        expiresAt: null,
      );

      // Act
      final json = entry.toJson();
      final deserialized = MemoryEntry.fromJson(json);

      // Assert
      expect(deserialized.expiresAt, isNull);
    });
  });

  group('SyncOperation Tests', () {
    test('should serialize and deserialize correctly', () {
      // Arrange
      final operation = SyncOperation(
        id: 'op_123',
        operationType: 'create',
        entityType: 'pedido',
        entityId: 'order_456',
        data: {'items': ['item1', 'item2'], 'total': 100.0},
        createdAt: DateTime(2024, 1, 1),
        retryCount: 2,
      );

      // Act
      final json = operation.toJson();
      final deserialized = SyncOperation.fromJson(json);

      // Assert
      expect(deserialized.id, operation.id);
      expect(deserialized.operationType, operation.operationType);
      expect(deserialized.entityType, operation.entityType);
      expect(deserialized.entityId, operation.entityId);
      expect(deserialized.data, equals(operation.data));
      expect(deserialized.retryCount, operation.retryCount);
    });

    test('should create empty operation', () {
      // Act
      final empty = SyncOperation.empty();

      // Assert
      expect(empty.id, isEmpty);
      expect(empty.operationType, isEmpty);
      expect(empty.entityType, isEmpty);
      expect(empty.entityId, isEmpty);
      expect(empty.data, isEmpty);
      expect(empty.retryCount, 0);
    });
  });

  group('MemoryType Tests', () {
    test('should have correct number of types', () {
      expect(MemoryType.values.length, 7);
      expect(MemoryType.values[0], MemoryType.general);
      expect(MemoryType.values[1], MemoryType.state);
      expect(MemoryType.values[2], MemoryType.semantic);
      expect(MemoryType.values[3], MemoryType.draft);
      expect(MemoryType.values[4], MemoryType.cache);
      expect(MemoryType.values[5], MemoryType.config);
      expect(MemoryType.values[6], MemoryType.user);
    });
  });

  group('MemoryStats Tests', () {
    test('should create stats with correct values', () {
      // Arrange & Act
      final stats = MemoryStats(
        persistentCount: 100,
        stateCount: 50,
        syncQueueCount: 5,
        vectorCount: 200,
        workingMemoryCount: 25,
      );

      // Assert
      expect(stats.persistentCount, 100);
      expect(stats.stateCount, 50);
      expect(stats.syncQueueCount, 5);
      expect(stats.vectorCount, 200);
      expect(stats.workingMemoryCount, 25);
      
      expect(
        stats.toString(),
        contains('persistent: 100'),
      );
    });
  });
}
