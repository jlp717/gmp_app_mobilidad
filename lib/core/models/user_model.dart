import 'package:equatable/equatable.dart';

/// User roles supported by the app
enum UserRole { jefe, comercial, repartidor }

/// User model aligned with backend response
class UserModel extends Equatable {
  // NEW: DB-driven visibility

  const UserModel({
    required this.id,
    required this.code,
    required this.name,
    required this.company,
    required this.role,
    this.delegation,
    this.vendedorCode,
    this.isJefeVentas = false,
    this.tipoVendedor,
    this.codigoConductor,
    this.matricula,
    this.availableRoles = const [],
    this.availableModes = const [],
    this.vendedorCodes = const [],
    this.showCommissions = true, // Default true
    this.claimsVersion = 0,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) {
    return UserModel(
      id: json['id'].toString(),
      code: json['code']?.toString() ?? '',
      name: (json['name'] as String?) ?? '',
      company: (json['company'] as String?) ?? 'GMP',
      delegation: json['delegation'] as String?,
      vendedorCode: json['vendedorCode'] as String?,
      isJefeVentas: _parseBool(json['isJefeVentas']),
      tipoVendedor: json['tipoVendedor'] as String?,
      role: (json['role'] as String?) ?? 'COMERCIAL',
      codigoConductor: json['codigoConductor'] as String?,
      matricula: json['matricula'] as String?,
      availableRoles: _parseStringList(json['availableRoles']),
      availableModes: _parseStringList(json['availableModes']),
      vendedorCodes: _parseStringList(
        json['vendedorCodes'] ?? json['vendorCodes'],
      ),
      showCommissions: json.containsKey('showCommissions')
          ? _parseBool(json['showCommissions'])
          : true,
      claimsVersion: _parseInt(json['claimsVersion']),
    );
  }
  final String id;
  final String code; // CODIGOUSUARIO
  final String name; // NOMBREUSUARIO
  final String company; // SUBEMPRESA
  final String? delegation; // DELEGACION
  final String? vendedorCode; // CODIGOVENDEDOR
  final bool isJefeVentas; // JEFEVENTASSN
  final String? tipoVendedor; // TIPOVENDEDOR
  final String role; // JEFE, COMERCIAL, REPARTIDOR
  final String? codigoConductor; // Para repartidores
  final String? matricula; // Matricula DB-backed del reparto activo
  final List<String> availableRoles; // Roles autorizados por backend
  final List<String> availableModes; // Modos UI autorizados por backend
  final List<String> vendedorCodes; // Ambito canonico actual
  final bool showCommissions;
  final int claimsVersion;

  // Role helpers
  UserRole get userRole {
    switch (role.toUpperCase()) {
      case 'JEFE':
      case 'JEFE_VENTAS':
      case 'GERENTE':
      case 'ADMIN':
        return UserRole.jefe;
      case 'REPARTIDOR':
        return UserRole.repartidor;
      default:
        return UserRole.comercial;
    }
  }

  bool get isDirector => userRole == UserRole.jefe;
  bool get isSales => userRole == UserRole.comercial;
  bool get isRepartidor => userRole == UserRole.repartidor;

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'code': code,
      'name': name,
      'company': company,
      'delegation': delegation,
      'vendedorCode': vendedorCode,
      'isJefeVentas': isJefeVentas,
      'tipoVendedor': tipoVendedor,
      'role': role,
      'codigoConductor': codigoConductor,
      'matricula': matricula,
      'availableRoles': availableRoles,
      'availableModes': availableModes,
      'vendedorCodes': vendedorCodes,
      'showCommissions': showCommissions,
      'claimsVersion': claimsVersion,
    };
  }

  UserModel copyWith({
    String? id,
    String? code,
    String? name,
    String? company,
    String? delegation,
    String? vendedorCode,
    bool? isJefeVentas,
    String? tipoVendedor,
    String? role,
    String? codigoConductor,
    String? matricula,
    List<String>? availableRoles,
    List<String>? availableModes,
    List<String>? vendedorCodes,
    bool? showCommissions,
    int? claimsVersion,
  }) {
    return UserModel(
      id: id ?? this.id,
      code: code ?? this.code,
      name: name ?? this.name,
      company: company ?? this.company,
      delegation: delegation ?? this.delegation,
      vendedorCode: vendedorCode ?? this.vendedorCode,
      isJefeVentas: isJefeVentas ?? this.isJefeVentas,
      tipoVendedor: tipoVendedor ?? this.tipoVendedor,
      role: role ?? this.role,
      codigoConductor: codigoConductor ?? this.codigoConductor,
      matricula: matricula ?? this.matricula,
      availableRoles: availableRoles ?? this.availableRoles,
      availableModes: availableModes ?? this.availableModes,
      vendedorCodes: vendedorCodes ?? this.vendedorCodes,
      showCommissions: showCommissions ?? this.showCommissions,
      claimsVersion: claimsVersion ?? this.claimsVersion,
    );
  }

  @override
  List<Object?> get props => [
        id,
        code,
        name,
        company,
        delegation,
        vendedorCode,
        isJefeVentas,
        tipoVendedor,
        role,
        codigoConductor,
        matricula,
        availableRoles,
        availableModes,
        vendedorCodes,
        showCommissions,
        claimsVersion,
      ];

  static List<String> _parseStringList(dynamic value) {
    if (value is! Iterable) return const [];
    return List<String>.unmodifiable(
      value
          .map((item) => item.toString().trim().toUpperCase())
          .where((item) => item.isNotEmpty),
    );
  }

  static bool _parseBool(dynamic value) {
    if (value == null) return false;
    if (value is bool) return value;
    if (value is int) return value == 1;
    if (value is String) {
      final v = value.toUpperCase();
      return v == 'TRUE' || v == 'S' || v == '1' || v == 'YES' || v == 'Y';
    }
    return false;
  }

  static int _parseInt(dynamic value) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    return int.tryParse(value?.toString() ?? '') ?? 0;
  }
}
