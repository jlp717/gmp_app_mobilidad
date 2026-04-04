import 'dart:math';
import 'dart:collection';
import 'package:collection/collection.dart';

/// **HNSW (Hierarchical Navigable Small World) Vector Search**
/// 
/// Implementación optimizada para búsqueda semántica aproximada (ANN)
/// en espacio de memoria unificado de AgentDB.
/// 
/// Características:
/// - Búsqueda O(log n) en espacios de alta dimensionalidad
/// - Construcción incremental de grafos de proximidad
/// - Múltiples capas de navegación (skip-list style)
/// - Distancia coseno para similitud semántica
class HNSWVectorStore {
  final int maxConnections;
  final int maxLayers;
  final double expansionFactor;
  
  final Random _random = Random();
  final Map<String, HNSWNode> _nodes = {};
  HNSWNode? _entryPoint;
  
  /// Embeddings cache para acceso rápido
  final Map<String, List<double>> _embeddingCache = {};
  
  HNSWVectorStore({
    this.maxConnections = 16,
    this.maxLayers = 8,
    this.expansionFactor = 200.0,
  });
  
  /// Inserta un vector con su identificador y metadata
  void insert({
    required String id,
    required List<double> vector,
    Map<String, dynamic>? metadata,
  }) {
    _embeddingCache[id] = vector;
    final node = HNSWNode(id: id, vector: vector, metadata: metadata);
    _nodes[id] = node;
    
    // Construir grafo HNSW
    _buildHNSWGraph(node);
  }
  
  void _buildHNSWGraph(HNSWNode newNode) {
    if (_entryPoint == null) {
      _entryPoint = newNode;
      newNode.layer = _getRandomLayer();
      return;
    }

    var currentEntryPoint = _entryPoint!;
    var currentLayer = currentEntryPoint.layer;
    final newLayer = _getRandomLayer();
    newNode.layer = newLayer;

    // Búsqueda greedy desde la capa más alta
    for (var layer = currentLayer; layer >= 0; layer--) {
      final nearestNeighbors = _searchLayer(
        newNode,
        currentEntryPoint,
        layer,
        1,
      );

      if (layer > newLayer) {
        currentEntryPoint = nearestNeighbors.first;
      } else {
        _connectNode(newNode, nearestNeighbors, layer);
      }
    }

    // Actualizar punto de entrada si nueva capa es más alta
    if (newLayer > _entryPoint!.layer) {
      _entryPoint = newNode;
    }
  }
  
  void _connectNode(HNSWNode newNode, List<HNSWNode> neighbors, int layer) {
    // Conectar nuevo nodo a sus vecinos más cercanos
    for (final neighbor in neighbors) {
      if (newNode.links[layer].length < maxConnections) {
        newNode.links[layer].add(neighbor.id);
      }
      if (neighbor.links[layer].length < maxConnections) {
        neighbor.links[layer].add(newNode.id);
      }
    }
    
    // Rebalancear conexiones si exceden máximo
    _rebalanceConnections(newNode, layer);
  }
  
  void _rebalanceConnections(HNSWNode node, int layer) {
    if (node.links[layer].length <= maxConnections) return;
    
    // Mantener solo las conexiones más cercanas
    final neighbors = node.links[layer]
        .map((id) => _nodes[id]!)
        .toList();
    
    neighbors.sort((a, b) {
      final distA = _cosineDistance(node.vector, a.vector);
      final distB = _cosineDistance(node.vector, b.vector);
      return distA.compareTo(distB);
    });
    
    node.links[layer] = neighbors
        .take(maxConnections)
        .map((n) => n.id)
        .toList();
  }
  
  /// Búsqueda de k vecinos más cercanos
  List<VectorSearchResult> search({
    required List<double> queryVector,
    int k = 10,
    double? threshold,
  }) {
    if (_entryPoint == null) return [];
    
    var currentEntryPoint = _entryPoint!;
    
    // Búsqueda greedy desde la capa más alta
    for (var layer = _entryPoint!.layer; layer >= 0; layer--) {
      final nearestNeighbors = _searchLayer(
        HNSWNode(id: 'query', vector: queryVector),
        currentEntryPoint,
        layer,
        1,
      );
      currentEntryPoint = _nodes[nearestNeighbors.first.id] ?? currentEntryPoint;
    }
    
    // Búsqueda exhaustiva en capa 0
    final candidates = _searchLayer(
      HNSWNode(id: 'query', vector: queryVector),
      currentEntryPoint,
      0,
      k * expansionFactor.toInt(),
    );
    
    // Filtrar por threshold y retornar top-k
    final results = candidates
        .map((node) => VectorSearchResult(
              id: node.id,
              distance: _cosineDistance(queryVector, node.vector),
              metadata: node.metadata,
            ))
        .where((result) => threshold == null || result.distance >= threshold)
        .toList();
    
    results.sort((a, b) => b.distance.compareTo(a.distance));
    return results.take(k).toList();
  }
  
