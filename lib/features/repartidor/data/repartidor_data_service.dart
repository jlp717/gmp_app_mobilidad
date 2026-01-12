/// REPARTIDOR DATA SERVICE
/// Cliente de API para obtener datos de cobros, comisiones e histórico desde backend
/// Sustituye los datos mock por llamadas reales a DB2

import '../../../../core/api/api_client.dart';

/// Resultado del resumen de cobros
class CollectionsSummary {
  final String repartidorId;
  final int year;
  final int month;
  final double totalCollectable;
  final double totalCollected;
  final double totalCommission;
  final double overallPercentage;
  final bool thresholdMet;
  final int clientCount;
  final List<ClientCollectionData> clients;

  CollectionsSummary({
    required this.repartidorId,
    required this.year,
    required this.month,
    required this.totalCollectable,
    required this.totalCollected,
    required this.totalCommission,
    required this.overallPercentage,
    required this.thresholdMet,
    required this.clientCount,
    required this.clients,
  });

  factory CollectionsSummary.fromJson(Map<String, dynamic> json) {
    final summary = json['summary'] as Map<String, dynamic>;
    final clientsList = (json['clients'] as List? ?? [])
        .map((c) => ClientCollectionData.fromJson(c))
        .toList();
    
    return CollectionsSummary(
      repartidorId: json['repartidorId'] ?? '',
      year: json['period']?['year'] ?? DateTime.now().year,
      month: json['period']?['month'] ?? DateTime.now().month,
      totalCollectable: (summary['totalCollectable'] ?? 0).toDouble(),
      totalCollected: (summary['totalCollected'] ?? 0).toDouble(),
      totalCommission: (summary['totalCommission'] ?? 0).toDouble(),
      overallPercentage: (summary['overallPercentage'] ?? 0).toDouble(),
      thresholdMet: summary['thresholdMet'] ?? false,
      clientCount: summary['clientCount'] ?? 0,
      clients: clientsList,
    );
  }
}

/// Datos de cobranza por cliente
class ClientCollectionData {
  final String clientId;
  final String clientName;
  final double collectable;
  final double collected;
  final double percentage;
  final bool thresholdMet;
  final double thresholdProgress;
  final double commission;
  final int tier;
  final String paymentType;
  final int numDocuments;

  ClientCollectionData({
    required this.clientId,
    required this.clientName,
    required this.collectable,
    required this.collected,
    required this.percentage,
    required this.thresholdMet,
    required this.thresholdProgress,
    required this.commission,
    required this.tier,
    required this.paymentType,
    required this.numDocuments,
  });

  factory ClientCollectionData.fromJson(Map<String, dynamic> json) {
    return ClientCollectionData(
      clientId: json['clientId'] ?? '',
      clientName: json['clientName'] ?? json['clientId'] ?? '',
      collectable: (json['collectable'] ?? 0).toDouble(),
      collected: (json['collected'] ?? 0).toDouble(),
      percentage: (json['percentage'] ?? 0).toDouble(),
      thresholdMet: json['thresholdMet'] ?? false,
      thresholdProgress: (json['thresholdProgress'] ?? 0).toDouble(),
      commission: (json['commission'] ?? 0).toDouble(),
      tier: json['tier'] ?? 0,
      paymentType: json['paymentType'] ?? 'Otro',
      numDocuments: json['numDocuments'] ?? 0,
    );
  }
}

/// Acumulado diario
class DailyCollection {
  final int day;
  final String date;
  final double collectable;
  final double collected;

  DailyCollection({
    required this.day,
    required this.date,
    required this.collectable,
    required this.collected,
  });

  factory DailyCollection.fromJson(Map<String, dynamic> json) {
    return DailyCollection(
      day: json['day'] ?? 0,
      date: json['date'] ?? '',
      collectable: (json['collectable'] ?? 0).toDouble(),
      collected: (json['collected'] ?? 0).toDouble(),
    );
  }
}

/// Cliente del historial
class HistoryClient {
  final String id;
  final String name;
  final String address;
  final int totalDocuments;

  HistoryClient({
    required this.id,
    required this.name,
    required this.address,
    required this.totalDocuments,
  });

  factory HistoryClient.fromJson(Map<String, dynamic> json) {
    return HistoryClient(
      id: json['id'] ?? '',
      name: json['name'] ?? json['id'] ?? '',
      address: json['address'] ?? '',
      totalDocuments: json['totalDocuments'] ?? 0,
    );
  }
}

/// Documento del historial
class HistoryDocument {
  final String id;
  final String type; // 'albaran' o 'factura'
  final int number;
  final String date;
  final double amount;
  final double pending;
  final String status; // 'delivered', 'partial', 'notDelivered'
  final bool hasSignature;

  HistoryDocument({
    required this.id,
    required this.type,
    required this.number,
    required this.date,
    required this.amount,
    required this.pending,
    required this.status,
    required this.hasSignature,
  });

