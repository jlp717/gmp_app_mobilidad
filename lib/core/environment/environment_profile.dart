/// Server-verified runtime modes understood by the mobile client.
enum EnvironmentKind {
  /// Isolated engineering environment.
  test,

  /// Isolated environment used for demonstrations.
  demo,

  /// Live runtime profile.
  production,

  /// No valid server contract has been received.
  unverified,
}

/// Sanitized runtime routing contract returned by the backend.
class EnvironmentProfile {
  /// Creates a profile only after the server contract has been verified.
  const EnvironmentProfile.verified({
    required this.profile,
    required this.readSchema,
    required this.writeSchema,
    required this.tableSet,
    required this.erpExportEnabled,
    required this.writesEnabled,
    required this.productionWritesEnabled,
  }) : isVerified = true;

  const EnvironmentProfile._unverified()
      : profile = EnvironmentKind.unverified,
        isVerified = false,
        readSchema = null,
        writeSchema = null,
        tableSet = null,
        erpExportEnabled = false,
        writesEnabled = false,
        productionWritesEnabled = false;

  /// Parses the public backend contract, failing closed on any missing field.
  factory EnvironmentProfile.fromResponse(Map<String, dynamic> response) {
    if (response['success'] != true) return unverified;
    final raw = response['profile'];
    if (raw is! Map) return unverified;
    final payload = Map<String, dynamic>.from(raw);
    if (payload['verified'] != true) return unverified;
    final profile = switch (payload['profile']) {
      'test' => EnvironmentKind.test,
      'demo' => EnvironmentKind.demo,
      'production' => EnvironmentKind.production,
      _ => EnvironmentKind.unverified,
    };
    if (profile == EnvironmentKind.unverified) return unverified;

    final readSchema = payload['readSchema'];
    final writeSchema = payload['writeSchema'];
    final tableSet = payload['tableSet'];
    if (readSchema is! String ||
        readSchema.isEmpty ||
        writeSchema is! String ||
        writeSchema.isEmpty ||
        tableSet is! String ||
        tableSet.isEmpty) {
      return unverified;
    }
    return EnvironmentProfile.verified(
      profile: profile,
      readSchema: readSchema,
      writeSchema: writeSchema,
      tableSet: tableSet,
      erpExportEnabled: payload['erpExportEnabled'] == true,
      writesEnabled: payload['writesEnabled'] == true,
      productionWritesEnabled: payload['productionWritesEnabled'] == true,
    );
  }

  /// Fail-closed value used until a complete server contract is received.
  static const EnvironmentProfile unverified = EnvironmentProfile._unverified();

  /// Active server runtime kind.
  final EnvironmentKind profile;

  /// Whether this value came from a complete verified server response.
  final bool isVerified;

  /// Sanitized ERP read schema.
  final String? readSchema;

  /// Sanitized application-buffer write schema.
  final String? writeSchema;

  /// Sanitized server table mapping name.
  final String? tableSet;

  /// Whether ERP export is explicitly enabled by all server gates.
  final bool erpExportEnabled;

  /// Whether application writes are enabled in the selected profile.
  final bool writesEnabled;

  /// Whether production writes passed their explicit server gates.
  final bool productionWritesEnabled;

  /// Human-readable label displayed by the global environment ribbon.
  String get label {
    return switch (profile) {
      EnvironmentKind.test => 'TEST',
      EnvironmentKind.demo => 'DEMO',
      EnvironmentKind.production => 'PRODUCCIÓN',
      EnvironmentKind.unverified => 'Entorno sin verificar',
    };
  }
}
