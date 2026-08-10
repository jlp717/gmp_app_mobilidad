import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_modal.dart';

void main() {
  final manualReviewErrors = <Object>[
    const RepartoReceiptUnavailableException(),
    const RepartoConfirmationConflictException(),
    const RepartoJournalCorruptionException('journal corrupt'),
  ];

  for (final error in manualReviewErrors) {
    test('${error.runtimeType} is manual review and cannot retry', () {
      expect(
        repartoConfirmationErrorDisposition(
          error: error,
          acknowledged: false,
        ),
        RepartoConfirmationErrorDisposition.manualReview,
      );

      final presentation = repartoConfirmationErrorPresentation(
        error: error,
        acknowledged: false,
      );
      expect(presentation.canRetry, isFalse);
      expect(presentation.message, contains('revisión manual'));
      expect(presentation.message, isNot(contains('Reinténtalo')));
      expect(
        repartoConfirmationErrorSnackBar(
          presentation: presentation,
          onRetry: () {},
        ).action,
        isNull,
      );
    });
  }

  testWidgets('manual review notice renders no retry message or action',
      (tester) async {
    var retryCalls = 0;
    final presentation = repartoConfirmationErrorPresentation(
      error: const RepartoReceiptUnavailableException(),
      acknowledged: false,
    );
    final snackBar = repartoConfirmationErrorSnackBar(
      presentation: presentation,
      onRetry: () => retryCalls++,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () =>
                  ScaffoldMessenger.of(context).showSnackBar(snackBar),
              child: const Text('Mostrar error'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Mostrar error'));
    await tester.pump();

    expect(find.textContaining('revisión manual'), findsOneWidget);
    expect(find.textContaining('Reinténtalo'), findsNothing);
    expect(find.text('Reintentar'), findsNothing);
    expect(find.byType(SnackBarAction), findsNothing);
    expect(retryCalls, 0);
  });
}
