---
name: flutter-navigation
description: Flutter navigation with GoRouter — GoRoute, ShellRoute, StatefulShellRoute, auth guards, deep links, route parameters. Use when setting up or modifying navigation in a Flutter app. In gmp_app_mobilidad, coordinate with rutero_detail_modal.dart and do NOT add code there.
---

# Flutter Navigation with GoRouter — Professional Guide

## Overview
GoRouter is the recommended declarative routing package for Flutter. It unifies deep linking, web URLs, auth guards, and nested navigation under a single `GoRouter` instance. This guide covers every routing pattern needed for production apps.

---

## When to Use
- Setting up navigation in a new or existing Flutter app
- Implementing persistent bottom navigation with state-preserved tabs
- Adding deep link support (Android intent-filter / iOS url_types)
- Protecting routes with auth guards that react to login state changes
- Passing parameters (path, query, or non-URL objects) between routes

## When NOT to Use
- Do NOT use `Navigator.push()` alongside GoRouter — pick one system
- Do NOT add route logic to `rutero_detail_modal.dart` in **gmp_app_mobilidad** (3517 lines — coordinate separately)
- Do NOT encode sensitive data in URL path/query parameters

---

## Step-by-Step Process

### 1. Package Setup

```yaml
# pubspec.yaml
dependencies:
  go_router: ^13.0.0
```

### 2. Auth Notifier (ChangeNotifier / Riverpod)

```dart
// lib/core/auth/auth_notifier.dart
import 'package:flutter/foundation.dart';

class AuthNotifier extends ChangeNotifier {
  bool _isAuthenticated = false;
  bool get isAuthenticated => _isAuthenticated;

  void login()  { _isAuthenticated = true;  notifyListeners(); }
  void logout() { _isAuthenticated = false; notifyListeners(); }
}
```

### 3. GoRouter Instance with Auth Guard

```dart
// lib/core/router/app_router.dart
import 'package:go_router/go_router.dart';
import 'package:flutter/material.dart';
import '../auth/auth_notifier.dart';

GoRouter buildRouter(AuthNotifier authNotifier) {
  return GoRouter(
    initialLocation: '/home',
    refreshListenable: authNotifier, // re-evaluates redirect on notifyListeners()
    redirect: (BuildContext context, GoRouterState state) {
      final loggedIn  = authNotifier.isAuthenticated;
      final onLogin   = state.matchedLocation == '/login';

      if (!loggedIn && !onLogin) return '/login';
      if (loggedIn  &&  onLogin) return '/home';
      return null; // no redirect
    },
    errorBuilder: (context, state) => ErrorPage(error: state.error),
    routes: [
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginPage(),
      ),
      // Shell: persistent bottom nav (tabs share a single Navigator)
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) =>
            ScaffoldWithBottomNav(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(routes: [
            GoRoute(
              path: '/home',
              builder: (context, state) => const HomePage(),
              routes: [
                GoRoute(
                  path: 'detail/:id',
                  builder: (context, state) {
                    final id = state.pathParameters['id']!;
                    final extra = state.extra as Map<String, dynamic>?;
                    return DetailPage(id: id, extra: extra);
                  },
                ),
              ],
            ),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
              path: '/profile',
              builder: (context, state) => const ProfilePage(),
            ),
          ]),
        ],
      ),
    ],
  );
}
```

### 4. Persistent Bottom Nav with StatefulShellRoute

```dart
// lib/core/router/scaffold_with_bottom_nav.dart
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class ScaffoldWithBottomNav extends StatelessWidget {
  final StatefulNavigationShell navigationShell;
  const ScaffoldWithBottomNav({required this.navigationShell, super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: navigationShell, // renders current branch, preserves state
      bottomNavigationBar: NavigationBar(
        selectedIndex: navigationShell.currentIndex,
        onDestinationSelected: (index) =>
            navigationShell.goBranch(index, initialLocation: index == navigationShell.currentIndex),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home),    label: 'Home'),
          NavigationDestination(icon: Icon(Icons.person),  label: 'Profile'),
        ],
      ),
    );
  }
}
```

### 5. Navigation Methods — When to Use Each

```dart
// context.go()     — replace entire stack (tab switch, login → home)
context.go('/home');

// context.push()   — push onto current stack (master → detail)
context.push('/home/detail/42', extra: {'title': 'Item 42'});

// context.replace() — replace current route without adding to stack (post-form-submit)
context.replace('/home');

// context.pop()    — go back (same as Navigator.pop)
context.pop();
```

### 6. Route Parameters

```dart
// Path parameter:  /home/detail/:id  →  state.pathParameters['id']
// Query parameter: /search?q=flutter  →  state.uri.queryParameters['q']
// Extra (non-URL): context.push('/detail/1', extra: myObject)
//                  state.extra as MyObject  — NOT preserved across deep links

GoRoute(
  path: '/search',
  builder: (context, state) {
    final query = state.uri.queryParameters['q'] ?? '';
    return SearchPage(query: query);
  },
),
```

### 7. Deep Links

**Android** — `android/app/src/main/AndroidManifest.xml`:
```xml
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW"/>
  <category android:name="android.intent.category.DEFAULT"/>
  <category android:name="android.intent.category.BROWSABLE"/>
  <data android:scheme="https" android:host="app.example.com"/>
</intent-filter>
```

**iOS** — `ios/Runner/Info.plist`:
```xml
<key>FlutterDeepLinkingEnabled</key><true/>
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array><string>myapp</string></array>
  </dict>
</array>
```

GoRouter handles the URL automatically — just ensure the path matches your route tree.

---

## Verification Checklist

- [ ] Single `GoRouter` instance created once (Provider / Riverpod ref, not inside build)
- [ ] `refreshListenable` wired to auth state — redirect re-evaluates on login/logout
- [ ] `redirect` returns `null` when no redirect is needed (not an empty string)
- [ ] `StatefulShellRoute` used for tabs that must preserve scroll/state between switches
- [ ] `context.go()` used for tab switches; `context.push()` used for drill-down navigation
- [ ] `extra` objects never relied upon after app restart or deep link (not serializable)
- [ ] Android `intent-filter` and iOS `url_types` configured for deep links
- [ ] `errorBuilder` defined to handle unknown routes gracefully
- [ ] **gmp_app_mobilidad**: no route logic added to `rutero_detail_modal.dart`
- [ ] Sensitive data passed via `extra`, never via path/query parameters
