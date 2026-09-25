// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'bolsa_models.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$BolsaMonthlyPointImpl _$$BolsaMonthlyPointImplFromJson(
        Map<String, dynamic> json) =>
    _$BolsaMonthlyPointImpl(
      ejercicio: _jsonInt(json['ejercicio']),
      mes: _jsonInt(json['mes']),
      acumulado: _jsonDouble(json['acumulado']),
      consumido: _jsonDouble(json['consumido']),
      saldoDisponible: _jsonDouble(json['saldoDisponible']),
    );

Map<String, dynamic> _$$BolsaMonthlyPointImplToJson(
        _$BolsaMonthlyPointImpl instance) =>
    <String, dynamic>{
      'ejercicio': instance.ejercicio,
      'mes': instance.mes,
      'acumulado': instance.acumulado,
      'consumido': instance.consumido,
      'saldoDisponible': instance.saldoDisponible,
    };
