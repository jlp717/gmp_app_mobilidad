import 'package:gmp_app_mobilidad/core/api/api_client.dart';

/// Maps client-evolution failures to safe, user-facing guidance.
String clientEvolutionErrorMessage(Object error) {
  if (error is! ApiException) {
    return 'No se pudieron cargar las devoluciones. Inténtalo de nuevo.';
  }

  switch (error.statusCode) {
    case 0:
      return 'No hay conexión con el servicio. Comprueba la red e inténtalo de nuevo.';
    case 401:
      return 'La sesión ha caducado. Inicia sesión de nuevo para continuar.';
    case 403:
      return 'Tu usuario no tiene acceso a los datos de este cliente.';
    case 408:
    case 429:
      return 'La consulta está tardando más de lo esperado. Inténtalo de nuevo.';
    default:
      if (error.statusCode != null && error.statusCode! >= 500) {
        return 'El servicio no pudo cargar las devoluciones ahora. Inténtalo de nuevo.';
      }
      return 'No se pudieron cargar las devoluciones. Inténtalo de nuevo.';
  }
}
