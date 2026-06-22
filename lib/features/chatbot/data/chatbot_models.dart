/// Structured metadata from Asistente GMP API responses.
class ChatExportableData {
  const ChatExportableData({
    required this.headers,
    required this.rows,
    required this.filename,
  });

  factory ChatExportableData.fromJson(Map<String, dynamic> json) {
    return ChatExportableData(
      headers: (json['headers'] as List<dynamic>? ?? [])
          .map((e) => e.toString())
          .toList(),
      rows: (json['rows'] as List<dynamic>? ?? [])
          .map(
            (row) =>
                (row as List<dynamic>).map((cell) => cell.toString()).toList(),
          )
          .toList(),
      filename: json['filename']?.toString() ?? 'asistente-gmp.csv',
    );
  }

  final List<String> headers;
  final List<List<String>> rows;
  final String filename;
}

class ChatKpiChip {
  const ChatKpiChip({
    required this.label,
    required this.value,
    this.delta,
    this.trend = 'neutral',
  });

  factory ChatKpiChip.fromJson(Map<String, dynamic> json) {
    return ChatKpiChip(
      label: json['label']?.toString() ?? '',
      value: json['value']?.toString() ?? '',
      delta: json['delta']?.toString(),
      trend: json['trend']?.toString() ?? 'neutral',
    );
  }

  final String label;
  final String value;
  final String? delta;
  final String trend;
}

class ChatChartPoint {
  const ChatChartPoint({required this.label, required this.value});

  factory ChatChartPoint.fromJson(Map<String, dynamic> json) {
    return ChatChartPoint(
      label: json['label']?.toString() ?? '',
      value: (json['value'] as num?)?.toDouble() ?? 0,
    );
  }

  final String label;
  final double value;
}

class ChatDeepLink {
  const ChatDeepLink({required this.tab, this.clientCode});

  factory ChatDeepLink.fromJson(Map<String, dynamic> json) {
    return ChatDeepLink(
      tab: json['tab']?.toString() ?? '',
      clientCode: json['clientCode']?.toString(),
    );
  }

  final String tab;
  final String? clientCode;
}

class ChatResponseMetadata {
  const ChatResponseMetadata({
    this.exportable,
    this.kpis = const [],
    this.suggestedFollowUps = const [],
    this.deepLink,
    this.chartData = const [],
  });

  factory ChatResponseMetadata.fromJson(Map<String, dynamic>? json) {
    if (json == null) return const ChatResponseMetadata();
    return ChatResponseMetadata(
      exportable: json['exportable'] != null
          ? ChatExportableData.fromJson(
              json['exportable'] as Map<String, dynamic>,
            )
          : null,
      kpis: (json['kpis'] as List<dynamic>? ?? [])
          .map((e) => ChatKpiChip.fromJson(e as Map<String, dynamic>))
          .toList(),
      suggestedFollowUps: (json['suggestedFollowUps'] as List<dynamic>? ?? [])
          .map((e) => e.toString())
          .toList(),
      deepLink: json['deepLink'] != null
          ? ChatDeepLink.fromJson(json['deepLink'] as Map<String, dynamic>)
          : null,
      chartData: (json['chartData'] as List<dynamic>? ?? [])
          .map((e) => ChatChartPoint.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  final ChatExportableData? exportable;
  final List<ChatKpiChip> kpis;
  final List<String> suggestedFollowUps;
  final ChatDeepLink? deepLink;
  final List<ChatChartPoint> chartData;
}
