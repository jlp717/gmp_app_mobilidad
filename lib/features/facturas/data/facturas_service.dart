/// Facturas Data Service
/// =====================
/// API client for invoice operations in commercial profile
/// OPTIMIZED: Full caching support with memory + disk layers

import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import '../../../core/api/api_client.dart';
import '../../../core/cache/cache_service.dart';
import 'package:printing/printing.dart';

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
    final double serverTotal = (json['total'] is num ? (json['total'] as num).toDouble() : double.tryParse(json['total']?.toString() ?? '0') ?? 0.0);
    final double base = (json['base'] is num ? (json['base'] as num).toDouble() : double.tryParse(json['base']?.toString() ?? '0') ?? 0.0);
    final double iva = (json['iva'] is num ? (json['iva'] as num).toDouble() : double.tryParse(json['iva']?.toString() ?? '0') ?? 0.0);
    
    // SENIOR MATH LOGIC: If total != base + iva, trust the sum if the difference is significant
    // but also consider multi-base invoices where the list only shows one base.
    // However, the user complained about a specific case (A-868) where 147.45 + 14.75 != 249.10.
    // If (base + iva) accurately reflects the invoice, we should show it.
    // For now, if serverTotal is much larger and base/iva are small, it might be missing other bases.
    // But if they are the ONLY things shown, it's confusing.
    // RULE: If total is not base+iva, we prioritize the sum if base+iva > 0.
    double finalTotal = serverTotal;
    if (base > 0 && (base + iva - serverTotal).abs() > 0.05) {
       // Only override if the server total seems completely disconnected from the base shown
       finalTotal = base + iva;
    }

    return Factura(
      id: json['id']?.toString() ?? '',
      serie: json['serie']?.toString() ?? '',
      numero: json['numero'] is int ? (json['numero'] as int) : int.tryParse(json['numero']?.toString() ?? '0') ?? 0,
      ejercicio: json['ejercicio'] is int ? (json['ejercicio'] as int) : int.tryParse(json['ejercicio']?.toString() ?? '0') ?? 0,
      fecha: json['fecha']?.toString() ?? '',
      clienteId: json['clienteId']?.toString() ?? '',
      clienteNombre: json['clienteNombre']?.toString() ?? 'Cliente',
      total: finalTotal,
      base: base,
      iva: iva,
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
      numero: json['numero'] is int ? (json['numero'] as int) : int.tryParse(json['numero']?.toString() ?? '0') ?? 0,
      ejercicio: json['ejercicio'] is int ? (json['ejercicio'] as int) : int.tryParse(json['ejercicio']?.toString() ?? '0') ?? 0,
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
      base: (json['base'] is num ? (json['base'] as num).toDouble() : double.tryParse(json['base']?.toString() ?? '0') ?? 0).toDouble(),
      pct: (json['pct'] is num ? (json['pct'] as num).toDouble() : double.tryParse(json['pct']?.toString() ?? '0') ?? 0).toDouble(),
      iva: (json['iva'] is num ? (json['iva'] as num).toDouble() : double.tryParse(json['iva']?.toString() ?? '0') ?? 0).toDouble(),
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
      cantidad: (json['cantidad'] is num ? (json['cantidad'] as num).toDouble() : double.tryParse(json['cantidad']?.toString() ?? '0') ?? 0).toDouble(),
      precio: (json['precio'] is num ? (json['precio'] as num).toDouble() : double.tryParse(json['precio']?.toString() ?? '0') ?? 0).toDouble(),
      importe: (json['importe'] is num ? (json['importe'] as num).toDouble() : double.tryParse(json['importe']?.toString() ?? '0') ?? 0).toDouble(),
      descuento: (json['descuento'] is num ? (json['descuento'] as num).toDouble() : double.tryParse(json['descuento']?.toString() ?? '0') ?? 0).toDouble(),
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
      totalFacturas: json['totalFacturas'] is int ? (json['totalFacturas'] as int) : int.tryParse(json['totalFacturas']?.toString() ?? '0') ?? 0,
      totalImporte: (json['totalImporte'] is num ? (json['totalImporte'] as num).toDouble() : double.tryParse(json['totalImporte']?.toString() ?? '0') ?? 0).toDouble(),
      totalBase: (json['totalBase'] is num ? (json['totalBase'] as num).toDouble() : double.tryParse(json['totalBase']?.toString() ?? '0') ?? 0).toDouble(),
      totalIva: (json['totalIva'] is num ? (json['totalIva'] as num).toDouble() : double.tryParse(json['totalIva']?.toString() ?? '0') ?? 0).toDouble(),
    );
  }
}

