import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:gmp_app_mobilidad/features/analytics/data/analytics_repository.dart';
import 'package:gmp_app_mobilidad/features/analytics/presentation/bloc/analytics_state.dart';

class AnalyticsCubit extends Cubit<AnalyticsState> {
  final AnalyticsRepository _repository;
  AnalyticsCubit(this._repository) : super(AnalyticsInitial());

  Future<void> loadAnalytics() async {
    emit(AnalyticsLoading());
    try {
      final data = await _repository.getAnalyticsData();
      emit(AnalyticsLoaded(data));
    } catch (e) {
      emit(AnalyticsError(e.toString()));
    }
  }
}