  List<HNSWNode> _searchLayer(
    HNSWNode query,
    HNSWNode entryPoint,
    int layer,
    int ef,
  ) {
    final visited = <String>{};
    final candidates = PriorityQueue<HNSWNode>((a, b) {
      final distA = _cosineDistance(query.vector, a.vector);
      final distB = _cosineDistance(query.vector, b.vector);
      return distB.compareTo(distA); // Max-heap
    });

    final results = <HNSWNode>[];

    visited.add(entryPoint.id);
    candidates.add(entryPoint);

    while (candidates.isNotEmpty) {
      final closest = candidates.removeFirst();
      final closestDist = _cosineDistance(query.vector, closest.vector);

      if (results.length >= ef) {
        final farthestResult = results.reduce((a, b) {
          final distA = _cosineDistance(query.vector, a.vector);
          final distB = _cosineDistance(query.vector, b.vector);
          return distA > distB ? a : b;
        });
        final farthestDist = _cosineDistance(query.vector, farthestResult.vector);
        if (closestDist > farthestDist) {
          break;
        }
      }

      results.add(closest);
      if (results.length > ef) {
        results.removeAt(results.length - 1);
      }

      // Explorar vecinos
      for (final neighborId in closest.links[layer]) {
        if (!visited.contains(neighborId)) {
          visited.add(neighborId);
          final neighbor = _nodes[neighborId];
          if (neighbor != null) {
            candidates.add(neighbor);
          }
        }
      }
    }
    
    return results;
  }
  
  int _getRandomLayer() {
    var layer = 0;
    while (_random.nextDouble() < 0.5 && layer < maxLayers - 1) {
      layer++;
    }
    return layer;
  }
  
  double _cosineDistance(List<double> a, List<double> b) {
    if (a.length != b.length) {
      throw ArgumentError('Vectors must have same dimension');
    }
    
    double dotProduct = 0;
    double normA = 0;
    double normB = 0;
    
    for (var i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    if (normA == 0 || normB == 0) return 0;
    
    return dotProduct / (sqrt(normA) * sqrt(normB));
  }
  
  /// Elimina un vector del índice
  bool remove(String id) {
    final node = _nodes[id];
    if (node == null) return false;
    
    // Remover de todos los links
    for (final otherNode in _nodes.values) {
      for (var layer = 0; layer < otherNode.links.length; layer++) {
        otherNode.links[layer].remove(id);
      }
    }
    
    _nodes.remove(id);
    _embeddingCache.remove(id);
    
    // Actualizar entry point si es necesario
    if (_entryPoint?.id == id) {
      _entryPoint = _nodes.values
          .where((n) => n.layer > 0)
          .fold<HNSWNode?>(null, (a, b) => a == null || b.layer > a.layer ? b : a);
    }
    
    return true;
  }
  
  /// Obtiene metadata por ID
  Map<String, dynamic>? getMetadata(String id) {
    return _nodes[id]?.metadata;
  }
  
  /// Número de vectores almacenados
  int get size => _nodes.length;
  
  /// Limpia todo el índice
  void clear() {
    _nodes.clear();
    _embeddingCache.clear();
    _entryPoint = null;
  }
}

/// Nodo en el grafo HNSW
class HNSWNode {
  final String id;
  final List<double> vector;
  final Map<String, dynamic>? metadata;
  int layer = 0;
  final List<List<String>> links;
  
  HNSWNode({
    required this.id,
    required this.vector,
    this.metadata,
    int maxLayers = 8,
  }) : links = List.generate(maxLayers, (_) => []);
}

/// Resultado de búsqueda vectorial
class VectorSearchResult {
  final String id;
  final double distance; // 0-1, donde 1 es idéntico
  final Map<String, dynamic>? metadata;
  
  VectorSearchResult({
    required this.id,
    required this.distance,
    this.metadata,
  });
  
  @override
  String toString() => 'VectorSearchResult(id: $id, distance: ${distance.toStringAsFixed(3)})';
}

/// Extensión para obtener valor de let
extension LetExtension<T> on T {
  R let<R>(R Function(T) block) => block(this);
}
