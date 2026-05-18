import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/memory/memory.dart';

void main() {
  group('ReasoningBank Tests', () {
    late ReasoningBank reasoningBank;
    late AgentDatabase db;

    setUp(() async {
      // Nota: En tests reales, mockear AgentDatabase
      // Aquí usamos instancias reales para testing de integración
      db = AgentDatabase.instance;
      reasoningBank = ReasoningBank(db);
    });

    group('Product Embeddings', () {
      test('should generate consistent embeddings', () {
        // Act
        final embedding1 = reasoningBank.generateProductEmbedding(
          productCode: 'P001',
          productName: 'Producto Test',
          family: 'Familia A',
          brand: 'Marca X',
          price: 100,
        );

        final embedding2 = reasoningBank.generateProductEmbedding(
          productCode: 'P001',
          productName: 'Producto Test',
          family: 'Familia A',
          brand: 'Marca X',
          price: 100,
        );

        // Assert
        expect(embedding1.length, ReasoningBank.embeddingDimension);
        expect(embedding1, equals(embedding2)); // Mismos inputs = mismos outputs
      });

      test('should generate different embeddings for different products', () {
        // Act
        final embedding1 = reasoningBank.generateProductEmbedding(
          productCode: 'P001',
          productName: 'Producto A',
          family: 'Familia X',
        );

        final embedding2 = reasoningBank.generateProductEmbedding(
          productCode: 'P002',
          productName: 'Producto B',
          family: 'Familia Y',
        );

        // Assert
        expect(embedding1, isNot(equals(embedding2)));
      });
    });

    group('User Interactions', () {
      test('should record interaction with correct type', () async {
        // Arrange
        const userId = 'test_user';
        const productCode = 'test_product';

        // Act
        await reasoningBank.recordUserInteraction(
          userId: userId,
          productCode: productCode,
          type: InteractionType.view,
        );

        // Assert
        final profile = reasoningBank.getUserProfile(userId);
        expect(profile, isNotNull);
        expect(profile?['productScores']?[productCode], isNotNull);
      });

      test('should weight purchase higher than view', () async {
        // Arrange
        const userId = 'test_user_2';
        
        // Act - View
        await reasoningBank.recordUserInteraction(
          userId: userId,
          productCode: 'product_view',
          type: InteractionType.view,
        );

        // Act - Purchase
        await reasoningBank.recordUserInteraction(
          userId: userId,
          productCode: 'product_purchase',
          type: InteractionType.purchase,
          quantity: 5,
        );

        // Assert
        final profile = reasoningBank.getUserProfile(userId);
        final viewScore = profile?['productScores']?['product_view'] ?? 0;
        final purchaseScore = profile?['productScores']?['product_purchase'] ?? 0;

        expect(purchaseScore, greaterThan(viewScore));
      });
    });

    group('Recommendations', () {
      test('should return empty recommendations for new user', () {
        // Act
        final recommendations = reasoningBank.getRecommendations(
          userId: 'new_user_${DateTime.now().millisecondsSinceEpoch}',
          k: 10,
        );

        // Assert
        expect(recommendations, isEmpty);
      });

      test('should return recommendations after interactions', () async {
        // Arrange
        const userId = 'rec_test_user';
        
        // Record some interactions
        await reasoningBank.recordUserInteraction(
          userId: userId,
          productCode: 'prod_1',
          type: InteractionType.purchase,
          quantity: 2,
        );
        
        await reasoningBank.recordUserInteraction(
          userId: userId,
          productCode: 'prod_2',
          type: InteractionType.view,
        );

        // Act
        final recommendations = reasoningBank.getRecommendations(
          userId: userId,
          k: 5,
        );

        // Assert
        expect(recommendations.length, greaterThanOrEqualTo(1));
        final productCodes = recommendations.map((r) => r.productCode).toList();
        expect(productCodes, contains('prod_1'));
        expect(productCodes, contains('prod_2'));
      });
    });

    group('Adaptive Scoring', () {
      test('should calculate score with default weights', () async {
        // Arrange
        const userId = 'score_user';
        const productCode = 'score_product';

        // Record interaction to have data
        await reasoningBank.recordUserInteraction(
          userId: userId,
          productCode: productCode,
          type: InteractionType.purchase,
        );

        // Act
        final score = reasoningBank.calculateAdaptiveScore(
          userId: userId,
          productCode: productCode,
        );

        // Assert
        expect(score, isNotNull);
        expect(score, inInclusiveRange(0, 1));
      });

      test('should support custom weights', () async {
        // Arrange
        const userId = 'custom_weight_user';
        const productCode = 'custom_weight_product';

        final customWeights = {
          'recency': 0.5,
          'frequency': 0.3,
          'seasonality': 0.1,
          'user_preference': 0.1,
          'similarity': 0.0,
        };

        await reasoningBank.recordUserInteraction(
          userId: userId,
          productCode: productCode,
          type: InteractionType.view,
        );

        // Act
        final score = reasoningBank.calculateAdaptiveScore(
          userId: userId,
          productCode: productCode,
          customWeights: customWeights,
        );

        // Assert
        expect(score, isNotNull);
      });
    });

    group('Order Patterns', () {
      test('should analyze order pattern', () async {
        // Arrange
        const userId = 'pattern_user';
        final orderId = 'order_${DateTime.now().millisecondsSinceEpoch}';
        
        final items = [
          OrderItem(productCode: 'item1', quantity: 2, price: 50),
          OrderItem(productCode: 'item2', quantity: 1, price: 100),
        ];

        // Act
        await reasoningBank.analyzeOrderPattern(
          orderId: orderId,
          userId: userId,
          items: items,
        );

        // Assert - Pattern should be learned
        final patterns = reasoningBank.getLearnedPatterns(userId: userId);
        expect(patterns, isNotEmpty);
      });

      test('should learn frequently bought together', () async {
        // Arrange
        const userId = 'combo_user';
        
        // Analyze multiple orders with same combination
        for (var i = 0; i < 3; i++) {
          await reasoningBank.analyzeOrderPattern(
            orderId: 'order_${userId}_$i',
            userId: userId,
            items: [
              OrderItem(productCode: 'product_A', quantity: 1, price: 10),
              OrderItem(productCode: 'product_B', quantity: 1, price: 20),
            ],
          );
        }

        // Act
        final frequentlyBoughtTogether = reasoningBank.getFrequentlyBoughtTogether(
          userId: userId,
          productCode: 'product_A',
        );

        // Assert
        expect(frequentlyBoughtTogether, contains('product_B'));
      });
    });

    group('Pattern Learning', () {
      test('should learn and retrieve patterns', () async {
        // Arrange
        const userId = 'learn_user';
        
        // Record multiple interactions of same type
        for (var i = 0; i < 5; i++) {
          await reasoningBank.recordUserInteraction(
            userId: userId,
            productCode: 'product_$i',
            type: InteractionType.purchase,
          );
        }

        // Act
        final patterns = reasoningBank.getLearnedPatterns(
          userId: userId,
          type: InteractionType.purchase,
        );

        // Assert
        expect(patterns.length, greaterThanOrEqualTo(1));
        final pattern = patterns.first;
        expect(pattern.patternType, 'purchase');
        expect(pattern.products.length, greaterThanOrEqualTo(1));
      });
    });

    group('Clear Learning Data', () {
      test('should clear specific user data', () async {
        // Arrange
        const userId = 'clear_user';
        
        await reasoningBank.recordUserInteraction(
          userId: userId,
          productCode: 'product',
          type: InteractionType.view,
        );

        // Act
        await reasoningBank.clearLearningData(userId: userId);

        // Assert
        final profile = reasoningBank.getUserProfile(userId);
        // El perfil debería ser null o estar vacío después de limpiar
        expect(profile, isNull);
      });
    });
  });

  group('InteractionType Tests', () {
    test('should have correct values', () {
      expect(InteractionType.values.length, 4);
      expect(InteractionType.view, InteractionType.values[0]);
      expect(InteractionType.addToCart, InteractionType.values[1]);
      expect(InteractionType.purchase, InteractionType.values[2]);
      expect(InteractionType.favorite, InteractionType.values[3]);
    });
  });

  group('ProductSimilarityResult Tests', () {
    test('should create result with correct values', () {
      // Arrange & Act
      final result = ProductSimilarityResult(
        productCode: 'P001',
        productName: 'Test Product',
        similarity: 0.95,
        metadata: {'category': 'Test'},
      );

      // Assert
      expect(result.productCode, 'P001');
      expect(result.productName, 'Test Product');
      expect(result.similarity, 0.95);
      expect(result.metadata?['category'], 'Test');
    });
  });

  group('RecommendationResult Tests', () {
    test('should create result with reasons', () {
      // Arrange & Act
      final result = RecommendationResult(
        productCode: 'P001',
        score: 0.85,
        reasons: ['Basado en tu historial', 'Popular en tu zona'],
      );

      // Assert
      expect(result.productCode, 'P001');
      expect(result.score, 0.85);
      expect(result.reasons.length, 2);
    });
  });
}