  factory HistoryDocument.fromJson(Map<String, dynamic> json) {
    return HistoryDocument(
      id: json['id'] ?? '',
      type: json['type'] ?? 'albaran',
      number: json['number'] ?? 0,
      date: json['date'] ?? '',
      amount: (json['amount'] ?? 0).toDouble(),
      pending: (json['pending'] ?? 0).toDouble(),
      status: json['status'] ?? 'notDelivered',
      hasSignature: json['hasSignature'] ?? false,
    );
  }
}

/// Objetivo mensual
class MonthlyObjective {
  final String month;
  final int year;
  final int monthNum;
  final double collectable;
  final double collected;
  final double percentage;
  final bool thresholdMet;

  MonthlyObjective({
    required this.month,
    required this.year,
    required this.monthNum,
    required this.collectable,
    required this.collected,
    required this.percentage,
    required this.thresholdMet,
  });

  factory MonthlyObjective.fromJson(Map<String, dynamic> json) {
    return MonthlyObjective(
      month: json['month'] ?? '',
      year: json['year'] ?? DateTime.now().year,
      monthNum: json['monthNum'] ?? 1,
      collectable: (json['collectable'] ?? 0).toDouble(),
      collected: (json['collected'] ?? 0).toDouble(),
      percentage: (json['percentage'] ?? 0).toDouble(),
      thresholdMet: json['thresholdMet'] ?? false,
    );
  }
}

/// Servicio de datos para repartidor
class RepartidorDataService {
  
  /// Obtener resumen de cobros/comisiones del mes
  static Future<CollectionsSummary> getCollectionsSummary({
    required String repartidorId,
    int? year,
    int? month,
  }) async {
    try {
      final queryParams = <String, String>{};
      if (year != null) queryParams['year'] = year.toString();
      if (month != null) queryParams['month'] = month.toString();
      
      final response = await ApiClient.get(
        '/repartidor/collections/summary/$repartidorId',
        queryParameters: queryParams,
      );
      
      return CollectionsSummary.fromJson(response);
    } catch (e) {
      throw Exception('Error cargando resumen de cobros: $e');
    }
  }

  /// Obtener acumulado diario
  static Future<List<DailyCollection>> getDailyCollections({
    required String repartidorId,
    int? year,
    int? month,
  }) async {
    try {
      final queryParams = <String, String>{};
      if (year != null) queryParams['year'] = year.toString();
      if (month != null) queryParams['month'] = month.toString();
      
      final response = await ApiClient.get(
        '/repartidor/collections/daily/$repartidorId',
        queryParameters: queryParams,
      );
      
      final dailyList = (response['daily'] as List? ?? [])
          .map((d) => DailyCollection.fromJson(d))
          .toList();
          
      return dailyList;
    } catch (e) {
      throw Exception('Error cargando acumulado diario: $e');
    }
  }

  /// Obtener lista de clientes atendidos
  static Future<List<HistoryClient>> getHistoryClients({
    required String repartidorId,
    String? search,
  }) async {
    try {
      final queryParams = <String, String>{};
      if (search != null && search.isNotEmpty) {
        queryParams['search'] = search;
      }
      
      final response = await ApiClient.get(
        '/repartidor/history/clients/$repartidorId',
        queryParameters: queryParams,
      );
      
      final clients = (response['clients'] as List? ?? [])
          .map((c) => HistoryClient.fromJson(c))
          .toList();
          
      return clients;
    } catch (e) {
      throw Exception('Error cargando clientes: $e');
    }
  }

  /// Obtener documentos de un cliente
  static Future<List<HistoryDocument>> getClientDocuments({
    required String clientId,
    String? repartidorId,
  }) async {
    try {
      final queryParams = <String, String>{};
      if (repartidorId != null) {
        queryParams['repartidorId'] = repartidorId;
      }
      
      final response = await ApiClient.get(
        '/repartidor/history/documents/$clientId',
        queryParameters: queryParams,
      );
      
      final docs = (response['documents'] as List? ?? [])
          .map((d) => HistoryDocument.fromJson(d))
          .toList();
          
      return docs;
    } catch (e) {
      throw Exception('Error cargando documentos: $e');
    }
  }

  /// Obtener objetivos mensuales (30% tracking)
  static Future<List<MonthlyObjective>> getMonthlyObjectives({
    required String repartidorId,
    String? clientId,
  }) async {
    try {
      final queryParams = <String, String>{};
      if (clientId != null) {
        queryParams['clientId'] = clientId;
      }
      
      final response = await ApiClient.get(
        '/repartidor/history/objectives/$repartidorId',
        queryParameters: queryParams,
      );
      
      final objectives = (response['objectives'] as List? ?? [])
          .map((o) => MonthlyObjective.fromJson(o))
          .toList();
          
      return objectives;
    } catch (e) {
      throw Exception('Error cargando objetivos: $e');
    }
  }
}