/// Service class for facturas API calls
class FacturasService {
  
  /// Get list of invoices
  /// Get list of invoices
  /// Get list of invoices
  static Future<List<Factura>> getFacturas({
    required String vendedorCodes,
    int? year,
    int? month,
    String? search,
    String? clientId,
    String? clientSearch,
    String? docSearch,
    String? dateFrom,
    String? dateTo,
  }) async {
    try {
      String url = '/facturas?vendedorCodes=$vendedorCodes';
      // Prioritize Date Range in URL if present
      if (dateFrom != null && dateTo != null) {
        url += '&dateFrom=$dateFrom&dateTo=$dateTo';
      } else {
        if (year != null) url += '&year=$year';
        if (month != null) url += '&month=$month';
      }
      
      if (search != null && search.isNotEmpty) url += '&search=${Uri.encodeComponent(search)}';
      if (clientId != null) url += '&clientId=$clientId';
      if (clientSearch != null && clientSearch.isNotEmpty) url += '&clientSearch=${Uri.encodeComponent(clientSearch)}';
      if (docSearch != null && docSearch.isNotEmpty) url += '&docSearch=${Uri.encodeComponent(docSearch)}';

      final cacheKey = 'facturas_${vendedorCodes}_${year ?? 'all'}_${month ?? 'all'}_${dateFrom ?? ''}_${dateTo ?? ''}_${clientSearch ?? ''}_${docSearch ?? ''}';
      
      final response = await ApiClient.get(
        url,
        cacheKey: cacheKey,
        cacheTTL: CacheService.shortTTL, 
      );
      
      if (response['success'] == true && response['facturas'] != null) {
        final List<dynamic> list = response['facturas'] as List<dynamic>;
        var facturas = list.map((e) => Factura.fromJson(e)).toList();

        // ---------------------------------------------------------
        // SENIOR FIX: Strict Client-Side Filtering (v9.3)
        // ---------------------------------------------------------
        
        // Scenario A: Date Range Filter (Prioritized)
        if (dateFrom != null && dateTo != null) {
           try {
              // Parse params (yyyy-MM-dd)
              final start = DateTime.parse(dateFrom); 
              // End date inclusive: 2025-01-01 -> 2025-01-01 23:59:59
              final end = DateTime.parse(dateTo).add(const Duration(days: 1)).subtract(const Duration(milliseconds: 1)); 
              
              facturas = facturas.where((f) {
                if (f.fecha.isEmpty) return false;
                DateTime? valDate;
                
                // 1. Try ISO
                try { valDate = DateTime.parse(f.fecha); } catch (_) {}
                
                // 2. Try European (dd/MM/yyyy)
                if (valDate == null && f.fecha.contains('/')) {
                   final parts = f.fecha.split('/');
                   if (parts.length == 3) {
                      valDate = DateTime(
                        int.parse(parts[2]), // year
                        int.parse(parts[1]), // month
                        int.parse(parts[0]), // day
                      );
                   }
                }
                
                if (valDate == null) return false; // invalid date = hidden
                
                // Inclusive check
                return valDate.isAfter(start.subtract(const Duration(milliseconds: 1))) && 
                       valDate.isBefore(end.add(const Duration(milliseconds: 1)));
              }).toList();
           } catch (e) {
             debugPrint('Error filtering range: $e');
           }
        } 
        // Scenario B: Year Filter (Strict)
        else if (year != null) {
           facturas = facturas.where((f) {
              // 1. Check 'ejercicio' field (Fast & Reliable)
              if (f.ejercicio != 0) {
                 return f.ejercicio == year;
              }
              
              // 2. Fallback: Check date string if ejercicio is 0
              if (f.fecha.isNotEmpty) {
                 if (f.fecha.contains('/')) {
                    final parts = f.fecha.split('/');
                    if (parts.length == 3) {
                       return int.tryParse(parts[2]) == year;
                    }
                 } else if (f.fecha.contains('-')) {
                    return DateTime.tryParse(f.fecha)?.year == year;
                 }
              }
              
              return false; // Safest default: hide if unknown
           }).toList();
           
           debugPrint('[FacturasService] Year $year Filter: Keeping ${facturas.length} results');
        }

        return facturas;
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
      // Years rarely change - cache for 1 hour
      final cacheKey = 'facturas_years_$vendedorCodes';
      
      final response = await ApiClient.get(
        '/facturas/years?vendedorCodes=$vendedorCodes',
        cacheKey: cacheKey,
        cacheTTL: CacheService.longTTL, // 24 hours - years don't change often
      );
      
      if (response['success'] == true && response['years'] != null) {
        final List<dynamic> list = response['years'] as List<dynamic>;
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
    String? search,
    String? clientId,
    String? clientSearch,
    String? docSearch,
    String? dateFrom,
    String? dateTo,
  }) async {
    try {
      String url = '/facturas/summary?vendedorCodes=$vendedorCodes';
      if (dateFrom != null && dateTo != null) {
        url += '&dateFrom=$dateFrom&dateTo=$dateTo';
      } else {
        if (year != null) url += '&year=$year';
        if (month != null) url += '&month=$month';
      }
      
      if (search != null && search.isNotEmpty) url += '&search=${Uri.encodeComponent(search)}';
      if (clientId != null) url += '&clientId=$clientId';
      if (clientSearch != null && clientSearch.isNotEmpty) url += '&clientSearch=${Uri.encodeComponent(clientSearch)}';
      if (docSearch != null && docSearch.isNotEmpty) url += '&docSearch=${Uri.encodeComponent(docSearch)}';

      // Cache summary with same key pattern as list
      final cacheKey = 'facturas_summary_${vendedorCodes}_${year ?? 'all'}_${month ?? 'all'}_${dateFrom ?? ''}_${dateTo ?? ''}';
      
      final response = await ApiClient.get(
        url,
        cacheKey: cacheKey,
        cacheTTL: CacheService.shortTTL, // 5 minutes
      );
      
      if (response['success'] == true && response['summary'] != null) {
        return FacturaSummary.fromJson(response['summary'] as Map<String, dynamic>);
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
        return FacturaDetail.fromJson(response['factura'] as Map<String, dynamic>);
      }
      return null;
    } catch (e) {
      debugPrint('Error in getDetail: $e');
      return null;
    }
  }

  /// Preview PDF (uses Printing package as viewer)
  static Future<void> previewFacturaPdf(String serie, int numero, int ejercicio) async {
    try {
      final file = await downloadFacturaPdf(serie, numero, ejercicio);
      final bytes = await file.readAsBytes();
      
      // Use Printing package to "print" which opens a system preview
      // This is the cleanest way to view a PDF and offers a print option
      await Printing.layoutPdf(
        onLayout: (_) => bytes,
        name: 'Factura_${serie}_${numero}_$ejercicio',
      );
    } catch (e) {
      debugPrint('Error previewing PDF: $e');
      rethrow;
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
        return response['whatsappUrl'] as String?;
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
        return response['mailtoUrl'] as String?;
      }
      return null;
    } catch (e) {
      debugPrint('Error in shareEmail: $e');
      return null;
    }
  }

  /// Download PDF
  static Future<File> downloadFacturaPdf(String serie, int numero, int ejercicio) async {
    try {
      // Use ApiClient to get bytes directly - authentication is handled automatically
      final bytes = await ApiClient.getBytes('/facturas/$serie/$numero/$ejercicio/pdf');

      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/Factura_${serie}_${numero}_${ejercicio}.pdf');
      await file.writeAsBytes(bytes);
      return file;
    } catch (e) {
      debugPrint('Error downloading PDF: $e');
      rethrow;
    }
  }
}
