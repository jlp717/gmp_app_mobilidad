// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'bolsa_models.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
    'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models');

BolsaMonthlyPoint _$BolsaMonthlyPointFromJson(Map<String, dynamic> json) {
  return _BolsaMonthlyPoint.fromJson(json);
}

/// @nodoc
mixin _$BolsaMonthlyPoint {
  @JsonKey(fromJson: _jsonInt)
  int get ejercicio => throw _privateConstructorUsedError;
  @JsonKey(fromJson: _jsonInt)
  int get mes => throw _privateConstructorUsedError;
  @JsonKey(fromJson: _jsonDouble)
  double get acumulado => throw _privateConstructorUsedError;
  @JsonKey(fromJson: _jsonDouble)
  double get consumido => throw _privateConstructorUsedError;
  @JsonKey(fromJson: _jsonDouble)
  double get saldoDisponible => throw _privateConstructorUsedError;

  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $BolsaMonthlyPointCopyWith<BolsaMonthlyPoint> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $BolsaMonthlyPointCopyWith<$Res> {
  factory $BolsaMonthlyPointCopyWith(
          BolsaMonthlyPoint value, $Res Function(BolsaMonthlyPoint) then) =
      _$BolsaMonthlyPointCopyWithImpl<$Res, BolsaMonthlyPoint>;
  @useResult
  $Res call(
      {@JsonKey(fromJson: _jsonInt) int ejercicio,
      @JsonKey(fromJson: _jsonInt) int mes,
      @JsonKey(fromJson: _jsonDouble) double acumulado,
      @JsonKey(fromJson: _jsonDouble) double consumido,
      @JsonKey(fromJson: _jsonDouble) double saldoDisponible});
}

/// @nodoc
class _$BolsaMonthlyPointCopyWithImpl<$Res, $Val extends BolsaMonthlyPoint>
    implements $BolsaMonthlyPointCopyWith<$Res> {
  _$BolsaMonthlyPointCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? ejercicio = null,
    Object? mes = null,
    Object? acumulado = null,
    Object? consumido = null,
    Object? saldoDisponible = null,
  }) {
    return _then(_value.copyWith(
      ejercicio: null == ejercicio
          ? _value.ejercicio
          : ejercicio // ignore: cast_nullable_to_non_nullable
              as int,
      mes: null == mes
          ? _value.mes
          : mes // ignore: cast_nullable_to_non_nullable
              as int,
      acumulado: null == acumulado
          ? _value.acumulado
          : acumulado // ignore: cast_nullable_to_non_nullable
              as double,
      consumido: null == consumido
          ? _value.consumido
          : consumido // ignore: cast_nullable_to_non_nullable
              as double,
      saldoDisponible: null == saldoDisponible
          ? _value.saldoDisponible
          : saldoDisponible // ignore: cast_nullable_to_non_nullable
              as double,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$BolsaMonthlyPointImplCopyWith<$Res>
    implements $BolsaMonthlyPointCopyWith<$Res> {
  factory _$$BolsaMonthlyPointImplCopyWith(_$BolsaMonthlyPointImpl value,
          $Res Function(_$BolsaMonthlyPointImpl) then) =
      __$$BolsaMonthlyPointImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {@JsonKey(fromJson: _jsonInt) int ejercicio,
      @JsonKey(fromJson: _jsonInt) int mes,
      @JsonKey(fromJson: _jsonDouble) double acumulado,
      @JsonKey(fromJson: _jsonDouble) double consumido,
      @JsonKey(fromJson: _jsonDouble) double saldoDisponible});
}

/// @nodoc
class __$$BolsaMonthlyPointImplCopyWithImpl<$Res>
    extends _$BolsaMonthlyPointCopyWithImpl<$Res, _$BolsaMonthlyPointImpl>
    implements _$$BolsaMonthlyPointImplCopyWith<$Res> {
  __$$BolsaMonthlyPointImplCopyWithImpl(_$BolsaMonthlyPointImpl _value,
      $Res Function(_$BolsaMonthlyPointImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? ejercicio = null,
    Object? mes = null,
    Object? acumulado = null,
    Object? consumido = null,
    Object? saldoDisponible = null,
  }) {
    return _then(_$BolsaMonthlyPointImpl(
      ejercicio: null == ejercicio
          ? _value.ejercicio
          : ejercicio // ignore: cast_nullable_to_non_nullable
              as int,
      mes: null == mes
          ? _value.mes
          : mes // ignore: cast_nullable_to_non_nullable
              as int,
      acumulado: null == acumulado
          ? _value.acumulado
          : acumulado // ignore: cast_nullable_to_non_nullable
              as double,
      consumido: null == consumido
          ? _value.consumido
          : consumido // ignore: cast_nullable_to_non_nullable
              as double,
      saldoDisponible: null == saldoDisponible
          ? _value.saldoDisponible
          : saldoDisponible // ignore: cast_nullable_to_non_nullable
              as double,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$BolsaMonthlyPointImpl implements _BolsaMonthlyPoint {
  const _$BolsaMonthlyPointImpl(
      {@JsonKey(fromJson: _jsonInt) required this.ejercicio,
      @JsonKey(fromJson: _jsonInt) required this.mes,
      @JsonKey(fromJson: _jsonDouble) required this.acumulado,
      @JsonKey(fromJson: _jsonDouble) required this.consumido,
      @JsonKey(fromJson: _jsonDouble) required this.saldoDisponible});

  factory _$BolsaMonthlyPointImpl.fromJson(Map<String, dynamic> json) =>
      _$$BolsaMonthlyPointImplFromJson(json);

  @override
  @JsonKey(fromJson: _jsonInt)
  final int ejercicio;
  @override
  @JsonKey(fromJson: _jsonInt)
  final int mes;
  @override
  @JsonKey(fromJson: _jsonDouble)
  final double acumulado;
  @override
  @JsonKey(fromJson: _jsonDouble)
  final double consumido;
  @override
  @JsonKey(fromJson: _jsonDouble)
  final double saldoDisponible;

  @override
  String toString() {
    return 'BolsaMonthlyPoint(ejercicio: $ejercicio, mes: $mes, acumulado: $acumulado, consumido: $consumido, saldoDisponible: $saldoDisponible)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$BolsaMonthlyPointImpl &&
            (identical(other.ejercicio, ejercicio) ||
                other.ejercicio == ejercicio) &&
            (identical(other.mes, mes) || other.mes == mes) &&
            (identical(other.acumulado, acumulado) ||
                other.acumulado == acumulado) &&
            (identical(other.consumido, consumido) ||
                other.consumido == consumido) &&
            (identical(other.saldoDisponible, saldoDisponible) ||
                other.saldoDisponible == saldoDisponible));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(
      runtimeType, ejercicio, mes, acumulado, consumido, saldoDisponible);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$BolsaMonthlyPointImplCopyWith<_$BolsaMonthlyPointImpl> get copyWith =>
      __$$BolsaMonthlyPointImplCopyWithImpl<_$BolsaMonthlyPointImpl>(
          this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$BolsaMonthlyPointImplToJson(
      this,
    );
  }
}

abstract class _BolsaMonthlyPoint implements BolsaMonthlyPoint {
  const factory _BolsaMonthlyPoint(
      {@JsonKey(fromJson: _jsonInt) required final int ejercicio,
      @JsonKey(fromJson: _jsonInt) required final int mes,
      @JsonKey(fromJson: _jsonDouble) required final double acumulado,
      @JsonKey(fromJson: _jsonDouble) required final double consumido,
      @JsonKey(fromJson: _jsonDouble)
      required final double saldoDisponible}) = _$BolsaMonthlyPointImpl;

  factory _BolsaMonthlyPoint.fromJson(Map<String, dynamic> json) =
      _$BolsaMonthlyPointImpl.fromJson;

  @override
  @JsonKey(fromJson: _jsonInt)
  int get ejercicio;
  @override
  @JsonKey(fromJson: _jsonInt)
  int get mes;
  @override
  @JsonKey(fromJson: _jsonDouble)
  double get acumulado;
  @override
  @JsonKey(fromJson: _jsonDouble)
  double get consumido;
  @override
  @JsonKey(fromJson: _jsonDouble)
  double get saldoDisponible;
  @override
  @JsonKey(ignore: true)
  _$$BolsaMonthlyPointImplCopyWith<_$BolsaMonthlyPointImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
