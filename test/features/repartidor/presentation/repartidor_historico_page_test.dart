import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/repartidor_data_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/pages/repartidor_historico_page.dart';

Future<List<HistoryClient>> _clients({
  required String repartidorId,
  String? search,
}) async {
  return <HistoryClient>[
    HistoryClient(
      id: 'C1',
      name: 'Cliente Uno',
      address: 'Calle Uno',
      totalDocuments: 1,
    ),
  ];
}

HistoryDocument _document(String date, {bool hasSignature = false}) {
  return HistoryDocument(
    id: '2026-A-0-1',
    type: 'albaran',
    number: 1,
    date: date,
    amount: 25,
    pending: 0,
    status: 'delivered',
    hasSignature: hasSignature,
    serie: 'A',
    ejercicio: 2026,
    terminal: 0,
  );
}

Widget _page(
  RepartidorHistoryDocumentsLoader documentsLoader, {
  RepartidorHistoryClientsLoader clientsLoader = _clients,
  RepartidorHistoryClientsPageLoader? clientsPageLoader,
  RepartidorHistoryDocumentDownloader? documentDownloader,
  RepartidorHistorySignatureLoader? signatureLoader,
  bool canEmailDocuments = false,
  String? initialClientId = 'C1',
  String? initialClientName = 'Cliente Uno',
}) {
  return MaterialApp(
    home: RepartidorHistoricoPage(
      repartidorId: '05',
      initialClientId: initialClientId,
      initialClientName: initialClientName,
      clientsLoader: clientsPageLoader == null ? clientsLoader : null,
      clientsPageLoader: clientsPageLoader,
      documentsLoader: documentsLoader,
      documentDownloader: documentDownloader,
      signatureLoader: signatureLoader,
      canEmailDocuments: canEmailDocuments,
    ),
  );
}

