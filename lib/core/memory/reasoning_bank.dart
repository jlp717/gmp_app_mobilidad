import 'dart:math';
import 'agent_database.dart';
import 'vector_store_hnsw.dart';

/// **ReasoningBank - Adaptive Learning System**
///
/// Sistema de aprendizaje adaptativo para catálogo de productos y pedidos.
/// Basado en patrones de ReasoningBank de Claude-Flow v3.
///
/// Características:
/// - Embeddings semánticos de productos
/// - Learning de preferencias de usuario
/// - Recomendaciones basadas en historial
/// - Pattern mining de pedidos
/// - Adaptive ranking de productos
class ReasoningBank {
  final AgentDatabase _db;
  
  // Configuración de embedding
  static const int embeddingDimension = 128;
  
  // Weights para scoring adaptativo
  final Map<String, double> _featureWeights = {
    'recency': 0.25,
    'frequency': 0.20,
    'seasonality': 0.15,
    'user_preference': 0.25,
    'similarity': 0.15,
  };
  
  // Cache de patrones aprendidos
  final Map<String, PatternData> _learnedPatterns = {};
  
  ReasoningBank(this._db);
  
  // ==================== PRODUCT EMBEDDINGS ====================
  
  /// Genera embedding semántico para producto
  List<double> generateProductEmbedding({
    required String productCode,
    required String productName,
    String? family,
    String? brand,
    double? price,
    String? category,
  }) {
    // Normalizar texto
    final text = [
      productName,
      family,
      brand,
      category,
    ].whereType<String>().join(' ').toLowerCase();
    
    // Hash-based embedding (simulado - en producción usar modelo ML)
    final embedding = _textToEmbedding(text, embeddingDimension);
    
    // Incorporar features numéricas normalizadas
    if (price != null) {
      final priceNorm = _normalizePrice(price);
      for (var i = 0; i < embeddingDimension; i++) {
        embedding[i] += priceNorm * sin(i * 0.1);
      }
    }
    
    // Normalizar embedding final
    return _normalizeVector(embedding);
  }
  
  /// Indexa producto para búsqueda semántica
  Future<void> indexProduct({
    required String productCode,
    required String productName,
    String? family,
    String? brand,
    double? price,
    String? category,
    Map<String, dynamic>? metadata,
  }) async {
    final embedding = generateProductEmbedding(
      productCode: productCode,
      productName: productName,
      family: family,
      brand: brand,
      price: price,
      category: category,
    );
    
    await _db.insertVector(
      id: 'product:$productCode',
      embedding: embedding,
      metadata: {
        'type': 'product',
        'code': productCode,
        'name': productName,
        'family': family,
        'brand': brand,
        'price': price,
        'category': category,
        'indexedAt': DateTime.now().toIso8601String(),
        ...?metadata,
      },
      type: MemoryType.semantic,
    );
  }
  
  /// Busca productos similares
  List<ProductSimilarityResult> findSimilarProducts({
    required String productCode,
    int k = 10,
    double threshold = 0.7,
  }) {
    // Obtener embedding del producto original
    final productData = _db.getPersistent('product:$productCode');
    if (productData == null) return [];
    
    final embedding = productData['embedding'] as List<double>?;
    if (embedding == null) return [];
    
    // Búsqueda vectorial
    final results = _db.searchVectors(
      queryEmbedding: embedding,
      k: k + 1, // +1 para incluir el producto original
      threshold: threshold,
    );
    
    // Filtrar producto original y convertir resultados
    return results
        .where((r) => r.id != 'product:$productCode')
        .where((r) => r.metadata?['type'] == 'product')
        .map((r) => ProductSimilarityResult(
              productCode: r.metadata?['code'] ?? r.id,
              productName: r.metadata?['name'] ?? '',
              similarity: r.distance,
              metadata: r.metadata,
            ))
        .toList();
  }
  
  // ==================== USER PREFERENCES ====================
  
  /// Registra interacción de usuario con producto
  Future<void> recordUserInteraction({
    required String userId,
    required String productCode,
    required InteractionType type,
    double? quantity,
    double? price,
  }) async {
    final interaction = {
      'userId': userId,
      'productCode': productCode,
      'type': type.name,
      'quantity': quantity,
      'price': price,
      'timestamp': DateTime.now().toIso8601String(),
    };
    
    // Guardar interacción
    final interactionKey = 'interaction:${userId}:$productCode';
    await _db.setPersistent(
      key: interactionKey,
      value: interaction,
      type: MemoryType.user,
    );
    
    // Actualizar perfil de usuario
    await _updateUserProfile(userId, productCode, type, quantity);
    
    // Aprender patrón
    await _learnPattern(userId, productCode, type);
  }
  
