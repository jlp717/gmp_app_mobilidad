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
      name: json['name'] ?? '',
      company: json['company'] ?? 'GMP',
      delegation: json['delegation'],
      vendedorCode: json['vendedorCode'],
      isJefeVentas: json['isJefeVentas'] ?? false,
      tipoVendedor: json['tipoVendedor'],
      role: json['role'] ?? 'COMERCIAL',
      codigoConductor: json['codigoConductor'],
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
    };
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
      ];
}

