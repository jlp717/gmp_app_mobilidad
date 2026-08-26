sealed class Failure implements Exception {
  /// Creates a typed failure carrying an optional backend code,
  /// confirmation id and the original un-mapped message.
  const Failure(
    this.message, {
    this.code,
    this.confirmationId,
    this.originalMessage,
  });

  /// User-facing failure description.
  final String message;

  /// Codigo semantico del backend (por ejemplo `CONFLICT`), si existe.
  final String? code;

  /// Identificador de confirmacion devuelto por conflictos tipados.
  final String? confirmationId;

  /// Mensaje original antes de mapear a Failure.
  final String? originalMessage;

  @override
  String toString() => message;
}

/// Transport-level failure (no HTTP status or status zero).
final class NetworkFailure extends Failure {
  /// Creates a network failure preserving optional backend metadata.
  const NetworkFailure([
    String message = 'No se pudo conectar con el servidor.',
    String? code,
    String? confirmationId,
    String? originalMessage,
  ]) : super(
          message,
          code: code,
          confirmationId: confirmationId,
          originalMessage: originalMessage,
        );
}

/// Backend returned a non-success HTTP status.
final class ServerFailure extends Failure {
  /// Creates a server failure preserving status and backend metadata.
  const ServerFailure(
    String message, {
    this.statusCode,
    String? code,
    String? confirmationId,
    String? originalMessage,
  }) : super(
          message,
          code: code,
          confirmationId: confirmationId,
          originalMessage: originalMessage,
        );

  /// HTTP status code reported by the backend.
  final int? statusCode;
}

/// Invalid input rejected locally before reaching the API.
final class ValidationFailure extends Failure {
  /// Creates a validation failure.
  const ValidationFailure(super.message);
}

/// Unexpected error without a specific mapping.
final class UnknownFailure extends Failure {
  /// Creates an unknown failure.
  const UnknownFailure([
    super.message = 'Se ha producido un error inesperado.',
  ]);
}
