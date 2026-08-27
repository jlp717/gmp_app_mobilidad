import 'package:gmp_app_mobilidad/core/api/api_client.dart';

/// Only approved copy reaches the screen; never display server error strings.
String ruteroRouteError(Object error) {
  if (error is ApiException) {
    switch (error.code) {
      case 'RUTERO_DAY_MOVE_UNAVAILABLE':
        return 'No se ha cambiado el día. Esta función necesita que oficina reprograme la entrega. Contacta con tu responsable.';
      case 'RUTERO_MOVE_OUTSIDE_WEEK':
        return 'Elige un día de la misma semana, de lunes a domingo.';
      case 'RUTERO_MOVE_SAME_DAY':
        return 'Elige otro día de esta semana. Para cambiar la posición, usa Cambiar posición.';
      case 'RUTERO_ORDER_REVISION_REQUIRED':
      case 'RUTERO_ORDER_REVISION_INVALID':
        return 'Falta actualizar el orden guardado. Pulsa Recargar y vuelve a ordenar.';
      case 'RUTERO_ORDER_ACK_MISMATCH':
        return 'El servidor no confirmó el orden solicitado. Recarga la ruta antes de volver a guardar.';
      case 'DATE_INVALID':
        return 'La fecha no es válida. Cierra esta pantalla y elige el día de reparto.';
      case 'REPARTIDOR_ID_MULTI_NOT_ALLOWED':
        return 'Selecciona un solo repartidor antes de ordenar la ruta.';
      case 'RUTERO_ORDEN_SCHEMA_UNAVAILABLE':
      case 'REPARTO_WRITES_DISABLED':
        return 'El guardado de rutas no está disponible. Conserva esta pantalla y consulta con tu responsable.';
    }
    switch (error.statusCode) {
      case 400:
        return 'No se pudo aceptar el orden. Recarga la ruta y vuelve a intentarlo. Si se repite, avisa a tu responsable.';
      case 401:
        return 'La sesión ha caducado. Inicia sesión de nuevo.';
      case 403:
        return 'No tienes permiso para cambiar esta ruta. Comprueba el repartidor seleccionado.';
      case 409:
        return 'El orden guardado ha cambiado. Recarga y comprueba la ruta antes de volver a guardar.';
      case 422:
        return 'Revisa el día y las paradas. Recarga la ruta completa antes de volver a ordenar.';
      case 503:
        return 'El servicio no está disponible. Conserva tus cambios y vuelve a intentarlo; recarga para comprobar si se guardaron.';
    }
  }
  return 'No se pudo comprobar el resultado. Revisa la conexión y recarga para ver el orden guardado. Tus cambios siguen en esta pantalla.';
}

List<DateTime> ruteroNaturalWeek(DateTime date) {
  final monday = DateTime(date.year, date.month, date.day - date.weekday + 1);
  return List.generate(
      7, (index) => DateTime(monday.year, monday.month, monday.day + index));
}
