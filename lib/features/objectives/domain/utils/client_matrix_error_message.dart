import 'package:gmp_app_mobilidad/core/api/api_client.dart';

/// Returns a safe, actionable message for a failed client-matrix request.
///
/// Backend details remain available in diagnostic logs, but SQL, bind values,
/// and transport internals are never rendered to the user.
String clientMatrixErrorMessage(Object error) {
  if (error is! ApiException) {
    return 'No se pudo cargar la evolución del cliente. Inténtalo de nuevo.';
  }

  switch (error.statusCode) {
    case 0:
      return 'No hay conexión con el servicio. Comprueba la red e inténtalo de nuevo.';
    case 401:
      return 'La sesión ha caducado. Inicia sesión de nuevo para continuar.';
    case 403:
      return 'Tu usuario no tiene acceso a la evolución de este cliente.';
    case 404:
      return 'No se encontró la evolución de este cliente.';
    case 408:
    case 429:
      return 'La consulta está tardando más de lo esperado. Inténtalo de nuevo.';
    default:
      if (error.statusCode != null && error.statusCode! >= 500) {
        return 'El servicio no pudo cargar la evolución ahora. Inténtalo de nuevo.';
      }
      return 'No se pudo cargar la evolución del cliente. Inténtalo de nuevo.';
  }
}
