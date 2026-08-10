// ignore_for_file: lines_longer_than_80_chars
import 'package:gmp_app_mobilidad/core/api/api_client.dart';

// Req #16: mapea códigos de error del backend a mensajes claros para el repartidor.
// ignore: lines_longer_than_80_chars
const Map<String, String> _financeErrorCodeMessages = <String, String>{
  'DUPLICATE_DAILY_LIQUIDACION':
      'Ya cerraste la jornada de hoy para este repartidor. '
          'Abre una nueva fecha o verifica la liquidación existente.',
  'IDEMPOTENCY_CONFLICT':
      'El último intento se quedó a medias con datos distintos. '
          'Refresca la pantalla y vuelve a intentarlo.',
  'INCONSISTENT_IDEMPOTENCY':
      'Datos de la liquidación inconsistentes. Refresca y vuelve a intentar.',
  'PAYMENT_ALREADY_REGISTERED': 'Este documento ya tiene un cobro registrado. '
      'Si necesitas corregirlo, anula el cobro existente desde el detalle.',
  'DUPLICATE_PAYMENT': 'Este documento ya tiene un cobro registrado.',
  'PAYMENT_AUTHZ_DENIED':
      'No tienes autorización para cobrar/anular este documento.',
  'DOCUMENT_NOT_ASSIGNED':
      'El documento no está asignado a este repartidor o cliente.',
  'ALREADY_DELIVERED':
      'Esta entrega ya fue confirmada previamente. Refresca la lista.',
  'COBRO_NOT_FOUND':
      'El cobro ya no existe (puede que otra sesión lo haya anulado).',
  'COBRO_ALREADY_LIQUIDADO':
      'No se puede anular: el cobro está incluido en una liquidación cerrada.',
  'UNSUPPORTED_REPARTIDOR_SELECTOR':
      'Selecciona uno o varios repartidores concretos.',
  'INVALID_FINANCE_CURSOR':
      'La lista ha cambiado. Actualiza para volver a cargarla.',
  'REPARTO_SCHEMA_UNAVAILABLE':
      'El servicio financiero no está disponible temporalmente.',
};

/// Returns a safe, actionable user-facing message for finance API failures.
String financeErrorMessage(Object error, String fallback) {
  if (error is ApiException) {
    final code = error.code?.trim();
    if (code != null && _financeErrorCodeMessages.containsKey(code)) {
      return _financeErrorCodeMessages[code]!;
    }
    if (error.statusCode == 401) {
      return 'Tu sesión ha caducado. Vuelve a iniciar sesión.';
    }
    if (error.statusCode == 403) {
      return 'No tienes permisos para consultar estos datos.';
    }
    if ((error.statusCode ?? 0) >= 500) {
      return 'El servicio financiero no está disponible. Reintenta más tarde.';
    }
    if (error.statusCode == 0) {
      return 'No hay conexión. Comprueba la red y vuelve a intentarlo.';
    }
    final message = error.message.trim();
    if (message.isNotEmpty) return message;
  }
  return fallback;
}