  Future<void> _updateUserProfile(
    String userId,
    String productCode,
    InteractionType type,
    double? quantity,
  ) async {
    final profileKey = 'user_profile:$userId';
    Map<String, dynamic> profile = _db.getPersistent(profileKey) ?? {
      'userId': userId,
      'productScores': <String, double>{},
      'categoryPreferences': <String, double>{},
      'lastInteraction': DateTime.now().toIso8601String(),
      'interactionCount': 0,
    };
    
    // Actualizar score del producto
    final currentScore = (profile['productScores'][productCode] ?? 0.0) as double;
    final interactionWeight = _getInteractionWeight(type, quantity);
    profile['productScores'][productCode] =
        (currentScore + interactionWeight).clamp(0.0, 1.0);
    
    // Incrementar contador
    profile['interactionCount'] = (profile['interactionCount'] ?? 0) + 1;
    profile['lastInteraction'] = DateTime.now().toIso8601String();
    
    await _db.setPersistent(
      key: profileKey,
      value: profile,
      type: MemoryType.user,
    );
  }
  
  double _getInteractionWeight(InteractionType type, double? quantity) {
    switch (type) {
      case InteractionType.view:
        return 0.05;
      case InteractionType.addToCart:
        return 0.15;
      case InteractionType.purchase:
        return 0.3 + (quantity ?? 1) * 0.01;
      case InteractionType.favorite:
        return 0.25;
    }
  }
  
  /// Obtiene perfil de usuario
  Map<String, dynamic>? getUserProfile(String userId) {
    return _db.getPersistent('user_profile:$userId');
  }
  
  /// Obtiene productos recomendados para usuario
  List<RecommendationResult> getRecommendations({
    required String userId,
    int k = 20,
    String? categoryFilter,
  }) {
    final profile = getUserProfile(userId);
    if (profile == null) return [];
    
    final productScores = Map<String, double>.from(
      profile['productScores'] ?? {},
    );
    
    // Calcular scores con weights adaptativos
    final scoredProducts = <RecommendationResult>[];
    
    for (final entry in productScores.entries) {
      final productCode = entry.key;
      final baseScore = entry.value;
      
      // Aplicar decay temporal
      final recencyScore = _calculateRecencyScore(userId, productCode);
      
      // Score final ponderado
      final finalScore = baseScore * _featureWeights['user_preference']! +
          recencyScore * _featureWeights['recency']!;
      
      scoredProducts.add(RecommendationResult(
        productCode: productCode,
        score: finalScore,
        reasons: ['Basado en tu historial'],
      ));
    }
    
    // Ordenar por score
    scoredProducts.sort((a, b) => b.score.compareTo(a.score));
    
    return scoredProducts.take(k).toList();
  }
  
  double _calculateRecencyScore(String userId, String productCode) {
    final interactionKey = 'interaction:${userId}:$productCode';
    final interaction = _db.getPersistent(interactionKey);
    
    if (interaction == null) return 0;
    
    final timestamp = DateTime.tryParse(interaction['timestamp'] ?? '');
    if (timestamp == null) return 0;
    
    final daysSince = DateTime.now().difference(timestamp).inDays;
    
    // Decay exponencial: score = e^(-days/30)
    return exp(-daysSince / 30);
  }
  
  // ==================== PATTERN LEARNING ====================
  
  Future<void> _learnPattern(
    String userId,
    String productCode,
    InteractionType type,
  ) async {
    final patternKey = 'pattern:$userId:$type';
    
    PatternData pattern = _learnedPatterns[patternKey] ?? 
        PatternData(
          userId: userId,
          patternType: type.name,
          products: [],
          frequencies: {},
          lastUpdated: DateTime.now(),
        );
    
    // Actualizar frecuencia
    pattern.frequencies[productCode] = 
        (pattern.frequencies[productCode] ?? 0) + 1;
    
    if (!pattern.products.contains(productCode)) {
      pattern.products.add(productCode);
    }
    
    pattern.lastUpdated = DateTime.now();
    _learnedPatterns[patternKey] = pattern;
    
    // Persistir patrón
    await _db.setPersistent(
      key: patternKey,
      value: pattern.toJson(),
      type: MemoryType.entity,
    );
  }
  
  /// Obtiene patrones aprendidos
  List<PatternData> getLearnedPatterns({String? userId, InteractionType? type}) {
    return _learnedPatterns.values
        .where((p) => userId == null || p.userId == userId)
        .where((p) => type == null || p.patternType == type.name)
        .toList();
  }
  
  // ==================== ORDER PATTERNS ====================
  
