import 'package:equatable/equatable.dart';

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
  final String role; // JEFE_VENTAS, COMERCIAL, ADMIN

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
  });

  bool get isDirector => role == 'JEFE_VENTAS' || role == 'ADMIN';
  bool get isSales => role == 'COMERCIAL';

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
        role
      ];
}
