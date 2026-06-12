/// Facturas Data Service
/// =====================
/// API client for invoice operations in commercial profile
/// OPTIMIZED: Full caching support with memory + disk layers
library;

import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/core/offline/offline_aware_api.dart';
import 'package:path_provider/path_provider.dart';
import 'package:printing/printing.dart';

/// Model for invoice list item
class Factura {
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
    this.nombreComercial,
    this.nombreFiscal,
  });

  factory Factura.fromJson(Map<String, dynamic> json) {
    final serverTotal = (json['total'] is num
        ? (json['total'] as num).toDouble()
        : double.tryParse(json['total']?.toString() ?? '0') ?? 0.0);
    final base = (json['base'] is num
        ? (json['base'] as num).toDouble()
        : double.tryParse(json['base']?.toString() ?? '0') ?? 0.0);
    final iva = (json['iva'] is num
        ? (json['iva'] as num).toDouble()
        : double.tryParse(json['iva']?.toString() ?? '0') ?? 0.0);
    // We trust the total from the server since multi-base invoices
    // might not expose all bases in the list view.
    final finalTotal = serverTotal;
    final displayName = json['clienteNombre']?.toString() ?? 'Cliente';
    final comercial = json['nombreComercial']?.toString() ?? displayName;
    final fiscal = json['nombreFiscal']?.toString() ?? '';

    return Factura(
      id: json['id']?.toString() ?? '',
      serie: json['serie']?.toString() ?? '',
      numero: json['numero'] is int
          ? (json['numero'] as int)
          : int.tryParse(json['numero']?.toString() ?? '0') ?? 0,
      ejercicio: json['ejercicio'] is int
          ? (json['ejercicio'] as int)
          : int.tryParse(json['ejercicio']?.toString() ?? '0') ?? 0,
      fecha: json['fecha']?.toString() ?? '',
      clienteId: json['clienteId']?.toString() ?? '',
      clienteNombre: displayName,
      nombreComercial: comercial,
      nombreFiscal: fiscal,
      total: finalTotal,
      base: base,
      iva: iva,
    );
  }
  final String id;
  final String serie;
  final int numero;
  final int ejercicio;
  final String fecha;
  final String clienteId;
  final String clienteNombre;
  final String? nombreComercial;
  final String? nombreFiscal;
  final double total;
  final double base;
  final double iva;

  String get numeroFormateado => '$serie-${numero.toString().padLeft(5, '0')}';
}

/// Model for invoice detail
class FacturaDetail {
  FacturaDetail({required this.header, required this.lines});

  factory FacturaDetail.fromJson(Map<String, dynamic> json) {
    final headerJson = json['header'] as Map<String, dynamic>? ?? {};
    final linesJson = json['lines'] as List? ?? [];

    return FacturaDetail(
      header: FacturaHeader.fromJson(headerJson),
      lines: linesJson
          .map((l) => FacturaLine.fromJson(l as Map<String, dynamic>))
          .toList(),
    );
  }
  final FacturaHeader header;
  final List<FacturaLine> lines;
}