  /// Analiza patrón de pedido
  Future<void> analyzeOrderPattern({
    required String orderId,
    required String userId,
    required List<OrderItem> items,
  }) async {
    // Extraer features del pedido
    final features = {
      'totalItems': items.length,
      'totalValue': items.fold<double>(
        0,
        (sum, item) => sum + (item.price * item.quantity),
      ),
      'categories': items.map((i) => i.category).whereType<String>().toSet().toList(),
      'avgPrice': items.isEmpty 
          ? 0 
          : items.fold<double>(0, (sum, i) => sum + i.price) / items.length,
    };
    
    // Guardar patrón de pedido
    final orderPattern = OrderPattern(
      orderId: orderId,
      userId: userId,
      items: items.map((i) => i.productCode).toList(),
      features: features,
      createdAt: DateTime.now(),
    );
    
    await _db.setPersistent(
      key: 'order_pattern:$orderId',
      value: orderPattern.toJson(),
      type: MemoryType.entity,
    );
    
    // Aprender combinaciones frecuentes
    await _learnFrequentCombinations(userId, items.map((i) => i.productCode).toList());
  }
  
  Future<void> _learnFrequentCombinations(
    String userId,
    List<String> productCodes,
  ) async {
    // Generar pares de productos comprados juntos
    for (var i = 0; i < productCodes.length; i++) {
      for (var j = i + 1; j < productCodes.length; j++) {
        final pairKey = 'combo:${userId}:${productCodes[i]}:${productCodes[j]}';
        final count = _db.getPersistent(pairKey) ?? 0;
        await _db.setPersistent(
          key: pairKey,
          value: count + 1,
          type: MemoryType.entity,
        );
      }
    }
  }
  
  /// Obtiene productos frecuentemente comprados juntos
  List<String> getFrequentlyBoughtTogether({
    required String userId,
    required String productCode,
    int k = 5,
  }) {
    final combos = <String, int>{};
    
    // Buscar todas las combinaciones que incluyen este producto
    for (final key in _learnedPatterns.keys) {
      if (key.contains('combo:$userId:$productCode:')) {
        final parts = key.split(':');
        if (parts.length >= 5) {
          final otherProduct = parts[4];
          final count = _db.getPersistent(key) ?? 0;
          combos[otherProduct] = count;
        }
      } else if (key.contains('combo:$userId:') && key.contains(':$productCode')) {
        final parts = key.split(':');
        if (parts.length >= 5) {
          final otherProduct = parts[3] == productCode ? parts[4] : parts[3];
          final count = _db.getPersistent(key) ?? 0;
          combos[otherProduct] = count;
        }
      }
    }
    
    // Ordenar por frecuencia
    final sorted = combos.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    
    return sorted.take(k).map((e) => e.key).toList();
  }
  
  // ==================== ADAPTIVE SCORING ====================
  
  /// Calcula score adaptativo para producto
  double calculateAdaptiveScore({
    required String userId,
    required String productCode,
    Map<String, double>? customWeights,
  }) {
    final weights = customWeights ?? _featureWeights;
    
    // Obtener componentes del score
    final recencyScore = _calculateRecencyScore(userId, productCode);
    final frequencyScore = _calculateFrequencyScore(userId, productCode);
    final preferenceScore = _calculatePreferenceScore(userId, productCode);
    final similarityScore = _calculateSimilarityScore(userId, productCode);
    final seasonalityScore = _calculateSeasonalityScore(productCode);
    
    // Score ponderado
    return recencyScore * weights['recency']! +
        frequencyScore * weights['frequency']! +
        seasonalityScore * weights['seasonality']! +
        preferenceScore * weights['user_preference']! +
        similarityScore * weights['similarity']!;
  }
  
  double _calculateFrequencyScore(String userId, String productCode) {
    final interactionKey = 'interaction:${userId}:$productCode';
    final interaction = _db.getPersistent(interactionKey);
    
    if (interaction == null) return 0;
    
    final count = interaction['count'] ?? 1;
    return min(1.0, count / 10); // Normalizar a 0-1
  }
  
  double _calculatePreferenceScore(String userId, String productCode) {
    final profile = getUserProfile(userId);
    if (profile == null) return 0;
    
    final productScores = Map<String, double>.from(
      profile['productScores'] ?? {},
    );
    
    return productScores[productCode] ?? 0;
  }
  
  double _calculateSimilarityScore(String userId, String productCode) {
    // Basado en productos similares a los que el usuario ha comprado
    final profile = getUserProfile(userId);
    if (profile == null) return 0;
    
    final purchasedProducts = profile['productScores']?.keys ?? [];
    
    double maxSimilarity = 0;
    for (final purchasedCode in purchasedProducts) {
      final similar = findSimilarProducts(
        productCode: purchasedCode,
        k: 1,
        threshold: 0.5,
      );
      
      for (final sim in similar) {
        if (sim.productCode == productCode) {
          maxSimilarity = max(maxSimilarity, sim.similarity);
        }
      }
    }
    
    return maxSimilarity;
  }
  
