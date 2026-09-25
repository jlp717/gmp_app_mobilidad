// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'cobros_models.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
    'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models');

/// @nodoc
mixin _$CobroHistorico {
  String get id => throw _privateConstructorUsedError;
  double get importe => throw _privateConstructorUsedError;
  DateTime get fecha => throw _privateConstructorUsedError;
  String? get formaPago => throw _privateConstructorUsedError;
  String get referencia => throw _privateConstructorUsedError;
  String get observaciones => throw _privateConstructorUsedError;

  @JsonKey(ignore: true)
  $CobroHistoricoCopyWith<CobroHistorico> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $CobroHistoricoCopyWith<$Res> {
  factory $CobroHistoricoCopyWith(
          CobroHistorico value, $Res Function(CobroHistorico) then) =
      _$CobroHistoricoCopyWithImpl<$Res, CobroHistorico>;
  @useResult
  $Res call(
      {String id,
      double importe,
      DateTime fecha,
      String? formaPago,
      String referencia,
      String observaciones});
}

/// @nodoc
class _$CobroHistoricoCopyWithImpl<$Res, $Val extends CobroHistorico>
    implements $CobroHistoricoCopyWith<$Res> {
  _$CobroHistoricoCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? importe = null,
    Object? fecha = null,
    Object? formaPago = freezed,
    Object? referencia = null,
    Object? observaciones = null,
  }) {
    return _then(_value.copyWith(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      importe: null == importe
          ? _value.importe
          : importe // ignore: cast_nullable_to_non_nullable
              as double,
      fecha: null == fecha
          ? _value.fecha
          : fecha // ignore: cast_nullable_to_non_nullable
              as DateTime,
      formaPago: freezed == formaPago
          ? _value.formaPago
          : formaPago // ignore: cast_nullable_to_non_nullable
              as String?,
      referencia: null == referencia
          ? _value.referencia
          : referencia // ignore: cast_nullable_to_non_nullable
              as String,
      observaciones: null == observaciones
          ? _value.observaciones
          : observaciones // ignore: cast_nullable_to_non_nullable
              as String,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$CobroHistoricoImplCopyWith<$Res>
    implements $CobroHistoricoCopyWith<$Res> {
  factory _$$CobroHistoricoImplCopyWith(_$CobroHistoricoImpl value,
          $Res Function(_$CobroHistoricoImpl) then) =
      __$$CobroHistoricoImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {String id,
      double importe,
      DateTime fecha,
      String? formaPago,
      String referencia,
      String observaciones});
}

/// @nodoc
class __$$CobroHistoricoImplCopyWithImpl<$Res>
    extends _$CobroHistoricoCopyWithImpl<$Res, _$CobroHistoricoImpl>
    implements _$$CobroHistoricoImplCopyWith<$Res> {
  __$$CobroHistoricoImplCopyWithImpl(
      _$CobroHistoricoImpl _value, $Res Function(_$CobroHistoricoImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? importe = null,
    Object? fecha = null,
    Object? formaPago = freezed,
    Object? referencia = null,
    Object? observaciones = null,
  }) {
    return _then(_$CobroHistoricoImpl(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      importe: null == importe
          ? _value.importe
          : importe // ignore: cast_nullable_to_non_nullable
              as double,
      fecha: null == fecha
          ? _value.fecha
          : fecha // ignore: cast_nullable_to_non_nullable
              as DateTime,
      formaPago: freezed == formaPago
          ? _value.formaPago
          : formaPago // ignore: cast_nullable_to_non_nullable
              as String?,
      referencia: null == referencia
          ? _value.referencia
          : referencia // ignore: cast_nullable_to_non_nullable
              as String,
      observaciones: null == observaciones
          ? _value.observaciones
          : observaciones // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

/// @nodoc

class _$CobroHistoricoImpl implements _CobroHistorico {
  const _$CobroHistoricoImpl(
      {required this.id,
      required this.importe,
      required this.fecha,
      this.formaPago,
      this.referencia = '',
      this.observaciones = ''});

  @override
  final String id;
  @override
  final double importe;
  @override
  final DateTime fecha;
  @override
  final String? formaPago;
  @override
  @JsonKey()
  final String referencia;
  @override
  @JsonKey()
  final String observaciones;

  @override
  String toString() {
    return 'CobroHistorico(id: $id, importe: $importe, fecha: $fecha, formaPago: $formaPago, referencia: $referencia, observaciones: $observaciones)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$CobroHistoricoImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.importe, importe) || other.importe == importe) &&
            (identical(other.fecha, fecha) || other.fecha == fecha) &&
            (identical(other.formaPago, formaPago) ||
                other.formaPago == formaPago) &&
            (identical(other.referencia, referencia) ||
                other.referencia == referencia) &&
            (identical(other.observaciones, observaciones) ||
                other.observaciones == observaciones));
  }

  @override
  int get hashCode => Object.hash(
      runtimeType, id, importe, fecha, formaPago, referencia, observaciones);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$CobroHistoricoImplCopyWith<_$CobroHistoricoImpl> get copyWith =>
      __$$CobroHistoricoImplCopyWithImpl<_$CobroHistoricoImpl>(
          this, _$identity);
}

abstract class _CobroHistorico implements CobroHistorico {
  const factory _CobroHistorico(
      {required final String id,
      required final double importe,
      required final DateTime fecha,
      final String? formaPago,
      final String referencia,
      final String observaciones}) = _$CobroHistoricoImpl;

  @override
  String get id;
  @override
  double get importe;
  @override
  DateTime get fecha;
  @override
  String? get formaPago;
  @override
  String get referencia;
  @override
  String get observaciones;
  @override
  @JsonKey(ignore: true)
  _$$CobroHistoricoImplCopyWith<_$CobroHistoricoImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
