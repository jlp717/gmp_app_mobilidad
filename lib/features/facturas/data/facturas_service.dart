/// Facturas Data Service
/// =====================
/// API client for invoice operations in commercial profile

import 'dart:convert';
import 'package:flutter/foundation.dart';
import '../../../core/api/api_client.dart';

/// Model for invoice list item
class Factura {
  final String id;
  final String serie;
  final int numero;
  final int ejercicio;
  final String fecha;
  final String clienteId;
  final String clienteNombre;
  final double total;
  final double base;
  final double iva;

  Factura({
    required this.id,
    required this.serie,
    required this.numero,
    required this.ejercicio,
    required this.fecha,
    required this.clienteId,
    required this.clienteNombre,
    required this.total,
    required this.base,
    required this.iva,
  });

  factory Factura.fromJson(Map<String, dynamic> json) {
    return Factura(
      id: json['id']?.toString() ?? '',
      serie: json['serie']?.toString() ?? '',
      numero: json['numero'] is int ? json['numero'] : int.tryParse(json['numero']?.toString() ?? '0') ?? 0,
      ejercicio: json['ejercicio'] is int ? json['ejercicio'] : int.tryParse(json['ejercicio']?.toString() ?? '0') ?? 0,
      fecha: json['fecha']?.toString() ?? '',
      clienteId: json['clienteId']?.toString() ?? '',
      clienteNombre: json['clienteNombre']?.toString() ?? 'Cliente',
      total: (json['total'] is num ? json['total'] : double.tryParse(json['total']?.toString() ?? '0') ?? 0).toDouble(),
      base: (json['base'] is num ? json['base'] : double.tryParse(json['base']?.toString() ?? '0') ?? 0).toDouble(),
      iva: (json['iva'] is num ? json['iva'] : double.tryParse(json['iva']?.toString() ?? '0') ?? 0).toDouble(),
    );
  }

  String get numeroFormateado => '$serie-${numero.toString().padLeft(5, '0')}';
}

/// Model for invoice detail
class FacturaDetail {
  final FacturaHeader header;
  final List<FacturaLine> lines;

  FacturaDetail({required this.header, required this.lines});

  factory FacturaDetail.fromJson(Map<String, dynamic> json) {
    final headerJson = json['header'] as Map<String, dynamic>? ?? {};
    final linesJson = json['lines'] as List? ?? [];
    
    return FacturaDetail(
      header: FacturaHeader.fromJson(headerJson),
      lines: linesJson.map((l) => FacturaLine.fromJson(l)).toList(),
    );
  }
}

class FacturaHeader {
  final String serie;
  final int numero;
  final int ejercicio;
  final String fecha;
  final String clienteId;
  final String clienteNombre;
  final String clienteDireccion;
  final String clientePoblacion;
  final String clienteNif;
  final double total;
  final List<FacturaBase> bases;

  FacturaHeader({
    required this.serie,
    required this.numero,
    required this.ejercicio,
    required this.fecha,
    required this.clienteId,
    required this.clienteNombre,
    required this.clienteDireccion,
    required this.clientePoblacion,
    required this.clienteNif,
    required this.total,
    required this.bases,
  });

  factory FacturaHeader.fromJson(Map<String, dynamic> json) {
    final basesJson = json['bases'] as List? ?? [];
    return FacturaHeader(
      serie: json['serie']?.toString() ?? '',
      numero: json['numero'] is int ? json['numero'] : int.tryParse(json['numero']?.toString() ?? '0') ?? 0,
      ejercicio: json['ejercicio'] is int ? json['ejercicio'] : int.tryParse(json['ejercicio']?.toString() ?? '0') ?? 0,
      fecha: json['fecha']?.toString() ?? '',
      clienteId: json['clienteId']?.toString() ?? '',
      clienteNombre: json['clienteNombre']?.toString() ?? '',
      clienteDireccion: json['clienteDireccion']?.toString() ?? '',
      clientePoblacion: json['clientePoblacion']?.toString() ?? '',
      clienteNif: json['clienteNif']?.toString() ?? '',
      total: (json['total'] is num ? json['total'] : double.tryParse(json['total']?.toString() ?? '0') ?? 0).toDouble(),
      bases: basesJson.map((b) => FacturaBase.fromJson(b)).toList(),
    );
  }

  String get numeroFormateado => '$serie-${numero.toString().padLeft(5, '0')}';
}

class FacturaBase {
  final double base;
  final double pct;
  final double iva;

  FacturaBase({required this.base, required this.pct, required this.iva});

  factory FacturaBase.fromJson(Map<String, dynamic> json) {
    return FacturaBase(
      base: (json['base'] is num ? json['base'] : double.tryParse(json['base']?.toString() ?? '0') ?? 0).toDouble(),
      pct: (json['pct'] is num ? json['pct'] : double.tryParse(json['pct']?.toString() ?? '0') ?? 0).toDouble(),
      iva: (json['iva'] is num ? json['iva'] : double.tryParse(json['iva']?.toString() ?? '0') ?? 0).toDouble(),
    );
  }
}

class FacturaLine {
  final String codigo;
  final String descripcion;
  final double cantidad;
  final double precio;
  final double importe;
  final double descuento;

  FacturaLine({
    required this.codigo,
    required this.descripcion,
    required this.cantidad,
    required this.precio,
    required this.importe,
    required this.descuento,
  });