class FacturaHeader {
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
    this.nombreComercial,
    this.nombreFiscal,
  });

  factory FacturaHeader.fromJson(Map<String, dynamic> json) {
    final basesJson = json['bases'] as List? ?? [];
    final displayName = json['clienteNombre']?.toString() ?? '';
    final comercial = json['nombreComercial']?.toString() ?? displayName;
    final fiscal = json['nombreFiscal']?.toString() ?? '';
    return FacturaHeader(
      serie: json['serie']?.toString() ?? '',
      numero: json['numero'] is int
          ? (json['numero'] as int)
          : int.tryParse(json['numero']?.toString() ?? '0') ?? 0,
      ejercicio: json['ejercicio'] is int
          ? (json['ejercicio'] as int)
          : int.tryParse(json['ejercicio']?.toString() ?? '0') ?? 0,
      fecha: json['fecha']?.toString() ?? '',
      clienteId: json['clienteId']?.toString() ?? '',
      clienteNombre: displayName,
      nombreComercial: comercial,
      nombreFiscal: fiscal,
      clienteDireccion: json['clienteDireccion']?.toString() ?? '',
      clientePoblacion: json['clientePoblacion']?.toString() ?? '',
      clienteNif: json['clienteNif']?.toString() ?? '',
      total: (json['total'] is num
              ? (json['total'] as num)
              : double.tryParse(json['total']?.toString() ?? '0') ?? 0)
          .toDouble(),
      bases: basesJson
          .map((b) => FacturaBase.fromJson(b as Map<String, dynamic>))
          .toList(),
    );
  }
  final String serie;
  final int numero;
  final int ejercicio;
  final String fecha;
  final String clienteId;
  final String clienteNombre;
  final String? nombreComercial;
  final String? nombreFiscal;
  final String clienteDireccion;
  final String clientePoblacion;
  final String clienteNif;
  final double total;
  final List<FacturaBase> bases;

  String get numeroFormateado => '$serie-${numero.toString().padLeft(5, '0')}';
}

class FacturaBase {
  FacturaBase({required this.base, required this.pct, required this.iva});

  factory FacturaBase.fromJson(Map<String, dynamic> json) {
    return FacturaBase(
      base: (json['base'] is num
          ? (json['base'] as num).toDouble()
          : double.tryParse(json['base']?.toString() ?? '0') ?? 0),
      pct: (json['pct'] is num
          ? (json['pct'] as num).toDouble()
          : double.tryParse(json['pct']?.toString() ?? '0') ?? 0),
      iva: (json['iva'] is num
          ? (json['iva'] as num).toDouble()
          : double.tryParse(json['iva']?.toString() ?? '0') ?? 0),
    );
  }
  final double base;
  final double pct;
  final double iva;
}

class FacturaLine {
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
      cantidad: (json['cantidad'] is num
          ? (json['cantidad'] as num).toDouble()
          : double.tryParse(json['cantidad']?.toString() ?? '0') ?? 0),
      precio: (json['precio'] is num
          ? (json['precio'] as num).toDouble()
          : double.tryParse(json['precio']?.toString() ?? '0') ?? 0),
      importe: (json['importe'] is num
          ? (json['importe'] as num).toDouble()
          : double.tryParse(json['importe']?.toString() ?? '0') ?? 0),
      descuento: (json['descuento'] is num
          ? (json['descuento'] as num).toDouble()
          : double.tryParse(json['descuento']?.toString() ?? '0') ?? 0),
    );
  }
  final String codigo;
  final String descripcion;
  final double cantidad;
  final double precio;
  final double importe;
  final double descuento;
}

/// Summary model
class FacturaSummary {
  FacturaSummary({
    required this.totalFacturas,
    required this.totalImporte,
    required this.totalBase,
    required this.totalIva,
  });

  factory FacturaSummary.fromJson(Map<String, dynamic> json) {
    return FacturaSummary(
      totalFacturas: json['totalFacturas'] is int
          ? (json['totalFacturas'] as int)
          : int.tryParse(json['totalFacturas']?.toString() ?? '0') ?? 0,
      totalImporte: (json['totalImporte'] is num
          ? (json['totalImporte'] as num).toDouble()
          : double.tryParse(json['totalImporte']?.toString() ?? '0') ?? 0),
      totalBase: (json['totalBase'] is num
          ? (json['totalBase'] as num).toDouble()
          : double.tryParse(json['totalBase']?.toString() ?? '0') ?? 0),
      totalIva: (json['totalIva'] is num
          ? (json['totalIva'] as num).toDouble()
          : double.tryParse(json['totalIva']?.toString() ?? '0') ?? 0),
    );
  }
  final int totalFacturas;
  final double totalImporte;
  final double totalBase;
  final double totalIva;
}