void _useWideTestViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(1440, 2560);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  testWidgets('renders an invalid backend date as Sin fecha', (tester) async {
    _useWideTestViewport(tester);
    await tester.pumpWidget(
      _page(
        ({
          required String clientId,
          required String repartidorId,
          String? dateFrom,
          String? dateTo,
          int? year,
        }) async =>
            <HistoryDocument>[_document('not-a-date')],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Sin fecha'), findsOneWidget);
    expect(find.text('Cliente Uno'), findsWidgets);

    await tester.tap(find.text('A-0-1'));
    await tester.pumpAndSettle();

    expect(
      find.byKey(
        const ValueKey('invalid-document-date-actions-disabled'),
      ),
      findsOneWidget,
    );
    expect(find.textContaining('01/01/1900'), findsNothing);
    expect(find.text('Ver PDF'), findsNothing);
    expect(find.text('Compartir'), findsNothing);
  });

  testWidgets('distinguishes a documents error from an empty history', (
    tester,
  ) async {
    _useWideTestViewport(tester);
    await tester.pumpWidget(
      _page(
        ({
          required String clientId,
          required String repartidorId,
          String? dateFrom,
          String? dateTo,
          int? year,
        }) async =>
            throw StateError('DB2 unavailable'),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.text('No se pudo cargar el historial de documentos'),
      findsOneWidget,
    );
    expect(find.text('Reintentar'), findsOneWidget);
    expect(find.text('Sin documentos'), findsNothing);
  });

  testWidgets('shows the empty state only for a successful empty response', (
    tester,
  ) async {
    _useWideTestViewport(tester);
    await tester.pumpWidget(
      _page(
        ({
          required String clientId,
          required String repartidorId,
          String? dateFrom,
          String? dateTo,
          int? year,
        }) async =>
            <HistoryDocument>[],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Sin documentos'), findsOneWidget);
    expect(
      find.text('No se pudo cargar el historial de documentos'),
      findsNothing,
    );
  });
  testWidgets('deduplicates sorted client pages and retries a failed next page',
      (
    tester,
  ) async {
    _useWideTestViewport(tester);
    var calls = 0;
    final offsets = <int>[];
    final limits = <int>[];
    await tester.pumpWidget(
      _page(
        ({
          required String clientId,
          required String repartidorId,
          String? dateFrom,
          String? dateTo,
          int? year,
        }) async =>
            <HistoryDocument>[],
        initialClientId: null,
        initialClientName: null,
        clientsPageLoader: ({
          required String repartidorId,
          String? search,
          required int limit,
          required int offset,
          required bool forceRefresh,
        }) async {
          offsets.add(offset);
          limits.add(limit);
          calls++;
          if (calls == 1) {
            return (
              clients: <HistoryClient>[
                HistoryClient(
                  id: 'C2',
                  name: 'Zeta',
                  address: '',
                  totalDocuments: 1,
                ),
                HistoryClient(
                  id: 'C1',
                  name: 'Alpha',
                  address: '',
                  totalDocuments: 1,
                ),
              ],
              hasMore: true,
            );
          }
          if (calls == 2) throw StateError('temporary failure');
          if (calls == 3) {
            return (
              clients: <HistoryClient>[
                HistoryClient(
                  id: 'C1',
                  name: 'Alpha updated',
                  address: '',
                  totalDocuments: 2,
                ),
                HistoryClient(
                  id: 'C3',
                  name: 'Bravo',
                  address: '',
                  totalDocuments: 1,
                ),
              ],
              hasMore: true,
            );
          }
          return (
            clients: <HistoryClient>[
              HistoryClient(
                id: 'C4',
                name: 'Delta',
                address: '',
                totalDocuments: 1,
              ),
            ],
            hasMore: false,
          );
        },
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Alpha'), findsOneWidget);
    expect(find.text('Zeta'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('history-clients-load-more')));
    await tester.pumpAndSettle();

    expect(
      find.text('No se pudo cargar la siguiente página de clientes'),
      findsOneWidget,
    );
    expect(find.text('Alpha'), findsOneWidget);
    await tester.tap(
      find.byKey(const ValueKey('history-clients-load-more-retry')),
    );
    await tester.pumpAndSettle();

    expect(find.text('Bravo'), findsOneWidget);
    expect(find.text('Alpha updated'), findsOneWidget);
    expect(find.text('Zeta'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('history-clients-load-more')));
    await tester.pumpAndSettle();

    expect(find.text('Delta'), findsOneWidget);
    expect(offsets, <int>[0, 2, 2, 4]);
    expect(limits, everyElement(100));
  });

  testWidgets('late documents response cannot replace newer client selection', (
    tester,
  ) async {
    _useWideTestViewport(tester);
    tester.view.physicalSize = const Size(800, 1200);
    final first = Completer<List<HistoryDocument>>();
    final second = Completer<List<HistoryDocument>>();
    await tester.pumpWidget(
      _page(
        ({
          required String clientId,
          required String repartidorId,
          String? dateFrom,
          String? dateTo,
          int? year,
        }) =>
            clientId == 'C1' ? first.future : second.future,
        clientsLoader: ({required repartidorId, search}) async =>
            <HistoryClient>[
          HistoryClient(
            id: 'C1',
            name: 'Cliente Uno',
            address: '',
            totalDocuments: 1,
          ),
          HistoryClient(
            id: 'C2',
            name: 'Cliente Dos',
            address: '',
            totalDocuments: 1,
          ),
        ],
      ),
    );
    await tester.pump();
    await tester.pump();

    await tester.tap(find.text('Cambiar'));
    await tester.pump(const Duration(milliseconds: 500));
    final popupContext = tester.element(find.text('Cliente Dos').last);
    Navigator.of(popupContext).pop('C2');
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pump();
    second.complete(<HistoryDocument>[_document('2026-08-09')]);
    await tester.pumpAndSettle();
    first.complete(<HistoryDocument>[
      HistoryDocument(
        id: 'old',
        type: 'albaran',
        number: 99,
        date: '2026-08-08',
        amount: 0,
        pending: 0,
        status: 'delivered',
        hasSignature: false,
        serie: 'A',
        ejercicio: 2026,
        terminal: 0,
      ),
    ]);
    await tester.pumpAndSettle();

    expect(find.text('A-0-1'), findsOneWidget);
    expect(find.text('A-0-99'), findsNothing);
    expect(find.text('Cliente Dos'), findsWidgets);
  });

  testWidgets('late client page cannot replace a refreshed client snapshot', (
    tester,
  ) async {
    _useWideTestViewport(tester);
    var calls = 0;
    final append = Completer<HistoryClientsPage>();
    final refresh = Completer<HistoryClientsPage>();

    await tester.pumpWidget(
      _page(
        ({
          required String clientId,
          required String repartidorId,
          String? dateFrom,
          String? dateTo,
          int? year,
        }) async =>
            <HistoryDocument>[],
        initialClientId: null,
        initialClientName: null,
        clientsPageLoader: ({
          required String repartidorId,
          String? search,
          required int limit,
          required int offset,
          required bool forceRefresh,
        }) {
          calls++;
          if (calls == 1) {
            return Future.value((
              clients: <HistoryClient>[
                HistoryClient(
                  id: 'C1',
                  name: 'Inicial',
                  address: '',
                  totalDocuments: 1,
                ),
              ],
              hasMore: true,
            ));
          }
          return calls == 2 ? append.future : refresh.future;
        },
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('history-clients-load-more')));
    await tester.pump();
    final refreshState = tester.state<RefreshIndicatorState>(
      find.byType(RefreshIndicator),
    );
    unawaited(refreshState.show());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    expect(calls, 3);

    refresh.complete((
      clients: <HistoryClient>[
        HistoryClient(
          id: 'C3',
          name: 'Actual',
          address: '',
          totalDocuments: 1,
        ),
      ],
      hasMore: false,
    ));
    await tester.pumpAndSettle();
    append.complete((
      clients: <HistoryClient>[
        HistoryClient(
          id: 'C2',
          name: 'Obsoleto',
          address: '',
          totalDocuments: 1,
        ),
      ],
      hasMore: false,
    ));
    await tester.pumpAndSettle();

    expect(find.text('Actual'), findsOneWidget);
    expect(find.text('Obsoleto'), findsNothing);
  });

  testWidgets('pending document load cannot set state after dispose', (
    tester,
  ) async {
    final pending = Completer<List<HistoryDocument>>();
    await tester.pumpWidget(_page(({
      required String clientId,
      required String repartidorId,
      String? dateFrom,
      String? dateTo,
      int? year,
    }) =>
        pending.future));
    await tester.pump();
    await tester.pumpWidget(const SizedBox.shrink());

    pending.complete(<HistoryDocument>[_document('2026-08-09')]);
    await tester.pump();

    expect(tester.takeException(), isNull);
  });

  testWidgets('email action is hidden unless the server capability is true', (
    tester,
  ) async {
    _useWideTestViewport(tester);
    await tester.pumpWidget(
      _page(
        ({
          required String clientId,
          required String repartidorId,
          String? dateFrom,
          String? dateTo,
          int? year,
        }) async =>
            <HistoryDocument>[_document('2026-08-09')],
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('A-0-1'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Compartir'));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('history-email-action')), findsNothing);
    expect(find.text('Email enviado correctamente'), findsNothing);
    expect(find.text('Compartir localmente'), findsOneWidget);
  });

  testWidgets('explicit server email capability reveals the action', (
    tester,
  ) async {
    _useWideTestViewport(tester);
    await tester.pumpWidget(
      _page(
        ({
          required String clientId,
          required String repartidorId,
          String? dateFrom,
          String? dateTo,
          int? year,
        }) async =>
            <HistoryDocument>[_document('2026-08-09')],
        canEmailDocuments: true,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('A-0-1'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Compartir'));
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('history-email-action')),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const ValueKey('history-email-action')));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('history-email-unavailable')),
      findsOneWidget,
    );
    expect(find.text('Email enviado correctamente'), findsNothing);
  });

  testWidgets('double download tap starts only one request', (tester) async {
    _useWideTestViewport(tester);
    final pendingDownload = Completer<List<int>>();
    var downloadCalls = 0;
    await tester.pumpWidget(
      _page(
        ({
          required String clientId,
          required String repartidorId,
          String? dateFrom,
          String? dateTo,
          int? year,
        }) async =>
            <HistoryDocument>[_document('2026-08-09')],
        documentDownloader: ({
          required int year,
          required String serie,
          required int number,
          required String type,
          required int terminal,
          int? facturaNumber,
          String? serieFactura,
          int? ejercicioFactura,
          int? albaranNumber,
          String? albaranSerie,
          int? albaranTerminal,
          int? albaranYear,
        }) {
          downloadCalls++;
          return pendingDownload.future;
        },
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('A-0-1'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Compartir'));
    await tester.pumpAndSettle();
    final downloadAction = find.text('Descargar / Guardar');
    await tester.tap(downloadAction);
    await tester.tap(downloadAction, warnIfMissed: false);
    await tester.pump();

    expect(downloadCalls, 1);
    pendingDownload.completeError(
      const RepartidorDataException('Descarga controlada'),
    );
    await tester.pumpAndSettle();
    expect(find.text('No se pudo descargar el documento.'), findsOneWidget);
  });

  testWidgets('closing signature dialog ignores a late response', (
    tester,
  ) async {
    _useWideTestViewport(tester);
    final pendingSignature = Completer<Map<String, dynamic>?>();
    await tester.pumpWidget(
      _page(
        ({
          required String clientId,
          required String repartidorId,
          String? dateFrom,
          String? dateTo,
          int? year,
        }) async =>
            <HistoryDocument>[
          _document('2026-08-09', hasSignature: true),
        ],
        signatureLoader: ({
          required int ejercicio,
          required String serie,
          required int terminal,
          required int numero,
        }) =>
            pendingSignature.future,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('A-0-1'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ver Firma'));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    await tester.tap(find.text('Cerrar'));
    await tester.pumpAndSettle();

    pendingSignature.complete(<String, dynamic>{
      'source': 'CACFIRMAS_NAME_ONLY',
      'firmante': 'Firmante tardío',
      'fecha': '2026-08-09',
    });
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.textContaining('Firmante tardío'), findsNothing);
  });

  testWidgets('system share mutex collapses a double tap into one request', (
    tester,
  ) async {
    _useWideTestViewport(tester);
    final pendingShare = Completer<List<int>>();
    var downloadCalls = 0;
    await tester.pumpWidget(
      _page(
        ({
          required String clientId,
          required String repartidorId,
          String? dateFrom,
          String? dateTo,
          int? year,
        }) async =>
            <HistoryDocument>[_document('2026-08-09')],
        documentDownloader: ({
          required int year,
          required String serie,
          required int number,
          required String type,
          required int terminal,
          int? facturaNumber,
          String? serieFactura,
          int? ejercicioFactura,
          int? albaranNumber,
          String? albaranSerie,
          int? albaranTerminal,
          int? albaranYear,
        }) {
          downloadCalls++;
          return pendingShare.future;
        },
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('A-0-1'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Compartir'));
    await tester.pumpAndSettle();
    final shareAction = find.text('Más opciones...');
    await tester.tap(shareAction);
    await tester.tap(shareAction, warnIfMissed: false);
    await tester.pump();

    expect(downloadCalls, 1);
    pendingShare.completeError(
      StateError(r'C:\privado\DNI-12345678Z\firma.png'),
    );
    await tester.pumpAndSettle();
    expect(find.text('No se pudo compartir el documento.'), findsOneWidget);
    expect(find.textContaining('DNI-12345678Z'), findsNothing);
    expect(find.textContaining(r'C:\privado'), findsNothing);
  });

  testWidgets('preview sanitizes injected paths and personal data', (
    tester,
  ) async {
    _useWideTestViewport(tester);
    await tester.pumpWidget(
      _page(
        ({
          required String clientId,
          required String repartidorId,
          String? dateFrom,
          String? dateTo,
          int? year,
        }) async =>
            <HistoryDocument>[_document('2026-08-09')],
        documentDownloader: ({
          required int year,
          required String serie,
          required int number,
          required String type,
          required int terminal,
          int? facturaNumber,
          String? serieFactura,
          int? ejercicioFactura,
          int? albaranNumber,
          String? albaranSerie,
          int? albaranTerminal,
          int? albaranYear,
        }) async =>
            throw StateError(r'C:\privado\DNI-12345678Z\firma.png'),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('A-0-1'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ver PDF'));
    await tester.pumpAndSettle();

    expect(find.text('No se pudo visualizar el documento.'), findsOneWidget);
    expect(find.textContaining('DNI-12345678Z'), findsNothing);
    expect(find.textContaining(r'C:\privado'), findsNothing);
  });

  testWidgets('signature error never renders injected paths or PII', (
    tester,
  ) async {
    _useWideTestViewport(tester);
    await tester.pumpWidget(
      _page(
        ({
          required String clientId,
          required String repartidorId,
          String? dateFrom,
          String? dateTo,
          int? year,
        }) async =>
            <HistoryDocument>[
          _document('2026-08-09', hasSignature: true),
        ],
        signatureLoader: ({
          required int ejercicio,
          required String serie,
          required int terminal,
          required int numero,
        }) async =>
            throw StateError(r'C:\privado\DNI-12345678Z\firma.png'),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('A-0-1'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ver Firma'));
    await tester.pumpAndSettle();

    expect(find.text('No se pudo cargar la firma.'), findsOneWidget);
    expect(find.textContaining('DNI-12345678Z'), findsNothing);
    expect(find.textContaining(r'C:\privado'), findsNothing);
  });
}