  double _calculateSeasonalityScore(String productCode) {
    // Implementación básica - podría mejorarse con datos históricos
    final month = DateTime.now().month;
    
    // Productos con estacionalidad conocida (ejemplo)
    final seasonalProducts = {
      'summer': [6, 7, 8],
      'winter': [12, 1, 2],
    };
    
    // Verificar si producto tiene metadata de estacionalidad
    final productData = _db.getPersistent('product:$productCode');
    if (productData == null) return 0.5; // Score neutral
    
    final season = productData['season'] as String?;
    if (season == null) return 0.5;
    
    final seasonalMonths = seasonalProducts[season] ?? [];
    return seasonalMonths.contains(month) ? 1.0 : 0.3;
  }
  
  // ==================== UTILITIES ====================
  
  List<double> _textToEmbedding(String text, int dimension) {
    final embedding = List<double>.filled(dimension, 0);
    
    // Hash-based embedding
    for (var i = 0; i < text.length; i++) {
      final charCode = text.codeUnitAt(i);
      final index = charCode % dimension;
      embedding[index] += (charCode / 256);
    }
    
    // Añadir variación posicional
    for (var i = 0; i < dimension; i++) {
      embedding[i] += sin(i * 0.1) * 0.1;
    }
    
    return embedding;
  }
  
  double _normalizePrice(double price) {
    // Normalizar precio a rango 0-1 (asumiendo max 1000)
    return min(1.0, price / 1000);
  }
  
  List<double> _normalizeVector(List<double> vector) {
    final magnitude = sqrt(vector.fold<double>(
      0,
      (sum, v) => sum + v * v,
    ));
    
    if (magnitude == 0) return vector;
    
    return vector.map((v) => v / magnitude).toList();
  }
  
  /// Limpia datos de aprendizaje
  Future<void> clearLearningData({String? userId}) async {
    if (userId == null) {
      await _db.clearState();
      _learnedPatterns.clear();
    } else {
      // Limpiar solo datos de usuario específico
      final keysToClear = [
        'user_profile:$userId',
      ];
      
      for (final key in keysToClear) {
        await _db.deletePersistent(key);
      }
      
      _learnedPatterns.removeWhere((k, v) => k.contains(':$userId:'));
    }
  }
}

// ==================== MODELOS ====================

enum InteractionType {
  view,
  addToCart,
  purchase,
  favorite,
}

class ProductSimilarityResult {
  final String productCode;
  final String productName;
  final double similarity;
  final Map<String, dynamic>? metadata;
  
  ProductSimilarityResult({
    required this.productCode,
    required this.productName,
    required this.similarity,
    this.metadata,
  });
}

class RecommendationResult {
  final String productCode;
  final double score;
  final List<String> reasons;
  
  RecommendationResult({
    required this.productCode,
    required this.score,
    required this.reasons,
  });
}

class PatternData {
  final String userId;
  final String patternType;
  final List<String> products;
  final Map<String, int> frequencies;
  DateTime lastUpdated;
  
  PatternData({
    required this.userId,
    required this.patternType,
    required this.products,
    required this.frequencies,
    required this.lastUpdated,
  });
  
  Map<String, dynamic> toJson() => {
        'userId': userId,
        'patternType': patternType,
        'products': products,
        'frequencies': frequencies,
        'lastUpdated': lastUpdated.toIso8601String(),
      };
  
  factory PatternData.fromJson(Map<String, dynamic> json) => PatternData(
        userId: json['userId'] ?? '',
        patternType: json['patternType'] ?? '',
        products: List<String>.from(json['products'] ?? []),
        frequencies: Map<String, int>.from(json['frequencies'] ?? {}),
        lastUpdated: DateTime.tryParse(json['lastUpdated'] ?? '') ?? DateTime.now(),
      );
}

class OrderItem {
  final String productCode;
  final String? category;
  final double quantity;
  final double price;
  
  OrderItem({
    required this.productCode,
    this.category,
    required this.quantity,
    required this.price,
  });
}

class OrderPattern {
  final String orderId;
  final String userId;
  final List<String> items;
  final Map<String, dynamic> features;
  final DateTime createdAt;
  
  OrderPattern({
    required this.orderId,
    required this.userId,
    required this.items,
    required this.features,
    required this.createdAt,
  });
  
  Map<String, dynamic> toJson() => {
        'orderId': orderId,
        'userId': userId,
        'items': items,
        'features': features,
        'createdAt': createdAt.toIso8601String(),
      };
  
  factory OrderPattern.fromJson(Map<String, dynamic> json) => OrderPattern(
        orderId: json['orderId'] ?? '',
        userId: json['userId'] ?? '',
        items: List<String>.from(json['items'] ?? []),
        features: Map<String, dynamic>.from(json['features'] ?? {}),
        createdAt: DateTime.tryParse(json['createdAt'] ?? '') ?? DateTime.now(),
      );
}
