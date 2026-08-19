import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';

/// Returns a user-safe, actionable failure message.
///
/// Error payloads can contain server paths, personal data, SQL diagnostics or
/// credentials. They are intentionally never interpolated into UI or logs.
String repartidorSafeOperationMessage({
  required Object error,
  required String operation,
}) {
  switch (operation) {
    case 'camera':
      return 'No se pudo abrir la cámara. Revisa los permisos e inténtalo de nuevo.';
    case 'technicalSheet':
      return 'No se pudo descargar la ficha técnica. Comprueba la conexión e inténtalo de nuevo.';
    case 'pdfPreview':
      return 'No se pudo visualizar el PDF. Inténtalo de nuevo.';
    case 'pdfDownload':
      return 'No se pudo preparar el PDF para descargar. Inténtalo de nuevo.';
    case 'pdfShare':
      return 'No se pudo preparar el PDF para compartir. Inténtalo de nuevo.';
    case 'signature':
      return 'No se pudo guardar la firma. Vuelve a firmar e inténtalo de nuevo.';
    case 'printer':
      return 'No se pudo completar la operación con la impresora. Revisa la conexión e inténtalo de nuevo.';
    default:
      return 'No se pudo completar la operación. Inténtalo de nuevo.';
  }
}

/// Builds image headers only for canonical product-image URLs on this API.
///
/// `Image.network` does not run Dio interceptors, so it cannot refresh a
/// session itself. Refuse to attach credentials to any non-canonical URL.
Map<String, String>? repartidorProtectedImageHeaders(String imageUrl) {
  final imageUri = Uri.tryParse(imageUrl);
  final apiUri = Uri.tryParse(ApiConfig.baseUrl);
  if (imageUri == null ||
      apiUri == null ||
      imageUri.scheme != apiUri.scheme ||
      imageUri.host != apiUri.host ||
      imageUri.port != apiUri.port ||
      !imageUri.path.startsWith('${apiUri.path}/products/')) {
    return null;
  }

  return <String, String>{
    'Accept': 'image/*',
    ...ApiClient.authHeaders,
  };
}