  factory FacturaLine.fromJson(Map<String, dynamic> json) {
    return FacturaLine(
      codigo: json['codigo']?.toString() ?? '',
      descripcion: json['descripcion']?.toString() ?? '',
      cantidad: (json['cantidad'] is num ? json['cantidad'] : double.tryParse(json['cantidad']?.toString() ?? '0') ?? 0).toDouble(),
      precio: (json['precio'] is num ? json['precio'] : double.tryParse(json['precio']?.toString() ?? '0') ?? 0).toDouble(),
      importe: (json['importe'] is num ? json['importe'] : double.tryParse(json['importe']?.toString() ?? '0') ?? 0).toDouble(),
      descuento: (json['descuento'] is num ? json['descuento'] : double.tryParse(json['descuento']?.toString() ?? '0') ?? 0).toDouble(),
    );
  }
}

/// Summary model
class FacturaSummary {
  final int totalFacturas;
  final double totalImporte;
  final double totalBase;
  final double totalIva;

  FacturaSummary({
    required this.totalFacturas,
    required this.totalImporte,
    required this.totalBase,
    required this.totalIva,
  });

  factory FacturaSummary.fromJson(Map<String, dynamic> json) {
    return FacturaSummary(
      totalFacturas: json['totalFacturas'] is int ? json['totalFacturas'] : int.tryParse(json['totalFacturas']?.toString() ?? '0') ?? 0,
      totalImporte: (json['totalImporte'] is num ? json['totalImporte'] : double.tryParse(json['totalImporte']?.toString() ?? '0') ?? 0).toDouble(),
      totalBase: (json['totalBase'] is num ? json['totalBase'] : double.tryParse(json['totalBase']?.toString() ?? '0') ?? 0).toDouble(),
      totalIva: (json['totalIva'] is num ? json['totalIva'] : double.tryParse(json['totalIva']?.toString() ?? '0') ?? 0).toDouble(),
    );
  }
}

/// Service class for facturas API calls
class FacturasService {
  
  /// Get list of invoices
  static Future<List<Factura>> getFacturas({
    required String vendedorCodes,
    int? year,
    int? month,
    String? search,
    String? clientId,
  }) async {
    try {
      String url = '/facturas?vendedorCodes=$vendedorCodes';
      if (year != null) url += '&year=$year';
      if (month != null) url += '&month=$month';
      if (search != null && search.isNotEmpty) url += '&search=${Uri.encodeComponent(search)}';
      if (clientId != null) url += '&clientId=$clientId';

      final response = await ApiClient.get(url);
      
      if (response['success'] == true && response['facturas'] != null) {
        final List<dynamic> list = response['facturas'];
        return list.map((e) => Factura.fromJson(e)).toList();
      }
      return [];
    } catch (e) {
      debugPrint('Error in getFacturas: $e');
      return [];
    }
  }

  /// Get available years
  static Future<List<int>> getAvailableYears(String vendedorCodes) async {
    try {
      final response = await ApiClient.get('/facturas/years?vendedorCodes=$vendedorCodes');
      
      if (response['success'] == true && response['years'] != null) {
        final List<dynamic> list = response['years'];
        return list.map((e) => e is int ? e : int.tryParse(e.toString()) ?? 0).toList();
      }
      return [DateTime.now().year];
    } catch (e) {
      debugPrint('Error in getAvailableYears: $e');
      return [DateTime.now().year];
    }
  }

  /// Get summary
  static Future<FacturaSummary?> getSummary({
    required String vendedorCodes,
    int? year,
    int? month,
  }) async {
    try {
      String url = '/facturas/summary?vendedorCodes=$vendedorCodes';
      if (year != null) url += '&year=$year';
      if (month != null) url += '&month=$month';

      final response = await ApiClient.get(url);
      
      if (response['success'] == true && response['summary'] != null) {
        return FacturaSummary.fromJson(response['summary']);
      }
      return null;
    } catch (e) {
      debugPrint('Error in getSummary: $e');
      return null;
    }
  }

  /// Get invoice detail
  static Future<FacturaDetail?> getDetail(String serie, int numero, int ejercicio) async {
    try {
      final response = await ApiClient.get('/facturas/$serie/$numero/$ejercicio');
      
      if (response['success'] == true && response['factura'] != null) {
        return FacturaDetail.fromJson(response['factura']);
      }
      return null;
    } catch (e) {
      debugPrint('Error in getDetail: $e');
      return null;
    }
  }

  /// Share via WhatsApp - returns URL to open
  static Future<String?> shareWhatsApp({
    required String serie,
    required int numero,
    required int ejercicio,
    required String telefono,
    String? clienteNombre,
  }) async {
    try {
      final response = await ApiClient.post('/facturas/share/whatsapp', {
        'serie': serie,
        'numero': numero,
        'ejercicio': ejercicio,
        'telefono': telefono,
        'clienteNombre': clienteNombre,
      });
      
      if (response['success'] == true && response['whatsappUrl'] != null) {
        return response['whatsappUrl'];
      }
      return null;
    } catch (e) {
      debugPrint('Error in shareWhatsApp: $e');
      return null;
    }
  }

  /// Share via Email - returns mailto URL
  static Future<String?> shareEmail({
    required String serie,
    required int numero,
    required int ejercicio,
    required String destinatario,
    String? clienteNombre,
  }) async {
    try {
      final response = await ApiClient.post('/facturas/share/email', {
        'serie': serie,
        'numero': numero,
        'ejercicio': ejercicio,
        'destinatario': destinatario,
        'clienteNombre': clienteNombre,
      });
      
      if (response['success'] == true && response['mailtoUrl'] != null) {
        return response['mailtoUrl'];
      }
      return null;
    } catch (e) {
      debugPrint('Error in shareEmail: $e');
      return null;
    }
  }
}
