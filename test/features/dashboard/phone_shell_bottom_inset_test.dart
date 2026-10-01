import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/dashboard/presentation/pages/shell_frame.dart';

const _body = ColoredBox(
  key: Key('shell-body'),
  color: Color(0xFF226688),
  child: SizedBox.expand(),
);

Future<void> _pumpPhone(WidgetTester tester, Size size, double inset) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  tester.view.padding = FakeViewPadding(bottom: inset);
  tester.view.viewPadding = FakeViewPadding(bottom: inset);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPadding);
  addTearDown(tester.view.resetViewPadding);
  await tester.pumpWidget(
    MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(
          size: size,
          padding: EdgeInsets.only(bottom: inset),
          viewPadding: EdgeInsets.only(bottom: inset),
          devicePixelRatio: 1,
        ),
        child: const PhoneShellScaffold(
          body: _body,
          bottomBar: PhoneShellBottomBar(
            child: SizedBox(
              key: Key('shell-nav-content'),
              height: 56,
              width: double.infinity,
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
}

Future<void> _pumpTablet(WidgetTester tester, Size size, double inset) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  tester.view.padding = FakeViewPadding(bottom: inset);
  tester.view.viewPadding = FakeViewPadding(bottom: inset);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPadding);
  addTearDown(tester.view.resetViewPadding);
  await tester.pumpWidget(
    MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(
          size: size,
          padding: EdgeInsets.only(bottom: inset),
          viewPadding: EdgeInsets.only(bottom: inset),
          devicePixelRatio: 1,
        ),
        child: const TabletShellScaffold(child: _body),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'phone bottom bar owns the inset once for gesture, 3-button, home indicator and zero',
    (tester) async {
      const phone = Size(390, 844);
      // Zero, Android gesture nav, Android 3-button, iPhone home indicator.
      const insets = <double>[0, 24, 48, 34];
      double? slackAtZero;

      for (final inset in insets) {
        await _pumpPhone(tester, phone, inset);

        expect(find.byKey(const Key('shell-phone-nav-bar')), findsOneWidget);
        final body = tester.getRect(find.byKey(const Key('shell-body')));
        final bar =
            tester.getRect(find.byKey(const Key('shell-phone-nav-bar')));
        final content =
            tester.getRect(find.byKey(const Key('shell-nav-content')));

        expect(bar.top - body.bottom, lessThan(1), reason: 'inset=$inset');
        expect(phone.height - bar.bottom, lessThan(1), reason: 'inset=$inset');

        final slack = phone.height - content.bottom - inset;
        expect(slack, inInclusiveRange(0, 16), reason: 'inset=$inset');
        if (inset == 0) {
          slackAtZero = slack;
        } else {
          expect(slack, closeTo(slackAtZero!, 1), reason: 'inset=$inset');
        }
      }
    },
  );

  testWidgets('tablet and desktop keep a single bottom inset and no phone bar',
      (tester) async {
    const cases = <(Size, double)>[
      (Size(1280, 800), 34),
      (Size(1280, 800), 0),
      (Size(1440, 900), 24),
    ];

    for (final entry in cases) {
      final size = entry.$1;
      final inset = entry.$2;
      await _pumpTablet(tester, size, inset);

      expect(find.byKey(const Key('shell-phone-nav-bar')), findsNothing);
      final body = tester.getRect(find.byKey(const Key('shell-body')));
      expect(
        size.height - body.bottom,
        closeTo(inset, 1),
        reason: 'size=$size inset=$inset',
      );
    }
  });
}
