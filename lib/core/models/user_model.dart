import 'package:equatable/equatable.dart';

/// User roles supported by the app
enum UserRole { jefe, comercial, repartidor }

/// User model aligned with backend response
class UserModel extends Equatable {
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
  final bool showCommissions; // NEW: DB-driven visibility

  const UserModel({
    required this.id,
    required this.code,
    required this.name,
    required this.company,
    this.delegation,
    this.vendedorCode,
    this.isJefeVentas = false,
    this.tipoVendedor,
    required this.role,
    this.codigoConductor,
    this.showCommissions = true, // Default true
  });

  // Role helpers
  UserRole get userRole {
    switch (role.toUpperCase()) {
      case 'JEFE':
      case 'JEFE_VENTAS':
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
      showCommissions: (json['showCommissions'] as bool?) ?? true,
    );
  }

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
      'showCommissions': showCommissions,
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
    bool? showCommissions,
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
      showCommissions: showCommissions ?? this.showCommissions,
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
        showCommissions,
      ];
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
}