/// Service class for facturas API calls
class FacturasService {
  static DateTime? _parseFacturaDate(String value) {
    if (value.isEmpty) return null;

    final isoDate = DateTime.tryParse(value);
    if (isoDate != null) return isoDate;

    if (!value.contains('/')) return null;
    final parts = value.split('/');
    if (parts.length != 3) return null;

    final day = int.tryParse(parts[0]);
    final month = int.tryParse(parts[1]);
    final year = int.tryParse(parts[2]);
    if (day == null || month == null || year == null) return null;
    if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31)
      return null;

    final parsed = DateTime(year, month, day);
    if (parsed.year != year || parsed.month != month || parsed.day != day)
      return null;
    return parsed;
  }

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
    int limit = 250,
    int offset = 0,
  }) async {
    try {
      var url = '/facturas?vendedorCodes=$vendedorCodes';
      // Prioritize Date Range in URL if present
      if (dateFrom != null && dateTo != null) {
        url += '&dateFrom=$dateFrom&dateTo=$dateTo';
      } else {
        if (year != null) url += '&year=$year';
        if (month != null) url += '&month=$month';
      }
      if (search != null && search.isNotEmpty) {
        url += '&search=${Uri.encodeComponent(search)}';
      }
      if (clientId != null) url += '&clientId=$clientId';
      if (clientSearch != null && clientSearch.isNotEmpty) {
        url += '&clientSearch=${Uri.encodeComponent(clientSearch)}';
      }
      if (docSearch != null && docSearch.isNotEmpty) {
        url += '&docSearch=${Uri.encodeComponent(docSearch)}';
      }
      url += '&limit=$limit&offset=$offset';

      final cacheKey = [
        'facturas',
        vendedorCodes,
        year ?? 'all',
        month ?? 'all',
        dateFrom ?? '',
        dateTo ?? '',
        clientSearch ?? '',
        docSearch ?? '',
        limit,
        offset,
      ].join('_');

      final response = await ApiClient.get(
        url,
        cacheKey: cacheKey,
        cacheTTL: CacheService.shortTTL,
      );

      if (response['success'] == true && response['facturas'] != null) {
        final list = response['facturas'] as List<dynamic>;
        var facturas = list
            .map((e) => Factura.fromJson(e as Map<String, dynamic>))
            .toList();

        // Scenario A: Date Range Filter (Prioritized)
        if (dateFrom != null && dateTo != null) {
          try {
            final start = DateTime.parse(dateFrom);
            final end = DateTime.parse(dateTo)
                .add(const Duration(days: 1))
                .subtract(const Duration(milliseconds: 1));

            facturas = facturas.where((f) {
              final valDate = _parseFacturaDate(f.fecha);
              if (valDate == null) return false;

              return valDate.isAfter(
                      start.subtract(const Duration(milliseconds: 1))) &&
                  valDate.isBefore(end.add(const Duration(milliseconds: 1)));
            }).toList();
          } catch (e) {
            debugPrint('Error filtering range: $e');
          }
        }
        // Scenario B: Year Filter (Strict)
        else if (year != null) {
          debugPrint(
            '[FACTURAS_SERVICE] Filtering by Year: $year. Input Items: ${facturas.length}',
          );
          final originalCount = facturas.length;

          facturas = facturas.where((f) {
            if (f.ejercicio != 0) {
              return f.ejercicio == year;
            }

            final docYear = _parseFacturaDate(f.fecha)?.year;
            return docYear == year;
          }).toList();

          debugPrint(
            '[FACTURAS_SERVICE] After Year Filter: ${facturas.length} '
            '(Filtered out ${originalCount - facturas.length})',
          );
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
        final list = response['years'] as List<dynamic>;
        return list
            .map((e) => e is int ? e : int.tryParse(e.toString()) ?? 0)
            .toList();
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
      var url = '/facturas/summary?vendedorCodes=$vendedorCodes';
      if (dateFrom != null && dateTo != null) {
        url += '&dateFrom=$dateFrom&dateTo=$dateTo';
      } else {
        if (year != null) url += '&year=$year';
        if (month != null) url += '&month=$month';
      }

      if (search != null && search.isNotEmpty)
        url += '&search=${Uri.encodeComponent(search)}';
      if (clientId != null) url += '&clientId=$clientId';
      if (clientSearch != null && clientSearch.isNotEmpty)
        url += '&clientSearch=${Uri.encodeComponent(clientSearch)}';
      if (docSearch != null && docSearch.isNotEmpty)
        url += '&docSearch=${Uri.encodeComponent(docSearch)}';

      // Cache summary with same key pattern as list
      final cacheKey =
          'facturas_summary_${vendedorCodes}_${year ?? 'all'}_${month ?? 'all'}_${dateFrom ?? ''}_${dateTo ?? ''}';

      final response = await ApiClient.get(
        url,
        cacheKey: cacheKey,
        cacheTTL: CacheService.shortTTL, // 5 minutes
      );

      if (response['success'] == true && response['summary'] != null) {
        return FacturaSummary.fromJson(
            response['summary'] as Map<String, dynamic>);
      }
      return null;
    } catch (e) {
      debugPrint('Error in getSummary: $e');
      return null;
    }
  }

  /// Get invoice detail
  static Future<FacturaDetail?> getDetail(
      String serie, int numero, int ejercicio) async {
    try {
      final response = await ApiClient.get(
        '/facturas/$serie/$numero/$ejercicio',
        cacheKey: 'facturas_detail_${serie}_${numero}_$ejercicio',
        cacheTTL: CacheService.defaultTTL,
      );

      if (response['success'] == true && response['factura'] != null) {
        return FacturaDetail.fromJson(
            response['factura'] as Map<String, dynamic>);
      }
      return null;
    } catch (e) {
      debugPrint('Error in getDetail: $e');
      return null;
    }
  }

  /// Preview PDF (uses Printing package as viewer)
  static Future<void> previewFacturaPdf(
      String serie, int numero, int ejercicio) async {
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
  static Future<File> downloadFacturaPdf(
      String serie, int numero, int ejercicio) async {
    try {
      // Use ApiClient to get bytes directly - authentication is handled automatically
      // FIX: Add timestamp to bust Dio HTTP cache on repeated downloads
      final ts = DateTime.now().millisecondsSinceEpoch;
      final bytes = await ApiClient.getBytes(
          '/facturas/$serie/$numero/$ejercicio/pdf?_t=$ts');

      final dir = await getTemporaryDirectory();
      final file =
          File('${dir.path}/Factura_${serie}_${numero}_$ejercicio.pdf');
      await file.writeAsBytes(bytes);
      return file;
    } catch (e) {
      debugPrint('Error downloading PDF: $e');
      rethrow;
    }
  }

  /// Download PDF as raw bytes (for in-app preview)
  static Future<List<int>> downloadFacturaPdfBytes(
      String serie, int numero, int ejercicio) async {
    try {
      // FIX: Add timestamp to bust Dio HTTP cache — without this, second request
      // returns cached response and PDF appears blank/corrupted on re-open
      final ts = DateTime.now().millisecondsSinceEpoch;
      final bytes = await ApiClient.getBytes(
          '/facturas/$serie/$numero/$ejercicio/pdf?preview=true&_t=$ts');
      return bytes;
    } catch (e) {
      debugPrint('Error downloading PDF bytes: $e');
      rethrow;
    }
  }

  /// Send email server-side with PDF attachment (Nodemailer)
  static Future<Map<String, dynamic>> sendEmailServerSide({
    required String serie,
    required int numero,
    required int ejercicio,
    required String destinatario,
    String? asunto,
    String? cuerpo,
    String? clienteNombre,
  }) async {
    try {
      final response = await ApiClient.post('/facturas/send-email', {
        'serie': serie,
        'numero': numero,
        'ejercicio': ejercicio,
        'destinatario': destinatario,
        'asunto': asunto,
        'cuerpo': cuerpo,
        'clienteNombre': clienteNombre,
      });

      if (response['success'] == true) {
        return response;
      }
      throw Exception(response['error'] ?? 'Error enviando email');
    } catch (e) {
      debugPrint('Error in sendEmailServerSide: $e');
      rethrow;
    }
  }
}
