import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class PremiumSlideRoute<T> extends PageRouteBuilder<T> {
  PremiumSlideRoute({
    required Widget page,
    super.settings,
    Duration duration = const Duration(milliseconds: 220),
  }) : super(
          pageBuilder: (context, animation, secondaryAnimation) => page,
          transitionsBuilder: (context, animation, secondaryAnimation, child) {
            final curved = CurvedAnimation(
              parent: animation,
              curve: Curves.easeOutCubic,
              reverseCurve: Curves.easeInCubic,
            );

            return FadeTransition(
              opacity: curved,
              child: SlideTransition(
                position: Tween<Offset>(
                  begin: const Offset(0.04, 0),
                  end: Offset.zero,
                ).animate(curved),
                child: child,
              ),
            );
          },
          transitionDuration: duration,
          reverseTransitionDuration: duration,
        );
}

class PremiumFadeRoute<T> extends PageRouteBuilder<T> {
  PremiumFadeRoute({
    required Widget page,
    super.settings,
    Duration duration = const Duration(milliseconds: 180),
  }) : super(
          pageBuilder: (context, animation, secondaryAnimation) => page,
          transitionsBuilder: (context, animation, secondaryAnimation, child) {
            return FadeTransition(
              opacity: CurvedAnimation(
                parent: animation,
                curve: Curves.easeOutCubic,
                reverseCurve: Curves.easeInCubic,
              ),
              child: child,
            );
          },
          transitionDuration: duration,
          reverseTransitionDuration: duration,
        );
}

class PremiumScaleRoute<T> extends PageRouteBuilder<T> {
  PremiumScaleRoute({
    required Widget page,
    super.settings,
    Duration duration = const Duration(milliseconds: 200),
  }) : super(
          pageBuilder: (context, animation, secondaryAnimation) => page,
          transitionsBuilder: (context, animation, secondaryAnimation, child) {
            final curved = CurvedAnimation(
              parent: animation,
              curve: Curves.easeOutCubic,
              reverseCurve: Curves.easeInCubic,
            );

            return FadeTransition(
              opacity: curved,
              child: ScaleTransition(
                scale: Tween<double>(begin: 0.985, end: 1).animate(curved),
                child: child,
              ),
            );
          },
          transitionDuration: duration,
          reverseTransitionDuration: duration,
        );
}

extension PremiumNavigator on BuildContext {
  Future<T?> pushPremium<T extends Object?>(Widget page) {
    return Navigator.of(this).push<T>(PremiumSlideRoute<T>(page: page));
  }

  Future<T?> pushReplacementPremium<T extends Object?, TO extends Object?>(
    Widget page,
  ) {
    return Navigator.of(this).pushReplacement<T, TO>(
      PremiumFadeRoute<T>(page: page),
    );
  }

  Future<T?> pushScale<T extends Object?>(Widget page) {
    return Navigator.of(this).push<T>(PremiumScaleRoute<T>(page: page));
  }
}

CustomTransitionPage buildPremiumTransitionPage({
  required BuildContext context,
  required GoRouterState state,
  required Widget child,
}) {
  return CustomTransitionPage(
    key: state.pageKey,
    child: child,
    transitionDuration: const Duration(milliseconds: 220),
    reverseTransitionDuration: const Duration(milliseconds: 180),
    transitionsBuilder: (context, animation, secondaryAnimation, child) {
      final curved = CurvedAnimation(
        parent: animation,
        curve: Curves.easeOutCubic,
        reverseCurve: Curves.easeInCubic,
      );

      return FadeTransition(
        opacity: curved,
        child: SlideTransition(
          position: Tween<Offset>(
            begin: const Offset(0, 0.018),
            end: Offset.zero,
          ).animate(curved),
          child: child,
        ),
      );
    },
  );
}
