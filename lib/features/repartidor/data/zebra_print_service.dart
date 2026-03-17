import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bluetooth_printer/flutter_bluetooth_printer.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';

/// Service for printing delivery notes on Zebra ZQ520
/// via Bluetooth Classic (SPP/RFCOMM) using raw ZPL commands.
class ZebraPrintService {
  static const String _prefKey = 'repartidor_tiene_impresora';
  static const String _prefAddress = 'repartidor_printer_address';
  static const String _prefName = 'repartidor_printer_name';

  // -- Printer configuration persistence --

  static Future<bool> tieneImpresora() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_prefKey) ?? false;
  }

  static Future<void> setTieneImpresora(bool value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_prefKey, value);
  }

  static Future<String?> getSavedPrinterAddress() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_prefAddress);
  }

  static Future<String?> getSavedPrinterName() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_prefName);
  }

  static Future<void> savePrinter(
    String address,
    String name,
  ) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefAddress, address);
    await prefs.setString(_prefName, name);
  }

  // -- Bluetooth permissions --

  static Future<bool> requestBluetoothPermissions() async {
    final statuses = await [
      Permission.bluetoothConnect,
      Permission.bluetoothScan,
      Permission.locationWhenInUse,
    ].request();

    final allGranted = statuses.values.every(
      (s) => s.isGranted || s.isLimited,
    );
    if (!allGranted) {
      debugPrint(
        '[ZEBRA] BT permissions not granted: $statuses',
      );
    }
    return allGranted;
  }

  // -- Device selection (uses built-in picker) --

  /// Shows the built-in Bluetooth device picker.
  /// Returns the selected device, or null if cancelled.
  static Future<BluetoothDevice?> selectPrinter(
    BuildContext context,
  ) async {
    final granted = await requestBluetoothPermissions();
    if (!granted) return null;
    return FlutterBluetoothPrinter.selectDevice(context);
  }

  // -- ZPL generation --

  static String generateDeliveryZpl({
    required AlbaranEntrega albaran,
    required List<EntregaItem> items,
    required String observaciones,
    String? receptorNombre,
  }) {
    final buf = StringBuffer();
    int y = 30;

    // Header
    buf.writeln('^XA');
    buf.writeln('^CI28'); // UTF-8 for Spanish chars
    buf.writeln('^CF0,28');
    buf.writeln('^FO30,$y^FDGranja Mari Pepa S.L.^FS');
    y += 30;
    buf.writeln('^CF0,18');
    buf.writeln(
      '^FO30,$y^FDPol.Ind.Saprelorca-D3, 30817 Lorca^FS',
    );
    y += 22;
    buf.writeln(
      '^FO30,$y^FDCIF: B04008710  Tel: 968 47 08 80^FS',
    );
    y += 28;

    // Separator
    buf.writeln('^FO30,$y^GB550,2,2^FS');
    y += 12;

    // Document type
    buf.writeln('^CF0,24');
    final docLabel = albaran.numeroFactura > 0
        ? 'FACTURA: ${albaran.serieFactura}/'
            '${albaran.numeroFactura}'
        : 'ALBARAN: ${albaran.serie}/'
            '${albaran.numeroAlbaran}';
    buf.writeln('^FO30,$y^FD$docLabel^FS');
    y += 28;
    buf.writeln('^CF0,20');
    buf.writeln('^FO30,$y^FDFecha: ${albaran.fecha}^FS');
    y += 26;

    // Separator
    buf.writeln('^FO30,$y^GB550,2,2^FS');
    y += 12;

    // Client
    buf.writeln('^CF0,22');
    buf.writeln(
      '^FO30,$y^FDCliente: '
      '${_truncate(albaran.nombreCliente, 40)}^FS',
    );
    y += 24;
    if (albaran.direccion.isNotEmpty) {
      buf.writeln('^CF0,18');
      buf.writeln(
        '^FO30,$y^FD${_truncate(albaran.direccion, 45)}^FS',
      );
      y += 22;
    }
    buf.writeln('^CF0,18');
    buf.writeln(
      '^FO30,$y^FDF.Pago: ${albaran.formaPagoDesc}^FS',
    );
    y += 26;

    // Separator
    buf.writeln('^FO30,$y^GB550,2,2^FS');
    y += 12;

    // Product header
    buf.writeln('^CF0,18');
    buf.writeln(
      '^FO30,$y^FDDESCRIPCION'
      '            CANT   IMPORTE^FS',
    );
    y += 22;
    buf.writeln('^FO30,$y^GB550,1,1^FS');
    y += 8;

    // Product lines
    buf.writeln('^CF0,18');
    for (final item in items) {
      final desc = _truncate(item.descripcion, 24);
      final cant =
          item.cantidadPedida.toStringAsFixed(0).padLeft(4);
      final imp = (item.cantidadPedida * item.precioUnitario)
          .toStringAsFixed(2)
          .padLeft(8);
      buf.writeln('^FO30,$y^FD$desc $cant $imp^FS');
      y += 22;
    }

    // Total separator
    y += 4;
    buf.writeln('^FO30,$y^GB550,2,2^FS');
    y += 12;

    // Total
    buf.writeln('^CF0,24');
    final total = albaran.importeTotal.toStringAsFixed(2);
    buf.writeln('^FO30,$y^FDTOTAL: $total EUR^FS');
    y += 30;

    // IVA breakdown
    if (albaran.ivaBreakdown.isNotEmpty) {
      buf.writeln('^CF0,16');
      for (final iva in albaran.ivaBreakdown) {
        final base = iva.base.toStringAsFixed(2);
        final pct = iva.pct.toStringAsFixed(0);
        final amt = iva.iva.toStringAsFixed(2);
        buf.writeln(
          '^FO30,$y^FDBase: $base  IVA $pct%: $amt^FS',
        );
        y += 20;
      }
    }

    // Separator
    y += 4;
    buf.writeln('^FO30,$y^GB550,2,2^FS');
    y += 12;

    // Observations
    if (observaciones.isNotEmpty) {
      buf.writeln('^CF0,18');
      for (final line in _wrapText(observaciones, 50)) {
        buf.writeln('^FO30,$y^FDObs: $line^FS');
        y += 20;
      }
      y += 4;
    }

    // Receptor
    if (receptorNombre != null && receptorNombre.isNotEmpty) {
      buf.writeln('^CF0,20');
      buf.writeln(
        '^FO30,$y^FDFirmado por: $receptorNombre^FS',
      );
      y += 24;
    }

    // Footer
    y += 8;
    buf.writeln('^CF0,14');
    buf.writeln(
      '^FO30,$y^FDLa posesion de este documento '
      'NO implica el pago^FS',
    );
    y += 20;
    buf.writeln(
      '^FO30,$y^FDEntregado por: '
      '${albaran.codigoRepartidor}^FS',
    );

    buf.writeln('^XZ');
    return buf.toString();
  }

  // -- Print execution --

  /// Sends raw ZPL to the saved (or given) printer.
  /// Returns true on success, false on failure.
  static Future<bool> printZpl(
    String zplData, {
    String? address,
  }) async {
    try {
      final addr = address ?? await getSavedPrinterAddress();
      if (addr == null) {
        debugPrint('[ZEBRA] No printer address configured');
        return false;
      }

      final granted = await requestBluetoothPermissions();
      if (!granted) return false;

      final bytes = Uint8List.fromList(utf8.encode(zplData));
      final ok = await FlutterBluetoothPrinter.printBytes(
        address: addr,
        data: bytes,
        keepConnected: false,
      );

      debugPrint('[ZEBRA] Print result: $ok');
      return ok;
    } catch (e) {
      debugPrint('[ZEBRA] Print error: $e');
      return false;
    }
  }

  // -- Helpers --

  static String _truncate(String text, int maxLen) {
    if (text.length <= maxLen) return text;
    return '${text.substring(0, maxLen - 1)}~';
  }

  static List<String> _wrapText(String text, int maxLen) {
    final words = text.split(' ');
    final lines = <String>[];
    var current = '';
    for (final word in words) {
      if (current.isEmpty) {
        current = word;
      } else if (current.length + 1 + word.length <= maxLen) {
        current += ' $word';
      } else {
        lines.add(current);
        current = word;
      }
    }
    if (current.isNotEmpty) lines.add(current);
    return lines;
  }
}
