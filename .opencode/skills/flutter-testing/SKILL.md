---
name: flutter-testing
description: Flutter testing — unit tests with mocktail, widget tests with pump/find/interact, golden tests with matchesGoldenFile, integration tests, and CI coverage enforcement.
---

# Flutter Testing

## Overview

Flutter's `flutter_test` package provides a complete testing toolkit: widget rendering in a simulated environment, finders, gestures, and timer control. Pair it with `mocktail` for mocking and `integration_test` for end-to-end flows. This skill covers all three layers with production-ready examples.

```yaml
dev_dependencies:
  flutter_test:
    sdk: flutter
  mocktail: ^1.0.4
  integration_test:
    sdk: flutter
```

## When to Use

- Any time you write or modify a widget, provider, service, or utility class
- Before shipping a feature (widget test verifies UI contract)
- When setting up visual regression protection (golden tests)
- When integrating with platform channels or real device behavior (integration tests)

## When NOT to Use

- Don't write golden tests for rapidly changing UI — they become a maintenance burden
- Don't use integration tests as a substitute for unit/widget tests — they are slow and flaky
- Don't mock everything — pure functions need no mocks

---

## Step-by-Step Process

### 1. Unit Tests with mocktail

```dart
// service/auth_service.dart
abstract class AuthRepository {
  Future<User> login(String email, String password);
}

// test/service/auth_service_test.dart
import 'package:mocktail/mocktail.dart';
import 'package:test/test.dart';

class MockAuthRepository extends Mock implements AuthRepository {}

void main() {
  late MockAuthRepository mockRepo;
  late AuthService sut;

  setUp(() {
    mockRepo = MockAuthRepository();
    sut = AuthService(repository: mockRepo);
  });

  tearDown(() => resetMocktailState());

  group('AuthService.login', () {
    test('returns user on success', () async {
      final expected = User(id: '1', email: 'a@b.com');
      when(() => mockRepo.login(any(), any()))
          .thenAnswer((_) async => expected);

      final result = await sut.login('a@b.com', 'pass');

      expect(result, equals(expected));
      verify(() => mockRepo.login('a@b.com', 'pass')).called(1);
    });

    test('throws AuthException on invalid credentials', () async {
      when(() => mockRepo.login(any(), any()))
          .thenThrow(AuthException('invalid'));

      expect(
        () => sut.login('x@y.com', 'wrong'),
        throwsA(isA<AuthException>()),
      );
    });
  });
}
```

### 2. Widget Tests — pump, find, interact

```dart
// test/widgets/login_form_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';

class MockAuthViewModel extends Mock implements AuthViewModel {}

void main() {
  late MockAuthViewModel mockViewModel;

  setUp(() {
    mockViewModel = MockAuthViewModel();
    when(() => mockViewModel.state).thenReturn(AuthState.idle);
  });

  testWidgets('shows error when login fails', (tester) async {
    when(() => mockViewModel.login(any(), any()))
        .thenAnswer((_) async {});
    when(() => mockViewModel.state)
        .thenReturn(AuthState.error('Invalid credentials'));

    await tester.pumpWidget(
      MaterialApp(
        home: ChangeNotifierProvider<AuthViewModel>.value(
          value: mockViewModel,
          child: const LoginForm(),
        ),
      ),
    );

    // Enter credentials
    await tester.enterText(find.byKey(const Key('email_field')), 'a@b.com');
    await tester.enterText(find.byKey(const Key('password_field')), 'wrong');

    // Submit
    await tester.tap(find.byType(ElevatedButton));
    await tester.pump(); // trigger one frame
    await tester.pumpAndSettle(); // wait for all animations

    expect(find.text('Invalid credentials'), findsOneWidget);
  });

  testWidgets('shows loading indicator while submitting', (tester) async {
    when(() => mockViewModel.state).thenReturn(AuthState.loading);

    await tester.pumpWidget(
      MaterialApp(
        home: ChangeNotifierProvider<AuthViewModel>.value(
          value: mockViewModel,
          child: const LoginForm(),
        ),
      ),
    );

    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });
}
```

Key finders reference:

```dart
find.byType(ElevatedButton)              // by widget type
find.byKey(const Key('submit_btn'))      // by key
find.text('Submit')                      // by exact text
find.textContaining('Submit')            // by substring
find.byWidgetPredicate(
  (w) => w is Icon && w.icon == Icons.check,
)                                        // custom predicate
find.descendant(
  of: find.byType(Card),
  matching: find.byType(Text),
)                                        // nested finders
```

Key interactions:

```dart
await tester.tap(find.byType(IconButton));
await tester.longPress(find.byKey(const Key('item_0')));
await tester.drag(find.byType(Dismissible), const Offset(-200, 0));
await tester.enterText(find.byType(TextField), 'hello');
await tester.pump(const Duration(milliseconds: 300)); // advance timer
await tester.pumpAndSettle();                          // idle
```

### 3. Golden Tests

Golden tests capture a widget as a PNG and fail on any visual diff.

```dart
// test/golden/dashboard_test.dart
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('Dashboard matches golden', (tester) async {
    // Load fonts — required or text renders as boxes
    await loadAppFonts(); // see helper below

    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light,
        home: const DashboardScreen(),
      ),
    );
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(DashboardScreen),
      matchesGoldenFile('goldens/dashboard_light.png'),
    );
  });
}

// test/helpers/fonts.dart
Future<void> loadAppFonts() async {
  final fontLoader = FontLoader('Roboto')
    ..addFont(rootBundle.load('assets/fonts/Roboto-Regular.ttf'));
  await fontLoader.load();
}
```

Update goldens after intentional UI changes:

```bash
flutter test --update-goldens test/golden/
```

### 4. Integration Tests

```dart
// integration_test/login_flow_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:my_app/main.dart' as app;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('full login flow', (tester) async {
    app.main();
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('email_field')), 'user@test.com');
    await tester.enterText(find.byKey(const Key('password_field')), 'secret');
    await tester.tap(find.byKey(const Key('login_button')));
    await tester.pumpAndSettle();

    expect(find.byType(HomeScreen), findsOneWidget);
  });
}
```

Run on device:

```bash
flutter test integration_test/login_flow_test.dart
```

### 5. Coverage Enforcement

```bash
# Generate LCOV coverage report
flutter test --coverage

# View HTML report (requires lcov)
genhtml coverage/lcov.info -o coverage/html
open coverage/html/index.html
```

Enforce in CI (GitHub Actions):

```yaml
- name: Run tests with coverage
  run: flutter test --coverage

- name: Check coverage threshold
  run: |
    COVERAGE=$(lcov --summary coverage/lcov.info 2>&1 | grep 'lines' | grep -oP '\d+\.\d+(?=%)')
    if (( $(echo "$COVERAGE < 80" | bc -l) )); then
      echo "Coverage $COVERAGE% below 80% threshold"
      exit 1
    fi
```

---

## Verification Checklist

- [ ] Every public method in service/repository classes has at least one unit test
- [ ] Every widget has a widget test covering: idle state, loading state, error state
- [ ] Mocks use `mocktail` — no manual stub classes
- [ ] `pumpAndSettle()` used after interactions that trigger animations
- [ ] Golden tests load fonts before pumping — no box-rendered text
- [ ] Integration tests use `IntegrationTestWidgetsFlutterBinding.ensureInitialized()`
- [ ] `flutter test --coverage` passes with ≥80% line coverage
- [ ] `tearDown(() => resetMocktailState())` present in all mock-using test files
- [ ] Tests use `Key` constants for finders — not fragile text strings in critical paths
